import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteNoteWithTombstone,
  updateNoteSafely,
  updateTombstoneDelivery,
} from '@/lib/tombstones';
import { db, DEFAULT_MODULE_ID, DEFAULT_MODULE_NAME, NotebookDB, seedIfEmpty } from '@/lib/db';

describe('NotebookDB schema migration', () => {
  afterEach(async () => {
    await Dexie.delete('NotebookDB');
  });

  it('upgrades a v1 database by adding tombstones and deletionDeliveries without losing existing notes', async () => {
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
    expect(upgraded.verno).toBe(4);
    const legacyNote = await upgraded.notes.get('legacy-note');
    expect(legacyNote?.content).toBe('Keep me');
    expect(legacyNote?.moduleId).toBe(DEFAULT_MODULE_ID);
    expect(legacyNote?.isArchived).toBe(false);
    expect(legacyNote?.isPinned).toBe(false);
    expect(await upgraded.modules.count()).toBe(1);
    expect((await upgraded.modules.get(DEFAULT_MODULE_ID))?.name).toBe(DEFAULT_MODULE_NAME);
    expect(await upgraded.tombstones.count()).toBe(0);
    expect(upgraded.tombstones.schema.primKey.name).toBe('noteId');
    expect(upgraded.tombstones.schema.indexes.map((index) => index.name)).toEqual([
      'deletionId',
      'deletedAt',
      'scope',
    ]);
    expect(await upgraded.deletionDeliveries.count()).toBe(0);
    expect(upgraded.deletionDeliveries.schema.primKey.name).toBe('id');
    expect(upgraded.deletionDeliveries.schema.indexes.map((index) => index.name)).toEqual([
      'deletionId',
      'noteId',
      '[pairingId+peerId]',
      'status',
    ]);
    upgraded.close();
  });

  it('upgrades a v2 database with existing tombstones and deliveryFailures safely to v3', async () => {
    const v2 = new Dexie('NotebookDB');
    v2.version(1).stores({
      notes: 'id, updatedAt, title',
      pairings: 'id, label, pairedAt',
    });
    v2.version(2).stores({
      notes: 'id, updatedAt, title',
      pairings: 'id, label, pairedAt',
      tombstones: 'noteId, &deletionId, deletedAt, scope',
    });
    await v2.open();
    await v2.table('notes').put({
      id: 'v2-note',
      title: 'V2 Note',
      content: 'Still here',
      attachments: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'v2-hash',
    });
    await v2.table('tombstones').bulkPut([
      {
        noteId: 'v2-deleted-valid',
        deletedAt: '2026-01-03T00:00:00.000Z',
        deletionId: 'del-v2-valid',
        scope: 'local',
        deliveryFailures: 2,
      },
      {
        noteId: 'v2-deleted-legacy',
        deletedAt: '2026-01-04T00:00:00.000Z',
        deletionId: 'del-v2-legacy',
      },
    ]);
    v2.close();

    const upgraded = new NotebookDB();
    await upgraded.open();
    expect(upgraded.verno).toBe(4);
    const v2Note = await upgraded.notes.get('v2-note');
    expect(v2Note?.content).toBe('Still here');
    expect(v2Note?.moduleId).toBe(DEFAULT_MODULE_ID);
    expect(await upgraded.modules.get(DEFAULT_MODULE_ID)).toBeDefined();
    expect(await upgraded.tombstones.get('v2-deleted-valid')).toEqual({
      noteId: 'v2-deleted-valid',
      deletedAt: '2026-01-03T00:00:00.000Z',
      deletionId: 'del-v2-valid',
      scope: 'local',
      deliveryFailures: 2,
    });
    expect(await upgraded.tombstones.get('v2-deleted-legacy')).toEqual({
      noteId: 'v2-deleted-legacy',
      deletedAt: '2026-01-04T00:00:00.000Z',
      deletionId: 'del-v2-legacy',
      scope: 'local',
      deliveryFailures: 0,
    });
    expect(await upgraded.deletionDeliveries.count()).toBe(0);
    upgraded.close();
  });

  it('upgrades a v3 database to v4 and assigns existing unassigned notes to the default module', async () => {
    const v3 = new Dexie('NotebookDB');
    v3.version(1).stores({
      notes: 'id, updatedAt, title',
      pairings: 'id, label, pairedAt',
    });
    v3.version(2).stores({
      notes: 'id, updatedAt, title',
      pairings: 'id, label, pairedAt',
      tombstones: 'noteId, &deletionId, deletedAt, scope',
    });
    v3.version(3).stores({
      notes: 'id, updatedAt, title',
      pairings: 'id, label, pairedAt',
      tombstones: 'noteId, &deletionId, deletedAt, scope',
      deletionDeliveries: 'id, deletionId, noteId, [pairingId+peerId], status',
    });
    await v3.open();
    await v3.table('notes').put({
      id: 'v3-orphan-note',
      title: 'Unassigned Note',
      content: 'Needs module assignment',
      attachments: {},
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
      contentHash: 'v3-hash',
    });
    v3.close();

    const v4 = new NotebookDB();
    await v4.open();
    expect(v4.verno).toBe(4);

    const migratedNote = await v4.notes.get('v3-orphan-note');
    expect(migratedNote).toBeDefined();
    expect(migratedNote?.title).toBe('Unassigned Note');
    expect(migratedNote?.content).toBe('Needs module assignment');
    expect(migratedNote?.moduleId).toBe(DEFAULT_MODULE_ID);
    expect(migratedNote?.isArchived).toBe(false);
    expect(migratedNote?.isPinned).toBe(false);

    const defaultModule = await v4.modules.get(DEFAULT_MODULE_ID);
    expect(defaultModule).toBeDefined();
    expect(defaultModule?.name).toBe(DEFAULT_MODULE_NAME);

    v4.close();
  });

  it('persists atomic local deletion tombstones and per-peer deliveries across database reopen', async () => {
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

    const tombstone = await deleteNoteWithTombstone('persistent-note', firstLoad, [
      { pairingId: 'room-1', peerId: 'peer-1' },
      { pairingId: 'room-1', peerId: 'peer-2' },
    ]);
    expect(tombstone).not.toBeNull();
    expect(tombstone?.noteTitle).toBe('Persistent');
    await updateTombstoneDelivery(
      tombstone!,
      { pairingId: 'room-1', peerId: 'peer-1' },
      'accepted',
      firstLoad
    );
    await updateTombstoneDelivery(
      tombstone!,
      { pairingId: 'room-1', peerId: 'peer-2' },
      'failed',
      firstLoad
    );
    expect(await firstLoad.notes.get('persistent-note')).toBeUndefined();
    const expectedTombstone = {
      ...tombstone!,
      scope: 'propagated' as const,
      deliveryFailures: 1,
    };
    expect(await firstLoad.tombstones.get('persistent-note')).toEqual(expectedTombstone);
    firstLoad.close();

    const reloaded = new NotebookDB();
    await reloaded.open();
    expect(await reloaded.notes.get('persistent-note')).toBeUndefined();
    expect(await reloaded.tombstones.get('persistent-note')).toEqual(expectedTombstone);
    const deliveries = await reloaded.deletionDeliveries
      .where('deletionId')
      .equals(tombstone!.deletionId)
      .toArray();
    expect(deliveries).toHaveLength(2);
    expect(deliveries.find((d) => d.peerId === 'peer-1')?.status).toBe('accepted');
    expect(deliveries.find((d) => d.peerId === 'peer-2')?.status).toBe('failed');
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

  it('prevents concurrent note updates from resurrecting deleted notes inside IndexedDB transactions', async () => {
    const database = new NotebookDB();
    await database.open();
    await database.notes.put({
      id: 'race-note',
      title: 'Race Note',
      content: 'Initial',
      attachments: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'initial-hash',
    });

    const [updateResult, tombstone] = await Promise.all([
      updateNoteSafely('race-note', { content: 'Delayed save' }, database),
      deleteNoteWithTombstone('race-note', database),
    ]);

    expect(tombstone).not.toBeNull();
    expect(['saved', 'missing', 'deleted']).toContain(updateResult.status);
    expect(await database.notes.get('race-note')).toBeUndefined();
    expect(await database.tombstones.get('race-note')).toEqual(tombstone);

    const lateSave = await updateNoteSafely('race-note', { content: 'Too late' }, database);
    expect(lateSave).toEqual({ status: 'missing' });
    expect(await database.notes.get('race-note')).toBeUndefined();
    database.close();
  });
});
