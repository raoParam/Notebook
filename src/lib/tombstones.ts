import { db, type Note, type NotebookDB, type Tombstone } from './db';

export type RemoteTombstone = Pick<Tombstone, 'noteId' | 'deletedAt' | 'deletionId'>;
export type IncomingNoteResult = 'stored' | 'unchanged' | 'blocked' | 'inactive';

export async function deleteNoteWithTombstone(
  noteId: string,
  database: NotebookDB = db
): Promise<Tombstone | null> {
  return database.transaction('rw', database.notes, database.tombstones, async () => {
    const note = await database.notes.get(noteId);
    if (!note) return null;

    const tombstone: Tombstone = {
      noteId,
      deletedAt: new Date().toISOString(),
      deletionId: crypto.randomUUID(),
      scope: 'local',
      deliveryFailures: 0,
    };
    await database.notes.delete(noteId);
    await database.tombstones.put(tombstone);
    return tombstone;
  });
}

export async function applyRemoteTombstone(
  incoming: RemoteTombstone,
  database: NotebookDB = db
): Promise<boolean> {
  return database.transaction('rw', database.notes, database.tombstones, async () => {
    const current = await database.tombstones.get(incoming.noteId);
    const currentTime = current ? Date.parse(current.deletedAt) : Number.NEGATIVE_INFINITY;
    const incomingTime = Date.parse(incoming.deletedAt);
    const useIncoming =
      !current ||
      incomingTime > currentTime ||
      (incomingTime === currentTime && current.scope === 'local');
    const effective: Tombstone = useIncoming
      ? {
          ...incoming,
          scope: 'propagated',
          deliveryFailures: current?.deliveryFailures ?? 0,
        }
      : { ...current, scope: 'propagated' };

    await database.tombstones.put(effective);

    const note = await database.notes.get(incoming.noteId);
    if (note && Date.parse(note.updatedAt) <= Date.parse(effective.deletedAt)) {
      await database.notes.delete(incoming.noteId);
      return true;
    }
    return false;
  });
}

export async function persistIncomingNote(
  note: Note,
  allowLocalRestore: boolean,
  isStillAuthorized: () => boolean = () => true,
  database: NotebookDB = db
): Promise<IncomingNoteResult> {
  return database.transaction('rw', database.notes, database.tombstones, async () => {
    const tombstone = await database.tombstones.get(note.id);
    const existing = await database.notes.get(note.id);
    if (!isStillAuthorized()) return 'inactive';
    if (tombstone?.scope === 'propagated') return 'blocked';
    if (tombstone?.scope === 'local' && !allowLocalRestore) return 'blocked';
    if (tombstone?.scope === 'local' && allowLocalRestore) {
      await database.tombstones.delete(note.id);
    }

    const incomingTime = Date.parse(note.updatedAt);
    const existingTime = existing ? Date.parse(existing.updatedAt) : Number.NEGATIVE_INFINITY;
    if (existing && Number.isFinite(existingTime) && incomingTime <= existingTime) {
      return 'unchanged';
    }

    await database.notes.put(note);
    return 'stored';
  });
}

export async function updateTombstoneDelivery(
  tombstone: Tombstone,
  result: 'accepted' | 'failed',
  database: NotebookDB = db
): Promise<void> {
  await database.transaction('rw', database.tombstones, async () => {
    const current = await database.tombstones.get(tombstone.noteId);
    if (!current || current.deletionId !== tombstone.deletionId) return;
    await database.tombstones.put({
      ...current,
      ...(result === 'accepted' ? { scope: 'propagated' as const } : {}),
      ...(result === 'failed' ? { deliveryFailures: current.deliveryFailures + 1 } : {}),
    });
  });
}
