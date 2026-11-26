'use client';

import React, { useCallback, useState } from 'react';
import { useNotes } from '@/hooks/useNotes';
import { useSync } from '@/hooks/useSync';
import { useTheme } from '@/components/ThemeProvider';
import { Sidebar } from '@/components/Sidebar';
import { Editor } from '@/components/Editor';
import { PairDevice } from '@/components/PairDevice';
import { SyncButton } from '@/components/SyncButton';
import { SettingsModal } from '@/components/SettingsModal';
import type { Note } from '@/lib/db';
import { renderSafeMarkdown, resolveSafeAttachments } from '@/lib/markdown';

export default function NotebookPage() {
  const {
    notes,
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
  } = useNotes();

  const {
    pairings,
    connectedPeers,
    syncStatus,
    addPairing,
    removePairing,
    triggerSync,
  } = useSync(reload);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPairDevice, setShowPairDevice] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const connectedCount = connectedPeers.length;

  const handleAddNote = useCallback(async () => {
    await addNote();
    setSidebarOpen(false);
  }, [addNote]);

  const handleDeleteNote = useCallback(
    async (id: string) => {
      const note = notes.find((n) => n.id === id);
      const title = note?.title.trim() || 'Untitled';
      if (!confirm(`Delete "${title}"?`)) return;
      await deleteNote(id);
    },
    [notes, deleteNote]
  );

  const handleSelectNote = useCallback(
    (id: string) => {
      selectNote(id);
      setSidebarOpen(false);
    },
    [selectNote]
  );

  const handleUpdateNote = useCallback(
    (
      patch: Partial<Pick<Note, 'title' | 'content' | 'attachments'>>,
      targetNoteId?: string
    ) => {
      const id = targetNoteId ?? activeId;
      if (!id) return;
      updateNote(id, patch);
    },
    [activeId, updateNote]
  );

  const handleExportPdf = useCallback(async () => {
    if (!activeNote) return;

    const renderedHtml = await renderSafeMarkdown(activeNote.content, activeNote.attachments);
    const title = activeNote.title.trim() || 'Untitled';

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
              if ((img as HTMLImageElement).complete) { res(); return; }
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
  }, [activeNote]);

  const handleExportMd = useCallback(() => {
    if (!activeNote) return;
    const content = resolveAttachments(activeNote);
    const title = activeNote.title.trim() || 'untitled';
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = title + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeNote]);

  if (!isLoaded) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)' }}>
        <div style={{ textAlign: 'center' }}>
          <svg className="animate-spin-slow" style={{ margin: '0 auto 12px', display: 'block', color: 'var(--accent)' }} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <p style={{ color: 'var(--ink-muted)', fontSize: 14 }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <header
        className="app-header"
        style={{
          height: 'var(--header-height)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-app)',
          flexShrink: 0,
        }}
      >
        {/* Menu toggle button (three horizontal lines) */}
        <button
          id="menu-toggle"
          onClick={() => setSidebarOpen((v) => !v)}
          title="Toggle sidebar"
          style={{ ...iconBtnStyle, marginRight: 8 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>

        <h1 style={{ fontFamily: 'var(--serif-font)', fontSize: 20, fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>
          Notebook
        </h1>

        <div style={{ flex: 1, minWidth: 8 }} />

        {/* Right side items: Saved time, Sync button, Settings button */}
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          {activeNote && (
            <span className="header-saved-time" style={{ fontSize: 12, color: 'var(--ink-muted)', flexShrink: 0, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
              Saved {formatRelative(activeNote.updatedAt)}
            </span>
          )}

          {/* Sync button */}
          <SyncButton
            syncStatus={syncStatus}
            connectedCount={connectedCount}
            onSync={triggerSync}
          />

          {/* Settings button (replaces Theme button) */}
          <button
            onClick={() => setShowSettings(true)}
            title="Settings & Appearance"
            style={iconBtnStyle}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Main */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {/* Backdrop overlay */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(2px)',
              zIndex: 100,
            }}
          />
        )}

        {/* Single Drawer Sidebar */}
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            width: 'var(--sidebar-width)',
            maxWidth: '85vw',
            zIndex: 110,
            display: 'flex',
            flexDirection: 'column',
            transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.25s ease',
            boxShadow: sidebarOpen ? '4px 0 24px rgba(0,0,0,0.18)' : 'none',
          }}
        >
          <Sidebar
            notes={notes}
            activeId={activeId}
            sortOrder={sortOrder}
            onSelectNote={handleSelectNote}
            onAddNote={handleAddNote}
            onDeleteNote={handleDeleteNote}
            onSortChange={changeSortOrder}
            onClose={() => setSidebarOpen(false)}
            connectedCount={connectedCount}
            onOpenSettings={() => { setShowSettings(true); setSidebarOpen(false); }}
            onOpenPairDevice={() => { setShowPairDevice(true); setSidebarOpen(false); }}
          />
        </div>

        {/* Editor / Empty state */}
        <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {activeNote ? (
            <Editor
              note={activeNote}
              onUpdate={handleUpdateNote}
              onImportNote={importNote}
              onExportPdf={handleExportPdf}
              onExportMd={handleExportMd}
            />
          ) : (
            <EmptyState onNewNote={handleAddNote} />
          )}
        </main>
      </div>

      {/* Pair Device Modal */}
      {showPairDevice && (
        <PairDevice
          pairings={pairings}
          connectedPeerIds={connectedPeers.map((p) => p.peerId)}
          onAddPairing={addPairing}
          onRemovePairing={removePairing}
          onClose={() => setShowPairDevice(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* Responsive styles */}
      <style>{`
        .mobile-only   { display: none; }
        .desktop-only  { display: flex; }

        @media (max-width: 640px) {
          .app-header { padding: 0 12px !important; }
          .header-actions { gap: 8px !important; }
          .header-saved-time { display: none !important; }
        }

        @media (max-width: 820px) {
          .mobile-only    { display: flex !important; }
          .desktop-only   { display: none !important; }
        }
      `}</style>
    </div>
  );
}

/* Helpers */

function EmptyState({ onNewNote }: { onNewNote: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', background: 'var(--bg-paper)' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.2, color: 'var(--gold)', marginBottom: 20 }}>
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <h2 style={{ fontFamily: 'var(--serif-font)', fontSize: 20, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>
        No note selected
      </h2>
      <p style={{ fontSize: 14, color: 'var(--ink-muted)', maxWidth: 300, marginBottom: 20 }}>
        Select a note from the sidebar, or create a new one to start writing.
      </p>
      <button
        onClick={onNewNote}
        style={{
          padding: '9px 18px',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius)',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'var(--font)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Note
      </button>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  padding: 7,
  color: 'var(--ink-soft)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'color 0.12s, background 0.12s',
  flexShrink: 0,
};

function resolveAttachments(note: Note): string {
  if (!note.content) return note.content;
  return resolveSafeAttachments(note.content, note.attachments);
}

function escHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function safeFileName(name: string): string {
  return (name || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Untitled';
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const diff = now - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
