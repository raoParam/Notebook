'use client';

import React, { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Module, Notebook } from '@/types/workspace';
import {
  createNotebookInModule,
  deleteNotebook,
  getModuleBySlugOrId,
  getModules,
  getNotebooksByModule,
  getNotebookSlug,
  moveNotebookToModule,
  recordModuleOpen,
  renameNotebook,
} from '@/lib/workspace';
import { SearchInput } from '@/components/ui/SearchInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { FocusStyles } from '@/components/ui/focus-styles';
import {
  CreateNotebookDialog,
  DeleteNotebookDialog,
  ModuleHeader,
  MoveNotebookDialog,
  NotebookCard,
  NotebookDocumentIcon,
  RenameNotebookDialog,
  stripMarkdown,
} from '@/components/module-detail';

export type SortMode = 'updated' | 'title-asc' | 'title-desc' | 'created';

interface PageProps {
  params: Promise<{ moduleSlug: string }>;
}

export default function ModuleDetailPage({ params }: PageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const rawSlug = resolvedParams?.moduleSlug || '';
  const decodedSlug = decodeURIComponent(rawSlug);

  // Core Data State
  const [module, setModule] = useState<Module | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [allModules, setAllModules] = useState<Module[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filter & Sort State
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');

  // Dialog States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [renamingNotebook, setRenamingNotebook] = useState<Notebook | null>(null);
  const [movingNotebook, setMovingNotebook] = useState<Notebook | null>(null);
  const [deletingNotebook, setDeletingNotebook] = useState<Notebook | null>(null);

  // Load Module and its Notebooks
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!decodedSlug) {
        setIsLoading(false);
        return;
      }
      try {
        const foundModule = await getModuleBySlugOrId(decodedSlug);
        if (cancelled) return;
        if (!foundModule) {
          setModule(null);
          setNotebooks([]);
          return;
        }
        setModule(foundModule);
        recordModuleOpen(foundModule.id);
        const [fetchedNotebooks, fetchedModules] = await Promise.all([
          getNotebooksByModule(foundModule.id),
          getModules(false),
        ]);
        if (cancelled) return;
        setNotebooks(fetchedNotebooks);
        setAllModules(fetchedModules);
      } catch (err) {
        console.error('Failed to load module data:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decodedSlug]);

  // Handle Refreshing Notebooks after mutation
  const refreshNotebooks = async (moduleId: string) => {
    try {
      const updated = await getNotebooksByModule(moduleId);
      setNotebooks(updated);
    } catch (err) {
      console.error('Failed to refresh notebooks:', err);
    }
  };

  // Actions
  const handleOpenNotebook = (notebookId: string) => {
    const modSlug = module?.slug || module?.id || decodedSlug;
    const nb = notebooks.find((n) => n.id === notebookId);
    const nbSlug = nb ? getNotebookSlug(nb) : notebookId;
    router.push(`/${modSlug}/${nbSlug}`);
  };

  const handleCreateNotebook = async (title: string) => {
    if (!module) return;
    const newNote = await createNotebookInModule(module.id, {
      title: title.trim(),
    });
    const modSlug = module.slug || module.id || decodedSlug;
    const nbSlug = getNotebookSlug(newNote);
    router.push(`/${modSlug}/${nbSlug}`);
  };

  const handleSaveRename = async (notebookId: string, newTitle: string) => {
    if (!module) return;
    await renameNotebook(notebookId, newTitle);
    await refreshNotebooks(module.id);
  };

  const handleMoveNotebook = async (notebookId: string, targetModuleId: string) => {
    if (!module) return;
    await moveNotebookToModule(notebookId, targetModuleId);
    await refreshNotebooks(module.id);
  };

  const handleDeleteNotebook = async (notebookId: string) => {
    if (!module) return;
    await deleteNotebook(notebookId);
    await refreshNotebooks(module.id);
  };

  // Filtered and Sorted Notebooks
  const displayedNotebooks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    // 1. Filter
    let result = notebooks;
    if (query) {
      result = result.filter((note) => {
        const titleMatch = (note.title || '').toLowerCase().includes(query);
        const snippetMatch = stripMarkdown(note.content).toLowerCase().includes(query);
        return titleMatch || snippetMatch;
      });
    }

    // 2. Sort
    return [...result].sort((a, b) => {
      // Pinned notebooks always rise to the top
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      switch (sortMode) {
        case 'updated':
          return (b.updatedAt || '').localeCompare(a.updatedAt || '');
        case 'created':
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        case 'title-asc':
          return (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
        case 'title-desc':
          return (b.title || 'Untitled').localeCompare(a.title || 'Untitled');
        default:
          return 0;
      }
    });
  }, [notebooks, searchQuery, sortMode]);

  // Loading skeleton state
  if (isLoading) {
    return (
      <main
        style={{
          minHeight: '100vh',
          background: 'var(--bg-app)',
          padding: '40px 24px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div
            style={{
              height: 20,
              width: 100,
              background: 'var(--hover)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 20,
            }}
          />
          <div
            style={{
              height: 36,
              width: 240,
              background: 'var(--hover)',
              borderRadius: 'var(--radius-control)',
              marginBottom: 12,
            }}
          />
          <div
            style={{
              height: 16,
              width: 380,
              background: 'var(--hover)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 40,
            }}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}
          >
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: 160,
                  background: 'var(--bg-paper)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  opacity: 0.6,
                }}
              />
            ))}
          </div>
        </div>
      </main>
    );
  }

  // Not Found State
  if (!module) {
    return (
      <main
        style={{
          minHeight: '100vh',
          background: 'var(--bg-app)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ maxWidth: 480, width: '100%' }}>
          <EmptyState
            icon={<NotebookDocumentIcon size={28} />}
            title="Module not found"
            description={`We couldn't find a module matching "${decodedSlug}". It may have been renamed, archived, or deleted.`}
            action={{
              label: '← Back to All Modules',
              onClick: () => router.push('/modules'),
              variant: 'primary',
            }}
          />
        </div>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-app)',
        color: 'var(--ink)',
        padding: '32px 24px 64px',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      <FocusStyles />
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Module Header Banner */}
        <ModuleHeader
          module={module}
          notebookCount={notebooks.length}
          onNewNotebook={() => setIsCreateOpen(true)}
        />

        {/* Search & Sort Controls Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {/* Search bar */}
          <div style={{ flex: '1 1 260px', maxWidth: 400 }}>
            <SearchInput
              placeholder="Search notebooks in this module…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClear={() => setSearchQuery('')}
            />
          </div>

          {/* Sort selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label
              htmlFor="sort-mode-select"
              style={{
                fontSize: 'var(--font-size-xs, 12px)',
                color: 'var(--ink-soft)',
                fontWeight: 500,
                fontFamily: 'var(--font)',
              }}
            >
              Sort by
            </label>
            <select
              id="sort-mode-select"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="nb-focus-ring"
              style={{
                height: 36,
                padding: '0 10px',
                borderRadius: 'var(--radius-control)',
                background: 'var(--bg-paper)',
                color: 'var(--ink)',
                border: '1px solid var(--border)',
                fontSize: 'var(--font-size-sm, 13px)',
                fontFamily: 'var(--font)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="updated">Recently Updated</option>
              <option value="created">Oldest First</option>
              <option value="title-asc">Title (A–Z)</option>
              <option value="title-desc">Title (Z–A)</option>
            </select>
          </div>
        </div>

        {/* Notebook Cards Grid or Empty States */}
        {displayedNotebooks.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
              gap: 18,
            }}
          >
            {displayedNotebooks.map((notebook) => (
              <NotebookCard
                key={notebook.id}
                notebook={notebook}
                onOpen={handleOpenNotebook}
                onRename={(note) => setRenamingNotebook(note)}
                onMove={(note) => setMovingNotebook(note)}
                onDelete={(note) => setDeletingNotebook(note)}
              />
            ))}
          </div>
        ) : searchQuery.trim() ? (
          /* Search returned no results */
          <div
            style={{
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '20px',
              marginTop: 16,
            }}
          >
            <EmptyState
              title="No matching notebooks"
              description={`No notebooks in "${module.name}" match "${searchQuery.trim()}".`}
              action={{
                label: 'Clear search',
                onClick: () => setSearchQuery(''),
                variant: 'secondary',
              }}
            />
          </div>
        ) : (
          /* Module has no notebooks yet */
          <div
            style={{
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '24px',
              marginTop: 16,
            }}
          >
            <EmptyState
              icon={<NotebookDocumentIcon size={28} />}
              title="No notebooks yet"
              description={`Start capturing notes, documents, and research inside ${module.name}.`}
              action={{
                label: 'Create First Notebook',
                onClick: () => setIsCreateOpen(true),
                variant: 'primary',
              }}
            />
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateNotebookDialog
        isOpen={isCreateOpen}
        moduleName={module.name}
        onClose={() => setIsCreateOpen(false)}
        onCreate={handleCreateNotebook}
      />

      <RenameNotebookDialog
        isOpen={Boolean(renamingNotebook)}
        notebook={renamingNotebook}
        onClose={() => setRenamingNotebook(null)}
        onSave={handleSaveRename}
      />

      <MoveNotebookDialog
        isOpen={Boolean(movingNotebook)}
        notebook={movingNotebook}
        currentModuleId={module.id}
        modules={allModules}
        onClose={() => setMovingNotebook(null)}
        onMove={handleMoveNotebook}
      />

      <DeleteNotebookDialog
        isOpen={Boolean(deletingNotebook)}
        notebook={deletingNotebook}
        onClose={() => setDeletingNotebook(null)}
        onConfirm={handleDeleteNotebook}
      />
    </main>
  );
}
