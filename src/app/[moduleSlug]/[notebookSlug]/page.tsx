'use client';

import React, { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db, DEFAULT_MODULE_ID, type Note } from '@/lib/db';
import type { Module, Notebook } from '@/types/workspace';
import {
  createNotebookInModule,
  getModuleAndNotebookBySlugs,
  getNotebooksByModule,
  getNotebookSlug,
  recordModuleOpen,
} from '@/lib/workspace';
import { deleteNoteWithTombstone, updateNoteSafely } from '@/lib/tombstones';
import { useSync } from '@/hooks/useSync';
import { EditorHeader } from '@/components/editor/EditorHeader';
import { EditorSidebar } from '@/components/editor/EditorSidebar';
import { Editor } from '@/components/Editor';
import { SettingsModal } from '@/components/SettingsModal';
import { PairDevice } from '@/components/PairDevice';
import { EmptyState } from '@/components/ui/EmptyState';
import { renderSafeMarkdown, resolveSafeAttachments } from '@/lib/markdown';

interface NestedEditorPageProps {
  params: Promise<{ moduleSlug: string; notebookSlug: string }>;
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function safeFileName(name: string): string {
  return (name || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
}

export default function NestedEditorPage({ params }: NestedEditorPageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const rawModuleSlug = resolvedParams?.moduleSlug || '';
  const rawNotebookSlug = resolvedParams?.notebookSlug || '';
  const moduleSlug = decodeURIComponent(rawModuleSlug);
  const notebookSlug = decodeURIComponent(rawNotebookSlug);

  // Core Data State
  const [module, setModule] = useState<Module | null>(null);
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [notebooksInModule, setNotebooksInModule] = useState<Notebook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNotFound, setIsNotFound] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined);

  // Layout & Navigation State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPairDevice, setShowPairDevice] = useState(false);

  // Reload callback for sync
  const handleSyncReload = useCallback(async () => {
    if (!module?.id) return;
    const items = await getNotebooksByModule(module.id, true);
    setNotebooksInModule(items);
    if (notebook?.id) {
      const refreshed = items.find((n) => n.id === notebook.id);
      if (refreshed) {
        setNotebook(refreshed);
      }
    }
  }, [module, notebook]);

  const {
    pairings,
    connectedPeers,
    autoSyncEnabled,
    setAutoSyncEnabled,
    notifyLocalNoteChange,
    propagateDeletion,
    getConnectedPeers,
    addPairing,
    removePairing,
  } = useSync(handleSyncReload);

  // Detect mobile viewport and setup resize listener
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth <= 820;
      setIsMobile(mobile);
      if (!mobile) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Load Module, Notebook, and Siblings
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!moduleSlug || !notebookSlug) {
        setIsNotFound(true);
        setIsLoading(false);
        return;
      }

      try {
        const { seedIfEmpty } = await import('@/lib/db');
        await seedIfEmpty();

        const { module: foundModule, notebook: foundNotebook } =
          await getModuleAndNotebookBySlugs(moduleSlug, notebookSlug);

        if (cancelled) return;

        if (!foundNotebook) {
          setIsNotFound(true);
          return;
        }

        setNotebook(foundNotebook);
        setLastSavedAt(foundNotebook.updatedAt);
        try {
          localStorage.setItem('nb-active-id', foundNotebook.id);
        } catch {}

        if (foundModule) {
          setModule(foundModule);
          recordModuleOpen(foundModule.id);
          const siblings = await getNotebooksByModule(foundModule.id, true);
          if (cancelled) return;
          setNotebooksInModule(siblings);
        } else {
          const defaultMod = await db.modules.get(foundNotebook.moduleId || DEFAULT_MODULE_ID);
          if (cancelled) return;
          if (defaultMod) {
            setModule(defaultMod);
            recordModuleOpen(defaultMod.id);
            const siblings = await getNotebooksByModule(defaultMod.id, true);
            if (cancelled) return;
            setNotebooksInModule(siblings);
          }
        }

        setIsNotFound(false);
      } catch (err) {
        console.error('Failed to load notebook data:', err);
        if (!cancelled) setIsNotFound(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [moduleSlug, notebookSlug]);

  // Handle Note Content or Title Updates
  const handleUpdate = useCallback(
    (
      patch: Partial<Pick<Note, 'title' | 'content' | 'attachments'>>,
      targetNoteId?: string
    ) => {
      const id = targetNoteId || notebook?.id;
      if (!id) return;

      void updateNoteSafely(id, patch, db).then((result) => {
        if (result.status === 'saved') {
          setNotebook(result.note);
          setLastSavedAt(result.note.updatedAt);
          notifyLocalNoteChange();

          // Update notebook in sibling list so sidebar displays updated title and timestamp
          setNotebooksInModule((prev) =>
            prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: result.note.updatedAt } : n))
          );
        }
      });
    },
    [notebook?.id, notifyLocalNoteChange]
  );

  // Handle Notebook Selection from Sidebar
  const handleSelectNotebook = useCallback(
    (selected: Notebook) => {
      const targetModSlug = module?.slug || module?.id || 'general';
      const targetNbSlug = getNotebookSlug(selected);
      router.push(`/${targetModSlug}/${targetNbSlug}`);
      if (isMobile) setIsSidebarOpen(false);
    },
    [module, isMobile, router]
  );

  // Handle New Notebook Creation
  const handleCreateNotebook = useCallback(async () => {
    const targetModuleId = module?.id || DEFAULT_MODULE_ID;
    const newNote = await createNotebookInModule(targetModuleId, { title: '' });
    notifyLocalNoteChange();

    const targetModSlug = module?.slug || module?.id || 'general';
    const targetNbSlug = getNotebookSlug(newNote);
    router.push(`/${targetModSlug}/${targetNbSlug}`);
    if (isMobile) setIsSidebarOpen(false);
  }, [module, isMobile, notifyLocalNoteChange, router]);

  // Handle Notebook Deletion
  const handleDeleteNotebook = useCallback(
    async (idToDelete: string) => {
      const target = notebooksInModule.find((n) => n.id === idToDelete) || notebook;
      const title = target?.title?.trim() || 'Untitled';
      if (!confirm(`Delete "${title}"?`)) return;

      const recipients = getConnectedPeers();
      const tombstone = await deleteNoteWithTombstone(idToDelete, db, recipients);
      if (tombstone) {
        await propagateDeletion(tombstone);
      }

      // Refresh siblings
      const remaining = notebooksInModule.filter((n) => n.id !== idToDelete);
      setNotebooksInModule(remaining);

      // If deleted current notebook, navigate to another or back to module
      if (notebook?.id === idToDelete) {
        const next = remaining[0];
        const targetModSlug = module?.slug || module?.id || 'general';
        if (next) {
          router.replace(`/${targetModSlug}/${getNotebookSlug(next)}`);
        } else {
          router.replace(`/${targetModSlug}`);
        }
      }
    },
    [notebooksInModule, notebook, getConnectedPeers, propagateDeletion, module, router]
  );

  // Import Note callback
  const handleImportNote = useCallback(
    async (title: string, content: string) => {
      const targetModuleId = module?.id || DEFAULT_MODULE_ID;
      const created = await createNotebookInModule(targetModuleId, { title, content });
      notifyLocalNoteChange();
      const targetModSlug = module?.slug || module?.id || 'general';
      router.push(`/${targetModSlug}/${getNotebookSlug(created)}`);
      return created.id;
    },
    [module, notifyLocalNoteChange, router]
  );

  // Export PDF
  const handleExportPdf = useCallback(async () => {
    if (!notebook) return;
    const renderedHtml = await renderSafeMarkdown(notebook.content, notebook.attachments);
    const title = notebook.title?.trim() || 'Untitled';

    const el = document.createElement('div');
    el.style.cssText =
      'padding:40px;font-family:"Source Serif 4",serif;color:#20242A;line-height:1.7;background:#FFFFFF;';
    el.innerHTML = `
      <h1 style="font-family:'Source Serif 4',serif;font-size:24px;font-weight:600;margin-bottom:8px;color:#16324F;">${escHtml(title)}</h1>
      <hr style="border:none;border-top:1px solid #DEDAD0;margin-bottom:20px;">
      <div style="font-size:14px;">${renderedHtml}</div>
    `;

    el.querySelectorAll('h1,h2,h3,h4').forEach((h) => {
      (h as HTMLElement).style.cssText =
        'font-family:"Source Serif 4",serif;font-weight:700;color:#16324F;line-height:1.3;margin-top:18px;margin-bottom:8px;';
    });
    el.querySelectorAll('pre').forEach((p) => {
      (p as HTMLElement).style.cssText =
        'background:#1E232B;color:#EAEAEA;padding:14px;border-radius:10px;border:1px solid #1E232B;overflow-x:auto;font-size:12px;margin-bottom:16px;';
    });
    el.querySelectorAll('code:not(pre code)').forEach((c) => {
      (c as HTMLElement).style.cssText =
        'background:#EFEDE7;color:#20242A;padding:2px 5px;border-radius:6px;font-size:.875em;font-family:"JetBrains Mono",monospace;';
    });
    el.querySelectorAll('blockquote').forEach((b) => {
      (b as HTMLElement).style.cssText =
        'border-left:3px solid #AD8A4E;padding:6px 14px;margin-bottom:16px;background:#EFEDE7;color:#5B6169;font-style:italic;';
    });
    el.querySelectorAll('table').forEach((t) => {
      (t as HTMLElement).style.cssText = 'width:100%;border-collapse:collapse;margin-bottom:16px;';
      t.querySelectorAll('th,td').forEach((c) => {
        (c as HTMLElement).style.cssText = 'padding:8px 12px;border:1px solid #DEDAD0;text-align:left;font-size:13px;';
      });
      t.querySelectorAll('th').forEach((c) => {
        (c as HTMLElement).style.cssText += 'background:#EFEDE7;font-weight:600;';
      });
    });
    el.querySelectorAll('img').forEach((img) => {
      (img as HTMLElement).style.cssText = 'max-width:100%;border-radius:6px;';
    });

    document.body.appendChild(el);

    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all(
        Array.from(el.querySelectorAll('img')).map(
          (img) =>
            new Promise<void>((res) => {
              if ((img as HTMLImageElement).complete) {
                res();
                return;
              }
              img.onload = () => res();
              img.onerror = () => res();
            })
        )
      );

      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf()
        .set({
          margin: [0.5, 0.5, 0.5, 0.5],
          filename: safeFileName(title) + '.pdf',
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
        })
        .from(el)
        .save();
    } catch {
      alert('Failed to generate PDF. Please try again.');
    } finally {
      document.body.removeChild(el);
    }
  }, [notebook]);

  // Export Markdown
  const handleExportMd = useCallback(() => {
    if (!notebook) return;
    const content = resolveSafeAttachments(notebook.content, notebook.attachments);
    const title = notebook.title?.trim() || 'untitled';
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFileName(title) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [notebook]);

  // Loading View
  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-app)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <svg
            className="animate-spin-slow"
            style={{
              margin: '0 auto 12px',
              display: 'block',
              color: 'var(--accent)',
            }}
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <p style={{ color: 'var(--ink-muted)', fontSize: 14 }}>Loading notebook…</p>
        </div>
      </div>
    );
  }

  // Not Found View
  if (isNotFound || !notebook) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          background: 'var(--bg-app)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <EmptyState
          title="Notebook Not Found"
          description="The requested notebook could not be found or may have been deleted."
          action={{
            label: 'All Modules',
            onClick: () => router.push('/modules'),
            variant: 'primary',
          }}
          secondaryAction={{
            label: 'Go to Module',
            onClick: () => router.push(`/${moduleSlug}`),
          }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg-app)',
      }}
    >
      {/* 1. Editor Header */}
      <EditorHeader
        module={module}
        notebook={notebook}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((v) => !v)}
        onExportPdf={handleExportPdf}
        onExportMd={handleExportMd}
        lastSavedAt={lastSavedAt}
      />

      {/* 2. Main Content Area: Sidebar + Editor */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Editor Sidebar */}
        <EditorSidebar
          currentModule={module}
          notebooks={notebooksInModule}
          activeNotebookId={notebook.id}
          isOpen={isSidebarOpen}
          isMobile={isMobile}
          onClose={() => setIsSidebarOpen(false)}
          onSelectNotebook={handleSelectNotebook}
          onCreateNotebook={handleCreateNotebook}
          onDeleteNotebook={handleDeleteNotebook}
          onOpenSettings={() => setShowSettings(true)}
        />

        {/* Editor Workspace */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-paper)',
          }}
        >
          <Editor
            note={notebook}
            onUpdate={handleUpdate}
            onImportNote={handleImportNote}
            onExportPdf={handleExportPdf}
            onExportMd={handleExportMd}
          />
        </main>
      </div>

      {/* 3. Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          autoSyncEnabled={autoSyncEnabled}
          onToggleAutoSync={setAutoSyncEnabled}
        />
      )}

      {/* 4. Pair Device Modal */}
      {showPairDevice && (
        <PairDevice
          pairings={pairings}
          connectedPeerIds={connectedPeers.map((p) => p.peerId)}
          onAddPairing={addPairing}
          onRemovePairing={removePairing}
          onClose={() => setShowPairDevice(false)}
        />
      )}
    </div>
  );
}
