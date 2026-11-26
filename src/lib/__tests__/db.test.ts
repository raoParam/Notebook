import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteNoteWithTombstone } from '@/lib/tombstones';
import { db, NotebookDB, seedIfEmpty } from '@/lib/db';

describe('NotebookDB schema migration', () => {
  afterEach(async () => {
    await Dexie.delete('NotebookDB');
  });

  it('upgrades a v1 database by adding tombstones without losing existing notes', async () => {
    const legacy = new Dexie('NotebookDB');
    legacy.version(1).stores({
      notes: 'id, updatedAt, title',
      pairings: 'id, label, pairedAt',
    });
    await legacy.open();
    await legacy.table('notes').put({
      id: 'legacy-note',
      title: 'Legacy',
      content: 'Keep me',
      attachments: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'legacy-hash',
    });
    legacy.close();

    const upgraded = new NotebookDB();
    await upgraded.open();
    expect(upgraded.verno).toBe(2);
    expect((await upgraded.notes.get('legacy-note'))?.content).toBe('Keep me');
    expect(await upgraded.tombstones.count()).toBe(0);
    expect(upgraded.tombstones.schema.primKey.name).toBe('noteId');
    expect(upgraded.tombstones.schema.indexes.map((index) => index.name)).toEqual([
      'deletionId',
      'deletedAt',
      'scope',
    ]);
    upgraded.close();
  });

  it('persists atomic local deletion tombstones across database reopen', async () => {
    const firstLoad = new NotebookDB();
    await firstLoad.open();
    await firstLoad.notes.put({
      id: 'persistent-note',
      title: 'Persistent',
      content: 'Delete this',
      attachments: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'persistent-hash',
    });

    const tombstone = await deleteNoteWithTombstone('persistent-note', firstLoad);
    expect(await firstLoad.notes.get('persistent-note')).toBeUndefined();
    expect(await firstLoad.tombstones.get('persistent-note')).toEqual(tombstone);
    firstLoad.close();

    const reloaded = new NotebookDB();
    await reloaded.open();
    expect(await reloaded.notes.get('persistent-note')).toBeUndefined();
    expect(await reloaded.tombstones.get('persistent-note')).toEqual(tombstone);
    reloaded.close();
  });

  it('does not reseed a welcome note whose ID has a tombstone', async () => {
    const database = new NotebookDB();
    await database.open();
    await database.tombstones.put({
      noteId: 'welcome-note-default-id',
      deletedAt: '2026-01-02T00:00:00.000Z',
      deletionId: 'deleted-welcome',
      scope: 'local',
      deliveryFailures: 0,
    });
    database.close();

    await seedIfEmpty();

    expect(await db.notes.get('welcome-note-default-id')).toBeUndefined();
    db.close();
  });
});
