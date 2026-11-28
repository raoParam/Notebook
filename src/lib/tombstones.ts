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
import {
  MAX_FUTURE_CLOCK_SKEW_MS,
  hasTrustedNoteTimestamps,
  parseStrictIsoTimestampMs,
  parseTrustedTimestampMs,
} from './sync';

export const STALE_PENDING_DELIVERY_MS = 20_000;

function resolveNowMs(now?: number): number {
  return now !== undefined && Number.isFinite(now) ? now : Date.now();
}

/**
 * Compute a monotonic local timestamp bounded by the trusted future clock-skew window.
 * Ignores invalid or far-future previous timestamps so poisoned values cannot be
 * perpetuated across edits/deletes or cause Date overflow.
 */
function computeLocalMonotonicTimestampMs(
  nowMs: number,
  ...previousTimes: Array<number | null>
): number {
  const maxAllowedMs = nowMs + MAX_FUTURE_CLOCK_SKEW_MS;
  let nextMs = nowMs;
  for (const prev of previousTimes) {
    if (prev !== null && Number.isFinite(prev) && prev <= maxAllowedMs) {
      nextMs = Math.max(nextMs, prev + 1);
    }
  }
  return Math.min(nextMs, maxAllowedMs);
}

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
  recipients: DeletionRecipient[] = [],
  now?: number
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

      const nowMs = resolveNowMs(now);
      const deletedAtMs = computeLocalMonotonicTimestampMs(
        nowMs,
        parseStrictIsoTimestampMs(note.updatedAt),
        existingTombstone ? parseStrictIsoTimestampMs(existingTombstone.deletedAt) : null
      );
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

      const nowIso = new Date(nowMs).toISOString();
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
  database: NotebookDB = db,
  now: number = Date.now()
): Promise<ApplyTombstoneResult> {
  const nowMs = resolveNowMs(now);
  const incomingTime = parseTrustedTimestampMs(incoming.deletedAt, nowMs);
  if (incomingTime === null) {
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
      const rawCurrentTime = current
        ? parseTrustedTimestampMs(current.deletedAt, nowMs)
        : null;
      const currentTime = rawCurrentTime ?? Number.NEGATIVE_INFINITY;

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

      const effectiveTime =
        parseTrustedTimestampMs(effective.deletedAt, nowMs) ?? incomingTime;
      const noteTime = note ? parseTrustedTimestampMs(note.updatedAt, nowMs) : null;

      // Keep timestamp conflict resolution consistent: a strictly newer existing note
      // beats the effective deletion timestamp and must not keep a stale tombstone.
      if (note && noteTime !== null && noteTime > effectiveTime) {
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

      if (note && (noteTime === null || noteTime <= effectiveTime)) {
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
  database: NotebookDB = db,
  now: number = Date.now()
): Promise<IncomingNoteResult> {
  const nowMs = resolveNowMs(now);
  return database.transaction(
    'rw',
    database.notes,
    database.tombstones,
    database.deletionDeliveries,
    async () => {
      const tombstone = await database.tombstones.get(note.id);
      const existing = await database.notes.get(note.id);
      if (!isStillAuthorized()) return 'inactive';

      if (!hasTrustedNoteTimestamps(note, nowMs)) {
        return 'blocked';
      }
      const incomingTime = parseTrustedTimestampMs(note.updatedAt, nowMs);
      if (incomingTime === null) {
        return 'blocked';
      }

      if (tombstone) {
        const tombstoneTime = parseTrustedTimestampMs(tombstone.deletedAt, nowMs);
        const isNewerThanTombstone =
          tombstoneTime !== null && incomingTime > tombstoneTime;
        const isExplicitLocalRestore =
          tombstone.scope === 'local' && allowLocalRestore;

        if (!isNewerThanTombstone && !isExplicitLocalRestore) {
          return 'blocked';
        }

        await database.tombstones.delete(note.id);
        await deleteDeliveriesForNoteOrDeletion(database, note.id, tombstone.deletionId);
      }

      const existingTime = existing
        ? parseStrictIsoTimestampMs(existing.updatedAt)
        : null;
      if (existing && existingTime !== null && incomingTime <= existingTime) {
        return 'unchanged';
      }

      const noteToStore: Note = {
        ...note,
        ...(existing?.moduleId && !note.moduleId ? { moduleId: existing.moduleId } : {}),
        ...(existing?.isArchived !== undefined && note.isArchived === undefined ? { isArchived: existing.isArchived } : {}),
        ...(existing?.isPinned !== undefined && note.isPinned === undefined ? { isPinned: existing.isPinned } : {}),
      };
      await database.notes.put(noteToStore);
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
  database: NotebookDB = db,
  now?: number
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

        const nowMs = resolveNowMs(now);
        const updatedAtMs = computeLocalMonotonicTimestampMs(
          nowMs,
          parseStrictIsoTimestampMs(current.updatedAt)
        );
        const updatedAt = new Date(updatedAtMs).toISOString();

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
  maxUpdatedAtMs?: number,
  now?: number
): Promise<number> {
  const nowMs = resolveNowMs(now);
  const cutoffMs =
    maxUpdatedAtMs !== undefined && Number.isFinite(maxUpdatedAtMs)
      ? maxUpdatedAtMs
      : nowMs - STALE_PENDING_DELIVERY_MS;
  return database.transaction(
    'rw',
    database.tombstones,
    database.deletionDeliveries,
    async () => {
      const allDeliveries = await database.deletionDeliveries.toArray();
      const stalePending = allDeliveries.filter((delivery) => {
        if (delivery.status !== 'pending') return false;
        const updatedMs = parseTrustedTimestampMs(delivery.updatedAt, nowMs);
        return updatedMs === null || updatedMs <= cutoffMs;
      });
      if (stalePending.length === 0) return 0;

      const nowIso = new Date(nowMs).toISOString();
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
  stalePendingMs: number = STALE_PENDING_DELIVERY_MS,
  now?: number
): Promise<DeletionActivityEntry[]> {
  const nowMs = resolveNowMs(now);
  await reconcileInterruptedDeletionDeliveries(database, nowMs - stalePendingMs, nowMs);

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
    const timeA = parseTrustedTimestampMs(a.deletedAt, nowMs) ?? 0;
    const timeB = parseTrustedTimestampMs(b.deletedAt, nowMs) ?? 0;
    return timeB - timeA;
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
