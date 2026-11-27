import {
  db,
  type DeletionDelivery,
  type DeletionDeliveryStatus,
  type DeletionRecipient,
  type Note,
  type NotebookDB,
  type Tombstone,
} from './db';
import { computeContentHash } from './hash';

export const STALE_PENDING_DELIVERY_MS = 20_000;

export type RemoteTombstone = Pick<Tombstone, 'noteId' | 'deletedAt' | 'deletionId'>;
export type IncomingNoteResult = 'stored' | 'unchanged' | 'blocked' | 'inactive';
export type ApplyTombstoneResult = {
  outcome: 'applied' | 'superseded' | 'invalid';
  removedNote: boolean;
};
export type LocalNoteUpdateResult =
  | { status: 'saved'; note: Note }
  | { status: 'missing' }
  | { status: 'deleted' };

export interface DeletionActivityRecipient {
  id: string;
  deviceName: string;
  pairingMissing: boolean;
  status: DeletionDeliveryStatus;
  updatedAt: string;
}

export interface DeletionActivityEntry {
  id: string;
  noteTitle: string;
  deletedAt: string;
  origin: 'local' | 'remote';
  recipients: DeletionActivityRecipient[];
}

export function deletionDeliveryKey(
  deletionId: string,
  pairingId: string,
  peerId: string
): string {
  return `${deletionId}\x00${pairingId}\x00${peerId}`;
}

function deduplicateRecipients(recipients: DeletionRecipient[]): DeletionRecipient[] {
  const seen = new Set<string>();
  const unique: DeletionRecipient[] = [];
  for (const recipient of recipients) {
    if (!recipient.pairingId || !recipient.peerId) continue;
    const key = `${recipient.pairingId}\x00${recipient.peerId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ pairingId: recipient.pairingId, peerId: recipient.peerId });
  }
  return unique;
}

async function deleteDeliveriesForNoteOrDeletion(
  database: NotebookDB,
  noteId: string,
  deletionId?: string
): Promise<void> {
  if (deletionId) {
    await database.deletionDeliveries.where('deletionId').equals(deletionId).delete();
  }
  await database.deletionDeliveries.where('noteId').equals(noteId).delete();
}

export async function deleteNoteWithTombstone(
  noteId: string,
  database: NotebookDB = db,
  recipients: DeletionRecipient[] = []
): Promise<Tombstone | null> {
  const uniqueRecipients = deduplicateRecipients(recipients);
  return database.transaction(
    'rw',
    database.notes,
    database.tombstones,
    database.deletionDeliveries,
    async () => {
      const note = await database.notes.get(noteId);
      if (!note) return null;

      const existingTombstone = await database.tombstones.get(noteId);
      if (existingTombstone) {
        await deleteDeliveriesForNoteOrDeletion(database, noteId, existingTombstone.deletionId);
      }

      const noteTime = Date.parse(note.updatedAt);
      const deletedAtMs = Number.isFinite(noteTime)
        ? Math.max(Date.now(), noteTime + 1)
        : Date.now();
      const trimmedTitle = note.title.trim();

      const tombstone: Tombstone = {
        noteId,
        ...(trimmedTitle ? { noteTitle: trimmedTitle } : {}),
        deletedAt: new Date(deletedAtMs).toISOString(),
        deletionId: crypto.randomUUID(),
        scope: 'local',
        deliveryFailures: 0,
      };
      await database.notes.delete(noteId);
      await database.tombstones.put(tombstone);

      const nowIso = new Date().toISOString();
      for (const recipient of uniqueRecipients) {
        await database.deletionDeliveries.put({
          id: deletionDeliveryKey(tombstone.deletionId, recipient.pairingId, recipient.peerId),
          noteId,
          deletionId: tombstone.deletionId,
          pairingId: recipient.pairingId,
          peerId: recipient.peerId,
          status: 'pending',
          updatedAt: nowIso,
        });
      }

      return tombstone;
    }
  );
}

export async function prepareDeletionDeliveries(
  tombstone: Tombstone,
  fallbackRecipients: DeletionRecipient[],
  database: NotebookDB = db
): Promise<DeletionDelivery[]> {
  const uniqueFallback = deduplicateRecipients(fallbackRecipients);
  return database.transaction(
    'rw',
    database.tombstones,
    database.deletionDeliveries,
    async () => {
      const current = await database.tombstones.get(tombstone.noteId);
      if (
        !current ||
        current.deletionId !== tombstone.deletionId ||
        current.scope !== 'local'
      ) {
        return [];
      }

      const existing = await database.deletionDeliveries
        .where('deletionId')
        .equals(tombstone.deletionId)
        .toArray();
      if (existing.length > 0) {
        return existing;
      }

      if (uniqueFallback.length === 0) {
        return [];
      }

      const nowIso = new Date().toISOString();
      const created: DeletionDelivery[] = uniqueFallback.map((recipient) => ({
        id: deletionDeliveryKey(tombstone.deletionId, recipient.pairingId, recipient.peerId),
        noteId: tombstone.noteId,
        deletionId: tombstone.deletionId,
        pairingId: recipient.pairingId,
        peerId: recipient.peerId,
        status: 'pending',
        updatedAt: nowIso,
      }));
      for (const record of created) {
        await database.deletionDeliveries.put(record);
      }
      return created;
    }
  );
}

export async function applyRemoteTombstone(
  incoming: RemoteTombstone,
  database: NotebookDB = db
): Promise<ApplyTombstoneResult> {
  const incomingTime = Date.parse(incoming.deletedAt);
  if (!Number.isFinite(incomingTime)) {
    return { outcome: 'invalid', removedNote: false };
  }

  return database.transaction(
    'rw',
    database.notes,
    database.tombstones,
    database.deletionDeliveries,
    async () => {
      const current = await database.tombstones.get(incoming.noteId);
      const note = await database.notes.get(incoming.noteId);
      const rawCurrentTime = current ? Date.parse(current.deletedAt) : Number.NEGATIVE_INFINITY;
      const currentTime = Number.isFinite(rawCurrentTime)
        ? rawCurrentTime
        : Number.NEGATIVE_INFINITY;

      const useIncoming =
        !current ||
        incomingTime > currentTime ||
        (incomingTime === currentTime && current.scope === 'local');

      const preservedTitle = note?.title.trim() || current?.noteTitle?.trim() || undefined;

      const effective: Tombstone = useIncoming
        ? {
            noteId: incoming.noteId,
            ...(preservedTitle ? { noteTitle: preservedTitle } : {}),
            deletedAt: incoming.deletedAt,
            deletionId: incoming.deletionId,
            scope: 'propagated',
            deliveryFailures:
              current && current.deletionId === incoming.deletionId
                ? current.deliveryFailures
                : 0,
          }
        : {
            ...current,
            ...(preservedTitle && !current.noteTitle ? { noteTitle: preservedTitle } : {}),
          };

      const effectiveTime = Date.parse(effective.deletedAt);
      const noteTime = note ? Date.parse(note.updatedAt) : Number.NEGATIVE_INFINITY;

      // Keep timestamp conflict resolution consistent: a strictly newer existing note
      // beats the effective deletion timestamp and must not keep a stale tombstone.
      if (note && Number.isFinite(noteTime) && noteTime > effectiveTime) {
        if (current) {
          await database.tombstones.delete(incoming.noteId);
          await deleteDeliveriesForNoteOrDeletion(database, incoming.noteId, current.deletionId);
        }
        return { outcome: 'superseded', removedNote: false };
      }

      if (current && current.deletionId !== effective.deletionId) {
        await deleteDeliveriesForNoteOrDeletion(database, incoming.noteId, current.deletionId);
      }

      await database.tombstones.put(effective);

      if (note && (!Number.isFinite(noteTime) || noteTime <= effectiveTime)) {
        await database.notes.delete(incoming.noteId);
        return { outcome: 'applied', removedNote: true };
      }
      return { outcome: 'applied', removedNote: false };
    }
  );
}

export async function persistIncomingNote(
  note: Note,
  allowLocalRestore: boolean,
  isStillAuthorized: () => boolean = () => true,
  database: NotebookDB = db
): Promise<IncomingNoteResult> {
  return database.transaction(
    'rw',
    database.notes,
    database.tombstones,
    database.deletionDeliveries,
    async () => {
      const tombstone = await database.tombstones.get(note.id);
      const existing = await database.notes.get(note.id);
      if (!isStillAuthorized()) return 'inactive';

      const incomingTime = Date.parse(note.updatedAt);
      if (!Number.isFinite(incomingTime)) {
        return 'blocked';
      }

      if (tombstone) {
        const tombstoneTime = Date.parse(tombstone.deletedAt);
        const isNewerThanTombstone =
          Number.isFinite(tombstoneTime) && incomingTime > tombstoneTime;
        const isExplicitLocalRestore =
          tombstone.scope === 'local' && allowLocalRestore;

        if (!isNewerThanTombstone && !isExplicitLocalRestore) {
          return 'blocked';
        }

        await database.tombstones.delete(note.id);
        await deleteDeliveriesForNoteOrDeletion(database, note.id, tombstone.deletionId);
      }

      const existingTime = existing ? Date.parse(existing.updatedAt) : Number.NEGATIVE_INFINITY;
      if (existing && Number.isFinite(existingTime) && incomingTime <= existingTime) {
        return 'unchanged';
      }

      await database.notes.put(note);
      return 'stored';
    }
  );
}

function areAttachmentsEqual(
  a: Note['attachments'],
  b: Note['attachments']
): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const entryA = a[key];
    const entryB = b[key];
    if (
      !entryB ||
      entryA.name !== entryB.name ||
      entryA.data !== entryB.data ||
      entryA.createdAt !== entryB.createdAt
    ) {
      return false;
    }
  }
  return true;
}

export async function updateNoteSafely(
  noteId: string,
  patch: Partial<Pick<Note, 'title' | 'content' | 'attachments'>>,
  database: NotebookDB = db
): Promise<LocalNoteUpdateResult> {
  // Precompute contentHash outside the IndexedDB rw transaction because SubtleCrypto
  // awaits would otherwise cause IndexedDB transactions to auto-commit in browsers.
  while (true) {
    const snapshot = await database.notes.get(noteId);
    if (!snapshot) return { status: 'missing' };

    const snapshotTombstone = await database.tombstones.get(noteId);
    if (snapshotTombstone) return { status: 'deleted' };

    const candidateContent = patch.content ?? snapshot.content;
    const candidateAttachments = patch.attachments ?? snapshot.attachments;
    const candidateHash = await computeContentHash(candidateContent, candidateAttachments);

    const txResult = await database.transaction(
      'rw',
      database.notes,
      database.tombstones,
      async () => {
        const current = await database.notes.get(noteId);
        if (!current) return { status: 'missing' as const };

        const tombstone = await database.tombstones.get(noteId);
        if (tombstone) return { status: 'deleted' as const };

        const finalContent = patch.content ?? current.content;
        const finalAttachments = patch.attachments ?? current.attachments;
        if (
          finalContent !== candidateContent ||
          !areAttachmentsEqual(finalAttachments, candidateAttachments)
        ) {
          return { status: 'retry' as const };
        }

        const currentTime = Date.parse(current.updatedAt);
        const nowMs = Date.now();
        const updatedAt = new Date(
          Number.isFinite(currentTime) ? Math.max(nowMs, currentTime + 1) : nowMs
        ).toISOString();

        const next: Note = {
          ...current,
          ...patch,
          content: finalContent,
          attachments: finalAttachments,
          updatedAt,
          contentHash: candidateHash,
        };
        await database.notes.put(next);
        return { status: 'saved' as const, note: next };
      }
    );

    if (txResult.status !== 'retry') {
      return txResult;
    }
  }
}

export async function updateTombstoneDelivery(
  tombstone: Tombstone,
  recipient: DeletionRecipient,
  result: 'accepted' | 'failed' | 'superseded',
  database: NotebookDB = db
): Promise<void> {
  await database.transaction(
    'rw',
    database.tombstones,
    database.deletionDeliveries,
    async () => {
      const current = await database.tombstones.get(tombstone.noteId);
      if (!current || current.deletionId !== tombstone.deletionId) return;

      const deliveryId = deletionDeliveryKey(
        tombstone.deletionId,
        recipient.pairingId,
        recipient.peerId
      );
      const existingDelivery = await database.deletionDeliveries.get(deliveryId);
      if (!existingDelivery || existingDelivery.status !== 'pending') {
        return;
      }

      await database.deletionDeliveries.put({
        ...existingDelivery,
        status: result,
        updatedAt: new Date().toISOString(),
      });

      const allDeliveries = await database.deletionDeliveries
        .where('deletionId')
        .equals(tombstone.deletionId)
        .toArray();
      const anyAccepted = allDeliveries.some((d) => d.status === 'accepted');
      const failedCount = allDeliveries.filter((d) => d.status === 'failed').length;

      await database.tombstones.put({
        ...current,
        scope: anyAccepted || current.scope === 'propagated' ? 'propagated' : 'local',
        deliveryFailures: failedCount,
      });
    }
  );
}

/**
 * Mark interrupted or stale pending deletion deliveries as failed without
 * introducing automatic retries or offline deletion queues.
 */
export async function reconcileInterruptedDeletionDeliveries(
  database: NotebookDB = db,
  maxUpdatedAtMs: number = Date.now() - STALE_PENDING_DELIVERY_MS
): Promise<number> {
  return database.transaction(
    'rw',
    database.tombstones,
    database.deletionDeliveries,
    async () => {
      const allDeliveries = await database.deletionDeliveries.toArray();
      const stalePending = allDeliveries.filter((delivery) => {
        if (delivery.status !== 'pending') return false;
        const updatedMs = Date.parse(delivery.updatedAt);
        return !Number.isFinite(updatedMs) || updatedMs <= maxUpdatedAtMs;
      });
      if (stalePending.length === 0) return 0;

      const nowIso = new Date().toISOString();
      const affectedNoteIds = new Set<string>();
      for (const delivery of stalePending) {
        await database.deletionDeliveries.put({
          ...delivery,
          status: 'failed',
          updatedAt: nowIso,
        });
        affectedNoteIds.add(delivery.noteId);
      }

      for (const noteId of affectedNoteIds) {
        const tombstone = await database.tombstones.get(noteId);
        if (!tombstone) continue;
        const forDeletion = await database.deletionDeliveries
          .where('deletionId')
          .equals(tombstone.deletionId)
          .toArray();
        const anyAccepted = forDeletion.some((d) => d.status === 'accepted');
        const failedCount = forDeletion.filter((d) => d.status === 'failed').length;
        await database.tombstones.put({
          ...tombstone,
          scope: anyAccepted || tombstone.scope === 'propagated' ? 'propagated' : 'local',
          deliveryFailures: failedCount,
        });
      }

      return stalePending.length;
    }
  );
}

export async function loadDeletionActivity(
  database: NotebookDB = db,
  stalePendingMs: number = STALE_PENDING_DELIVERY_MS
): Promise<DeletionActivityEntry[]> {
  await reconcileInterruptedDeletionDeliveries(database, Date.now() - stalePendingMs);

  const [tombstones, deliveries, pairings] = await Promise.all([
    database.tombstones.toArray(),
    database.deletionDeliveries.toArray(),
    database.pairings.toArray(),
  ]);

  const pairingNameMap = new Map(
    pairings.map((pairing) => [pairing.id, pairing.label.trim() || 'Paired device'])
  );
  const deliveriesByDeletion = new Map<string, DeletionDelivery[]>();
  for (const delivery of deliveries) {
    const existing = deliveriesByDeletion.get(delivery.deletionId);
    if (existing) existing.push(delivery);
    else deliveriesByDeletion.set(delivery.deletionId, [delivery]);
  }

  const sortedTombstones = [...tombstones].sort((a, b) => {
    const timeA = Date.parse(a.deletedAt);
    const timeB = Date.parse(b.deletedAt);
    return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
  });

  return sortedTombstones.map((tombstone) => {
    const rawDeliveries = deliveriesByDeletion.get(tombstone.deletionId) ?? [];
    const recipients: DeletionActivityRecipient[] = rawDeliveries
      .map((delivery) => {
        const knownName = pairingNameMap.get(delivery.pairingId);
        return {
          id: delivery.id,
          deviceName: knownName ?? 'Removed device',
          pairingMissing: knownName === undefined,
          status: delivery.status,
          updatedAt: delivery.updatedAt,
        };
      })
      .sort((a, b) => a.deviceName.localeCompare(b.deviceName));

    const origin: 'local' | 'remote' =
      recipients.length > 0 || tombstone.scope === 'local' ? 'local' : 'remote';

    return {
      id: tombstone.deletionId,
      noteTitle: tombstone.noteTitle?.trim() || 'Untitled',
      deletedAt: tombstone.deletedAt,
      origin,
      recipients,
    };
  });
}
