'use client';

import { useCallback, useEffect, useState } from 'react';
import { db, type Note } from '@/lib/db';
import { computeContentHash } from '@/lib/hash';

export type SortOrder = 'lastChange' | 'ascending' | 'descending';

function sortNotes(notes: Note[], order: SortOrder): Note[] {
  const copy = [...notes];
  if (order === 'ascending') {
    return copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }
  if (order === 'descending') {
    return copy.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
  }
  // lastChange
  return copy.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('lastChange');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load notes from IndexedDB
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

      // Restore last active note from localStorage
      try {
        const lastId = localStorage.getItem('nb-active-id');
        if (lastId && all.some((n) => n.id === lastId)) {
          setActiveId(lastId);
        } else if (all.length > 0) {
          setActiveId(all[0].id);
        }
        const savedSort = localStorage.getItem('nb-sort') as SortOrder | null;
        if (savedSort) setSortOrder(savedSort);
      } catch {}

      setIsLoaded(true);
    })();
  }, []);

  const activeNote = notes.find((n) => n.id === activeId) ?? null;
  const sortedNotes = sortNotes(notes, sortOrder);

  const selectNote = useCallback((id: string) => {
    setActiveId(id);
    try { localStorage.setItem('nb-active-id', id); } catch {}
  }, []);

  const addNote = useCallback(async () => {
    const now = new Date().toISOString();
    const attachments = {};
    const contentHash = await computeContentHash('', attachments);
    const note: Note = {
      id: crypto.randomUUID(),
      title: '',
      content: '',
      attachments,
      createdAt: now,
      updatedAt: now,
      contentHash,
    };
    await db.notes.add(note);
    await reload();
    setActiveId(note.id);
    try { localStorage.setItem('nb-active-id', note.id); } catch {}
    return note.id;
  }, [reload]);

  const deleteNote = useCallback(async (id: string) => {
    await db.notes.delete(id);
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (activeId === id) {
        const newActive = next.length > 0 ? next[0].id : null;
        setActiveId(newActive);
        try { localStorage.setItem('nb-active-id', newActive ?? ''); } catch {}
      }
      return next;
    });
  }, [activeId]);

  const updateNote = useCallback(
    async (id: string, patch: Partial<Pick<Note, 'title' | 'content' | 'attachments'>>) => {
      const existing = await db.notes.get(id);
      if (!existing) return;
      const next: Note = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      next.contentHash = await computeContentHash(
        next.content,
        next.attachments
      );
      await db.notes.put(next);
      setNotes((prev) => prev.map((n) => (n.id === id ? next : n)));
    },
    []
  );

  const changeSortOrder = useCallback((order: SortOrder) => {
    setSortOrder(order);
    try { localStorage.setItem('nb-sort', order); } catch {}
  }, []);

  const importNote = useCallback(async (title: string, content: string) => {
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
    setActiveId(note.id);
    try { localStorage.setItem('nb-active-id', note.id); } catch {}
    return note.id;
  }, [reload]);

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
