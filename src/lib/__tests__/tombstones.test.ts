import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotebookDB, type Note } from '@/lib/db';
import { MAX_FUTURE_CLOCK_SKEW_MS } from '@/lib/sync';
import {
  STALE_PENDING_DELIVERY_MS,
  applyRemoteTombstone,
  deleteNoteWithTombstone,
  deletionDeliveryKey,
  loadDeletionActivity,
  persistIncomingNote,
  reconcileInterruptedDeletionDeliveries,
  updateNoteSafely,
} from '@/lib/tombstones';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Test Note',
    content: 'Body',
    attachments: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    contentHash: 'hash-1',
    ...overrides,
  };
}

describe('tombstones and note persistence timestamp integrity', () => {
  let database: NotebookDB;
  const now = Date.UTC(2026, 10, 28, 12, 0, 0);

  beforeEach(async () => {
    await Dexie.delete('NotebookDB');
    database = new NotebookDB();
    await database.open();
  });

  afterEach(async () => {
    database.close();
    await Dexie.delete('NotebookDB');
  });

  it('rejects far-future and invalid remote tombstones without deleting existing notes or corrupting tombstones', async () => {
    const existingNote = makeNote({
      id: 'protected-note',
      updatedAt: new Date(now - 60_000).toISOString(),
    });
    await database.notes.put(existingNote);

    const existingTombstone = {
      noteId: 'deleted-note',
      noteTitle: 'Already Deleted',
      deletedAt: new Date(now - 120_000).toISOString(),
      deletionId: 'del-valid-existing',
      scope: 'propagated' as const,
      deliveryFailures: 0,
    };
    await database.tombstones.put(existingTombstone);

    const badTimestamps = [
      new Date(now + MAX_FUTURE_CLOCK_SKEW_MS + 1).toISOString(),
      '9999-12-31T23:59:59.999Z',
      '2026-01-01',
      '2026-02-30T00:00:00.000Z',
      '1969-12-31T23:59:59.999Z',
      'not-a-timestamp',
      '',
    ];

    for (const badDeletedAt of badTimestamps) {
      expect(
        await applyRemoteTombstone(
          {
            noteId: existingNote.id,
            deletedAt: badDeletedAt,
            deletionId: `bad-${badDeletedAt}`,
          },
          database,
          now
        )
      ).toEqual({ outcome: 'invalid', removedNote: false });

      expect(
        await applyRemoteTombstone(
          {
            noteId: existingTombstone.noteId,
            deletedAt: badDeletedAt,
            deletionId: `bad-overwrite-${badDeletedAt}`,
          },
          database,
          now
        )
      ).toEqual({ outcome: 'invalid', removedNote: false });
    }

    expect(await database.notes.get(existingNote.id)).toEqual(existingNote);
    expect(await database.tombstones.get(existingNote.id)).toBeUndefined();
    expect(await database.tombstones.get(existingTombstone.noteId)).toEqual(existingTombstone);
  });

  it('applies legitimate remote tombstones within allowed future clock skew and respects LWW against newer notes', async () => {
    const olderNote = makeNote({
      id: 'note-older',
      updatedAt: new Date(now - 60_000).toISOString(),
    });
    const skewNote = makeNote({
      id: 'note-even-newer',
      updatedAt: new Date(now + MAX_FUTURE_CLOCK_SKEW_MS).toISOString(),
    });
    await database.notes.bulkPut([olderNote, skewNote]);

    const skewDeleteAt = new Date(now + 60_000).toISOString();
    expect(
      await applyRemoteTombstone(
        { noteId: olderNote.id, deletedAt: skewDeleteAt, deletionId: 'del-skew-ok' },
        database,
        now
      )
    ).toEqual({ outcome: 'applied', removedNote: true });
    expect(await database.notes.get(olderNote.id)).toBeUndefined();
    expect(await database.tombstones.get(olderNote.id)).toMatchObject({
      deletionId: 'del-skew-ok',
      deletedAt: skewDeleteAt,
      scope: 'propagated',
    });

    // Note at +5min beats tombstone at +1min
    expect(
      await applyRemoteTombstone(
        { noteId: skewNote.id, deletedAt: skewDeleteAt, deletionId: 'del-superseded' },
        database,
        now
      )
    ).toEqual({ outcome: 'superseded', removedNote: false });
    expect(await database.notes.get(skewNote.id)).toEqual(skewNote);
    expect(await database.tombstones.get(skewNote.id)).toBeUndefined();
  });

  it('blocks incoming notes with far-future or invalid note/attachment timestamps even on local restore', async () => {
    const existingNote = makeNote({
      id: 'keep-local',
      content: 'Authentic local content',
      updatedAt: new Date(now - 60_000).toISOString(),
    });
    await database.notes.put(existingNote);

    const localTombstone = {
      noteId: 'keep-deleted',
      noteTitle: 'Deleted',
      deletedAt: new Date(now - 60_000).toISOString(),
      deletionId: 'del-local',
      scope: 'local' as const,
      deliveryFailures: 0,
    };
    await database.tombstones.put(localTombstone);

    const beyondSkew = new Date(now + MAX_FUTURE_CLOCK_SKEW_MS + 1).toISOString();
    const badCandidates: Note[] = [
      makeNote({ id: existingNote.id, content: 'Hijacked', updatedAt: beyondSkew }),
      makeNote({ id: existingNote.id, content: 'Hijacked', updatedAt: '9999-12-31T23:59:59.999Z' }),
      makeNote({ id: existingNote.id, content: 'Hijacked', createdAt: beyondSkew, updatedAt: new Date(now).toISOString() }),
      makeNote({
        id: existingNote.id,
        content: 'Hijacked',
        updatedAt: new Date(now).toISOString(),
        attachments: {
          att1: {
            name: 'img.png',
            data: 'data:image/png;base64,AAAA',
            createdAt: beyondSkew,
          },
        },
      }),
      makeNote({ id: existingNote.id, content: 'Bad format', updatedAt: '2026-01-01' }),
      makeNote({ id: localTombstone.noteId, content: 'Evil restore', updatedAt: '9999-12-31T23:59:59.999Z' }),
      makeNote({ id: 'brand-new-evil', content: 'Evil new', updatedAt: beyondSkew }),
    ];

    for (const candidate of badCandidates) {
      expect(await persistIncomingNote(candidate, false, () => true, database, now)).toBe('blocked');
      expect(await persistIncomingNote(candidate, true, () => true, database, now)).toBe('blocked');
    }

    expect(await database.notes.get(existingNote.id)).toEqual(existingNote);
    expect(await database.tombstones.get(localTombstone.noteId)).toEqual(localTombstone);
    expect(await database.notes.get('brand-new-evil')).toBeUndefined();

    // Legitimate incoming note within allowed clock skew still stores cleanly
    const legitSkewNote = makeNote({
      id: existingNote.id,
      content: 'Legit peer edit',
      updatedAt: new Date(now + 60_000).toISOString(),
    });
    expect(await persistIncomingNote(legitSkewNote, false, () => true, database, now)).toBe('stored');
    expect(await database.notes.get(existingNote.id)).toEqual(legitSkewNote);
  });

  it('maintains local monotonic timestamps within skew and heals poisoned far-future timestamps safely', async () => {
    const sameMsNote = makeNote({
      id: 'monotonic-note',
      updatedAt: new Date(now).toISOString(),
    });
    const slightlyFutureNote = makeNote({
      id: 'skew-note',
      updatedAt: new Date(now + 60_000).toISOString(),
    });
    const poisonedNote = makeNote({
      id: 'poisoned-9999',
      updatedAt: '9999-12-31T23:59:59.999Z',
    });
    const maxDateNote = makeNote({
      id: 'poisoned-max-date',
      updatedAt: new Date(8_640_000_000_000_000).toISOString(),
    });
    await database.notes.bulkPut([sameMsNote, slightlyFutureNote, poisonedNote, maxDateNote]);

    const updatedSameMs = await updateNoteSafely(sameMsNote.id, { content: 'Edit 1' }, database, now);
    expect(updatedSameMs.status).toBe('saved');
    if (updatedSameMs.status === 'saved') {
      expect(Date.parse(updatedSameMs.note.updatedAt)).toBe(now + 1);
    }

    const updatedSkew = await updateNoteSafely(slightlyFutureNote.id, { content: 'Edit 2' }, database, now);
    expect(updatedSkew.status).toBe('saved');
    if (updatedSkew.status === 'saved') {
      expect(Date.parse(updatedSkew.note.updatedAt)).toBe(now + 60_001);
    }

    // Poisoned 9999 and max-Date notes do not perpetuate far-future timestamps or throw RangeError
    const healedPoisoned = await updateNoteSafely(poisonedNote.id, { content: 'Healed' }, database, now);
    expect(healedPoisoned.status).toBe('saved');
    if (healedPoisoned.status === 'saved') {
      expect(Date.parse(healedPoisoned.note.updatedAt)).toBe(now);
    }

    const deletedMax = await deleteNoteWithTombstone(maxDateNote.id, database, [], now);
    expect(deletedMax).not.toBeNull();
    expect(Date.parse(deletedMax!.deletedAt)).toBe(now);

    const deletedSkew = await deleteNoteWithTombstone(slightlyFutureNote.id, database, [], now);
    expect(deletedSkew).not.toBeNull();
    expect(Date.parse(deletedSkew!.deletedAt)).toBe(now + 60_002);
  });

  it('reconciles pending deletion deliveries with far-future timestamps and avoids pinning far-future deletions at the top of activity', async () => {
    const farFutureIso = '9999-12-31T23:59:59.999Z';
    const validRecentIso = new Date(now - 5_000).toISOString();

    await database.pairings.put({
      id: 'pair-1',
      label: 'Phone',
      pairedAt: '2026-01-01T00:00:00.000Z',
    });

    await database.tombstones.bulkPut([
      {
        noteId: 'n-poisoned',
        noteTitle: 'Poisoned Deletion',
        deletedAt: farFutureIso,
        deletionId: 'del-poisoned',
        scope: 'local',
        deliveryFailures: 0,
      },
      {
        noteId: 'n-valid',
        noteTitle: 'Valid Recent Deletion',
        deletedAt: validRecentIso,
        deletionId: 'del-valid',
        scope: 'local',
        deliveryFailures: 0,
      },
    ]);

    const poisonedDeliveryId = deletionDeliveryKey('del-poisoned', 'pair-1', 'peer-1');
    const validDeliveryId = deletionDeliveryKey('del-valid', 'pair-1', 'peer-1');
    await database.deletionDeliveries.bulkPut([
      {
        id: poisonedDeliveryId,
        noteId: 'n-poisoned',
        deletionId: 'del-poisoned',
        pairingId: 'pair-1',
        peerId: 'peer-1',
        status: 'pending',
        updatedAt: farFutureIso,
      },
      {
        id: validDeliveryId,
        noteId: 'n-valid',
        deletionId: 'del-valid',
        pairingId: 'pair-1',
        peerId: 'peer-1',
        status: 'pending',
        updatedAt: validRecentIso,
      },
    ]);

    const reconciled = await reconcileInterruptedDeletionDeliveries(
      database,
      now - STALE_PENDING_DELIVERY_MS,
      now
    );
    expect(reconciled).toBe(1);
    expect((await database.deletionDeliveries.get(poisonedDeliveryId))?.status).toBe('failed');
    expect((await database.deletionDeliveries.get(validDeliveryId))?.status).toBe('pending');
    expect((await database.tombstones.get('n-poisoned'))?.deliveryFailures).toBe(1);

    const activity = await loadDeletionActivity(database, STALE_PENDING_DELIVERY_MS, now);
    expect(activity.map((entry) => entry.noteTitle)).toEqual([
      'Valid Recent Deletion',
      'Poisoned Deletion',
    ]);
  });
});
