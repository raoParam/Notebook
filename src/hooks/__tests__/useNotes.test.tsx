// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type Note } from '@/lib/db';
import { computeContentHash } from '@/lib/hash';
import { persistIncomingNote } from '@/lib/tombstones';
import { useNotes } from '@/hooks/useNotes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type UseNotesApi = ReturnType<typeof useNotes>;

async function mountUseNotes(): Promise<{
  api: () => UseNotesApi;
  unmount: () => Promise<void>;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let latest!: UseNotesApi;

  function Harness() {
    latest = useNotes();
    return null;
  }

  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<Harness />);
  });

  // Wait for initial seed/load effect
  for (let i = 0; i < 20 && !latest.isLoaded; i++) {
    await act(async () => {
      await new Promise((res) => setTimeout(res, 10));
    });
  }

  return {
    api: () => latest,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('useNotes local save/delete race protection', () => {
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    window.localStorage.clear();
    db.close();
    await Dexie.delete('NotebookDB');
    await db.open();
  });

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
    vi.restoreAllMocks();
    db.close();
    await Dexie.delete('NotebookDB');
  });

  it('performs normal saves with updated timestamps and contentHash', async () => {
    const mounted = await mountUseNotes();
    cleanups.push(mounted.unmount);

    let noteId = '';
    await act(async () => {
      noteId = await mounted.api().addNote();
    });
    const before = await db.notes.get(noteId);
    expect(before).toBeDefined();

    await act(async () => {
      await mounted.api().updateNote(noteId, {
        title: 'Updated Title',
        content: 'Updated Body',
      });
    });

    const after = await db.notes.get(noteId);
    expect(after).toBeDefined();
    expect(after?.title).toBe('Updated Title');
    expect(after?.content).toBe('Updated Body');
    expect(after?.contentHash).toBe(await computeContentHash('Updated Body', {}));
    expect(Date.parse(after!.updatedAt)).toBeGreaterThan(Date.parse(before!.updatedAt));
    expect(mounted.api().notes.find((n) => n.id === noteId)?.content).toBe('Updated Body');
  });

  it('does not allow a delayed save racing with deletion to resurrect a deleted note', async () => {
    const mounted = await mountUseNotes();
    cleanups.push(mounted.unmount);

    let noteId = '';
    await act(async () => {
      noteId = await mounted.api().addNote();
    });

    // Delay computeContentHash during updateNote so deleteNote runs mid-save
    const realDigest = crypto.subtle.digest.bind(crypto.subtle);
    let releaseDigest!: () => void;
    const digestGate = new Promise<void>((resolve) => {
      releaseDigest = resolve;
    });
    const digestSpy = vi
      .spyOn(crypto.subtle, 'digest')
      .mockImplementationOnce(async (algorithm, data) => {
        await digestGate;
        return realDigest(algorithm, data);
      });

    let pendingSave!: Promise<void>;
    await act(async () => {
      pendingSave = mounted.api().updateNote(noteId, {
        title: 'Delayed Title',
        content: 'Delayed Save Must Not Resurrect',
      });
      await Promise.resolve();
    });

    // Delete the note while updateNote is in-flight
    let tombstone = null;
    await act(async () => {
      tombstone = await mounted.api().deleteNote(noteId);
    });
    expect(tombstone).not.toBeNull();
    expect(await db.notes.get(noteId)).toBeUndefined();

    // Release delayed save -> transaction re-reads & sees note gone + tombstone present
    releaseDigest();
    await act(async () => {
      await pendingSave;
    });

    expect(await db.notes.get(noteId)).toBeUndefined();
    expect(await db.tombstones.get(noteId)).toEqual(tombstone);
    expect(mounted.api().notes.some((n) => n.id === noteId)).toBe(false);
    digestSpy.mockRestore();
  });

  it('safely ignores updates to missing or deleted notes and preserves manual restore flow', async () => {
    const mounted = await mountUseNotes();
    cleanups.push(mounted.unmount);

    // Updating a nonexistent note ID is a safe no-op
    await act(async () => {
      await mounted.api().updateNote('missing-note-id', {
        title: 'Ghost',
        content: 'Should not exist',
      });
    });
    expect(await db.notes.get('missing-note-id')).toBeUndefined();

    // Create, edit, and delete a note -> subsequent delayed save is ignored
    let noteId = '';
    await act(async () => {
      noteId = await mounted.api().addNote();
      await mounted.api().updateNote(noteId, {
        title: 'Saved Before Delete',
        content: 'Original body',
      });
    });
    const savedBeforeDelete = (await db.notes.get(noteId)) as Note;

    await act(async () => {
      await mounted.api().deleteNote(noteId);
      await mounted.api().updateNote(noteId, {
        title: 'Late Save',
        content: 'Late edit after deletion',
      });
    });
    expect(await db.notes.get(noteId)).toBeUndefined();
    expect((await db.tombstones.get(noteId))?.scope).toBe('local');

    // Manual restore of local-only tombstone still works cleanly
    const restoredResult = await persistIncomingNote(savedBeforeDelete, true);
    expect(restoredResult).toBe('stored');
    await act(async () => {
      await mounted.api().reload();
    });
    expect(await db.tombstones.get(noteId)).toBeUndefined();
    expect(mounted.api().notes.find((n) => n.id === noteId)?.content).toBe('Original body');
  });
});
