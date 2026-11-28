'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db, type DeletionRecipient, type Note, type Tombstone } from '@/lib/db';
import { computeContentHash } from '@/lib/hash';
import { deleteNoteWithTombstone, updateNoteSafely } from '@/lib/tombstones';

export type SortOrder = 'lastChange' | 'ascending' | 'descending';

function isSortOrder(value: string | null): value is SortOrder {
  return value === 'lastChange' || value === 'ascending' || value === 'descending';
}

function sortNotes(notes: Note[], order: SortOrder): Note[] {
  const copy = [...notes];
  if (order === 'ascending') {
    return copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }
  if (order === 'descending') {
    return copy.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
  }
  return copy.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('lastChange');
  const [isLoaded, setIsLoaded] = useState(false);
  const activeIdRef = useRef<string | null>(null);

  const updateActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const reload = useCallback(async () => {
    const all = await db.notes.toArray();
    setNotes(all);
  }, []);

  useEffect(() => {
    (async () => {
      const { seedIfEmpty } = await import('@/lib/db');
      await seedIfEmpty();
      const all = await db.notes.toArray();
      setNotes(all);

      try {
        const lastId = localStorage.getItem('nb-active-id');
        if (lastId && all.some((n) => n.id === lastId)) {
          updateActiveId(lastId);
        } else if (all.length > 0) {
          updateActiveId(all[0].id);
        }
        const savedSort = localStorage.getItem('nb-sort');
        if (isSortOrder(savedSort)) setSortOrder(savedSort);
      } catch {}

      setIsLoaded(true);
    })();
  }, [updateActiveId]);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeId) ?? null,
    [notes, activeId]
  );
  const sortedNotes = useMemo(() => sortNotes(notes, sortOrder), [notes, sortOrder]);

  const selectNote = useCallback((id: string) => {
    updateActiveId(id);
    try { localStorage.setItem('nb-active-id', id); } catch {}
  }, [updateActiveId]);

  const createAndSelectNote = useCallback(
    async (title: string, content: string) => {
      const now = new Date().toISOString();
      const attachments = {};
      const contentHash = await computeContentHash(content, attachments);
      const note: Note = {
        id: crypto.randomUUID(),
        title,
        content,
        attachments,
        createdAt: now,
        updatedAt: now,
        contentHash,
      };
      await db.notes.add(note);
      await reload();
      updateActiveId(note.id);
      try { localStorage.setItem('nb-active-id', note.id); } catch {}
      return note.id;
    },
    [reload, updateActiveId]
  );

  const addNote = useCallback(() => createAndSelectNote('', ''), [createAndSelectNote]);

  const deleteNote = useCallback(
    async (id: string, recipients?: DeletionRecipient[]): Promise<Tombstone | null> => {
      const tombstone = await deleteNoteWithTombstone(id, db, recipients);
      if (!tombstone) return null;
      const remaining = await db.notes.toArray();
      setNotes(remaining);
      if (activeIdRef.current === id) {
        const newActive = remaining[0]?.id ?? null;
        updateActiveId(newActive);
        try { localStorage.setItem('nb-active-id', newActive ?? ''); } catch {}
      }
      return tombstone;
    },
    [updateActiveId]
  );

  const updateNote = useCallback(
    async (id: string, patch: Partial<Pick<Note, 'title' | 'content' | 'attachments'>>) => {
      const result = await updateNoteSafely(id, patch, db);
      if (result.status !== 'saved') return;
      setNotes((prev) => prev.map((n) => (n.id === id ? result.note : n)));
    },
    []
  );

  const changeSortOrder = useCallback((order: SortOrder) => {
    setSortOrder(order);
    try { localStorage.setItem('nb-sort', order); } catch {}
  }, []);

  const importNote = useCallback(
    (title: string, content: string) => createAndSelectNote(title, content),
    [createAndSelectNote]
  );

  return {
    notes: sortedNotes,
    activeNote,
    activeId,
    sortOrder,
    isLoaded,
    selectNote,
    addNote,
    deleteNote,
    updateNote,
    changeSortOrder,
    importNote,
    reload,
  };
}
