'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Note } from '@/lib/db';
import { processImageUpload } from '@/lib/imageUpload';
import { Toolbar } from './Toolbar';
import { MarkdownPreview } from './MarkdownPreview';
import { DrawingCanvas } from './DrawingCanvas';

interface EditorProps {
  note: Note;
  onUpdate: (
    patch: Partial<Pick<Note, 'title' | 'content' | 'attachments'>>,
    noteId?: string
  ) => void;
  onImportNote: (title: string, content: string) => void;
  onExportPdf: () => void;
  onExportMd: () => void;
}

type MobileTab = 'write' | 'preview';
type FullScreenMode = 'none' | 'write' | 'preview';

function cleanAlt(name: string): string {
  return (name || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/[\[\]\r\n]/g, ' ')
    .trim() || 'image';
}

function uniqueLabel(
  attachments: Record<string, import('@/lib/db').AttachmentEntry>,
  name: string
): string {
  const base = cleanAlt(name);
  let label = base;
  let count = 2;
  while (attachments[label]) {
    label = `${base} ${count}`;
    count += 1;
  }
  return label;
}

export function Editor({ note, onUpdate, onImportNote, onExportPdf, onExportMd }: EditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('write');
  const [fullScreenMode, setFullScreenMode] = useState<FullScreenMode>('none');
  const [showDrawing, setShowDrawing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const noteIdRef = useRef(note.id);
  const lastWrittenRef = useRef({ title: note.title, content: note.content });
  const draftRef = useRef({ title: note.title, content: note.content });
  const dirtyFieldsRef = useRef({ title: false, content: false });
  const pendingSaveRef = useRef<{
    noteId: string;
    onUpdate: EditorProps['onUpdate'];
  } | null>(null);

  const flushPendingSave = useCallback(() => {
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    const pending = pendingSaveRef.current;
    const isDirty = dirtyFieldsRef.current.title || dirtyFieldsRef.current.content;
    if (!pending || !isDirty) {
      pendingSaveRef.current = null;
      return;
    }

    const snapshot = { ...draftRef.current };
    pendingSaveRef.current = null;
    dirtyFieldsRef.current = { title: false, content: false };
    lastWrittenRef.current = snapshot;
    pending.onUpdate(snapshot, pending.noteId);
  }, []);

  useEffect(() => {
    if (note.id !== noteIdRef.current) {
      flushPendingSave();
      noteIdRef.current = note.id;
      dirtyFieldsRef.current = { title: false, content: false };
      lastWrittenRef.current = { title: note.title, content: note.content };
      draftRef.current = { title: note.title, content: note.content };
      setTitle(note.title);
      setContent(note.content);
      setShowDrawing(false);
      setUploadError(null);
      setFullScreenMode('none');
      return;
    }

    const last = lastWrittenRef.current;
    const titleChangedFromProp = note.title !== last.title;
    const contentChangedFromProp = note.content !== last.content;

    if (titleChangedFromProp || contentChangedFromProp) {
      lastWrittenRef.current = { title: note.title, content: note.content };

      // Preserve unsaved local edits while still accepting non-dirty synced fields.
      if (titleChangedFromProp && !dirtyFieldsRef.current.title) {
        draftRef.current.title = note.title;
        setTitle(note.title);
      }
      if (contentChangedFromProp && !dirtyFieldsRef.current.content) {
        draftRef.current.content = note.content;
        setContent(note.content);
      }

      if (!dirtyFieldsRef.current.title && !dirtyFieldsRef.current.content && saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
        pendingSaveRef.current = null;
      }
    }
  }, [flushPendingSave, note.id, note.title, note.content]);

  useEffect(() => {
    return () => {
      flushPendingSave();
    };
  }, [flushPendingSave]);

  // Press ESC to exit full screen mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && fullScreenMode !== 'none') {
        setFullScreenMode('none');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullScreenMode]);

  const scheduleUpdate = useCallback(
    (nextDraft: { title: string; content: string }, dirtyField: 'title' | 'content') => {
      const targetNoteId = noteIdRef.current;
      draftRef.current = nextDraft;
      dirtyFieldsRef.current[dirtyField] = true;
      pendingSaveRef.current = { noteId: targetNoteId, onUpdate };
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        saveTimeout.current = null;
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = null;
        const snapshot = { ...draftRef.current };
        dirtyFieldsRef.current = { title: false, content: false };
        lastWrittenRef.current = snapshot;
        const saveFn = pending?.onUpdate ?? onUpdate;
        const saveId = pending?.noteId ?? targetNoteId;
        saveFn(snapshot, saveId);
      }, 350);
    },
    [onUpdate]
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = e.target.value;
    setTitle(nextTitle);
    scheduleUpdate({ title: nextTitle, content: draftRef.current.content }, 'title');
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextContent = e.target.value;
    setContent(nextContent);
    scheduleUpdate({ title: draftRef.current.title, content: nextContent }, 'content');
  };

  /* ── Markdown insertion helpers ── */
  const applyTextareaEdit = useCallback(
    (
      compute: (ta: HTMLTextAreaElement) => {
        next: string;
        selStart: number;
        selEnd: number;
      }
    ) => {
      const ta = taRef.current;
      if (!ta) return;
      const { next, selStart, selEnd } = compute(ta);
      setContent(next);
      ta.focus();
      requestAnimationFrame(() => {
        ta.value = next;
        ta.setSelectionRange(selStart, selEnd);
      });
      scheduleUpdate({ title: draftRef.current.title, content: next }, 'content');
    },
    [scheduleUpdate]
  );

  const insertAround = useCallback(
    (before: string, after: string, placeholder: string, selectInserted = false) => {
      applyTextareaEdit((ta) => {
        const { selectionStart: s, selectionEnd: e, value } = ta;
        const selected = value.substring(s, e) || placeholder;
        const next = value.slice(0, s) + before + selected + after + value.slice(e);
        const selStart = selectInserted ? s + before.length : s + before.length + selected.length + after.length;
        const selEnd = selectInserted ? s + before.length + selected.length : selStart;
        return { next, selStart, selEnd };
      });
    },
    [applyTextareaEdit]
  );

  function insertAtLine(prefix: string) {
    applyTextareaEdit((ta) => {
      const { selectionStart: s, value } = ta;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      const pos = s + prefix.length;
      return { next, selStart: pos, selEnd: pos };
    });
  }

  function insertText(text: string) {
    applyTextareaEdit((ta) => {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const before = s > 0 && value[s - 1] !== '\n' ? '\n' : '';
      const after = value[e] && value[e] !== '\n' ? '\n' : '';
      const next = value.slice(0, s) + before + text + after + value.slice(e);
      const pos = s + before.length + text.length + after.length;
      return { next, selStart: pos, selEnd: pos };
    });
  }

  function insertAttachment(rawName: string, dataUrl: string) {
    const targetNoteId = noteIdRef.current;
    if (saveTimeout.current) {
      clearTimeout(saveTimeout.current);
      saveTimeout.current = null;
    }
    pendingSaveRef.current = null;
    const attachments = { ...note.attachments };
    const label = uniqueLabel(attachments, rawName);
    attachments[label] = {
      name: rawName,
      data: dataUrl,
      createdAt: new Date().toISOString(),
    };
    const curContent = draftRef.current.content;
    const curTitle = draftRef.current.title;
    const newContent =
      curContent + (curContent && !curContent.endsWith('\n') ? '\n' : '') + `![${label}]\n`;
    draftRef.current = { title: curTitle, content: newContent };
    dirtyFieldsRef.current = { title: false, content: false };
    lastWrittenRef.current = { title: curTitle, content: newContent };
    setContent(newContent);
    onUpdate({ attachments, content: newContent, title: curTitle }, targetNoteId);
  }

  async function handleImageUpload(file: File) {
    setUploadError(null);
    try {
      const dataUrl = await processImageUpload(file);
      insertAttachment(file.name, dataUrl);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not add that image. Please try another file.';
      setUploadError(message);
    }
  }

  function handleDrawingInsert(dataUrl: string) {
    setUploadError(null);
    insertAttachment('drawing', dataUrl);
    setShowDrawing(false);
  }

  function handleCommand(cmd: string) {
    if (cmd.startsWith('__import__:')) {
      const { title, content } = JSON.parse(cmd.slice('__import__:'.length));
      onImportNote(title, content);
      return;
    }
    const cmds: Record<string, () => void> = {
      bold: () => insertAround('**', '**', 'bold text'),
      italic: () => insertAround('*', '*', 'italic text'),
      strikethrough: () => insertAround('~~', '~~', 'strikethrough'),
      h1: () => insertAtLine('# '),
      h2: () => insertAtLine('## '),
      h3: () => insertAtLine('### '),
      ul: () => insertAtLine('- '),
      ol: () => insertAtLine('1. '),
      quote: () => insertAtLine('> '),
      code: () => insertAround('```\n', '\n```', 'code block'),
      link: () => insertAround('[', '](url)', 'link text', true),
      hr: () => insertText('---'),
    };
    cmds[cmd]?.();
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'b') { e.preventDefault(); insertAround('**', '**', 'bold text'); }
      if (ctrl && e.key === 'i') { e.preventDefault(); insertAround('*', '*', 'italic text'); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [insertAround]);

  const toggleFullScreenWrite = () => {
    setFullScreenMode((prev) => (prev === 'write' ? 'none' : 'write'));
  };

  const toggleFullScreenPreview = () => {
    setFullScreenMode((prev) => (prev === 'preview' ? 'none' : 'preview'));
  };

  const isFullScreen = fullScreenMode !== 'none';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg-paper)',
        ...(isFullScreen
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
            }
          : {}),
      }}
    >
      {/* Notebook Title (Hidden in Fullscreen Mode) */}
      {!isFullScreen && (
        <div style={{ padding: '12px 18px 6px', flexShrink: 0, display: 'flex', alignItems: 'center' }} className="note-title-container">
          <input
            value={title}
            onChange={handleTitleChange}
            placeholder="Untitled note title…"
            spellCheck={false}
            autoComplete="off"
            className="note-title-input"
            style={{
              width: title ? `${Math.max(title.length + 3, 12)}ch` : '18ch',
              maxWidth: '100%',
              minWidth: '120px',
              padding: '8px 14px',
              fontSize: 20,
              fontWeight: 600,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              outline: 'none',
              background: 'var(--bg-app)',
              color: 'var(--ink)',
              fontFamily: 'var(--serif-font)',
              transition: 'border-color 0.15s ease, box-shadow 0.15s ease, width 0.1s ease',
            }}
          />
        </div>
      )}

      {/* Toolbar */}
      <Toolbar
        onCommand={handleCommand}
        onImageUpload={handleImageUpload}
        onToggleDrawing={() => setShowDrawing((v) => !v)}
        onExportPdf={onExportPdf}
        onExportMd={onExportMd}
        onToggleFullScreenWrite={toggleFullScreenWrite}
        onToggleFullScreenPreview={toggleFullScreenPreview}
        onExitFullScreen={() => setFullScreenMode('none')}
        fullScreenMode={fullScreenMode}
      />

      {uploadError && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 14px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderBottom: '1px solid var(--border)',
            color: 'var(--danger)',
            fontSize: 12.5,
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          <span>{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            aria-label="Dismiss image upload error"
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: '0 4px',
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Drawing panel */}
      {showDrawing && (
        <DrawingCanvas
          onInsert={handleDrawingInsert}
          onClose={() => setShowDrawing(false)}
        />
      )}

      {/* Mobile tabs (Hidden in Fullscreen Mode) */}
      {!isFullScreen && (
        <div className="mobile-tabs" style={{ display: 'none', gap: 4, padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-paper)', flexShrink: 0, alignItems: 'center' }}>
          {(['write', 'preview'] as MobileTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              style={{
                flex: 1,
                padding: '7px 14px',
                background: mobileTab === tab ? 'var(--accent)' : 'var(--bg-sidebar)',
                border: `1px solid ${mobileTab === tab ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-sm)',
                color: mobileTab === tab ? '#fff' : 'var(--ink-soft)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font)',
                transition: 'all 0.15s',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
          <button
            onClick={mobileTab === 'write' ? toggleFullScreenWrite : toggleFullScreenPreview}
            title={`Full Screen ${mobileTab.charAt(0).toUpperCase() + mobileTab.slice(1)}`}
            style={{
              padding: '7px 10px',
              background: 'var(--bg-app)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--ink)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Editor body — split pane on desktop, single pane on mobile, or full screen single pane */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* Write pane (Hidden if in preview-only full screen mode) */}
        <div
          style={{
            flex: fullScreenMode === 'write' ? '1 1 100%' : '0 0 50%',
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
            display:
              fullScreenMode === 'preview'
                ? 'none'
                : fullScreenMode === 'write'
                ? 'block'
                : undefined, // handled by CSS media queries on mobile
          }}
          className={`write-pane ${fullScreenMode === 'write' ? 'fullscreen-active' : ''}`}
        >
          {/* Pane Control Header (Desktop split view only) */}
          {!isFullScreen && (
            <div
              className="pane-header-bar desktop-only-pane-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 14px',
                background: 'var(--bg-app)',
                borderBottom: '1px solid var(--border)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--ink-muted)',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}
            >
              <span>Markdown Editor</span>
              <button
                onClick={toggleFullScreenWrite}
                title="Full Screen Editor"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ink-soft)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 2,
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            </div>
          )}

          <textarea
            ref={taRef}
            value={content}
            onChange={handleContentChange}
            placeholder="Start writing in Markdown…"
            spellCheck={false}
            style={{
              position: 'absolute',
              top: !isFullScreen ? 26 : 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100%',
              padding: '16px 24px 140px', // Extra bottom space (140px) so phone user can scroll past browser status bar
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontSize: 14,
              lineHeight: 1.7,
              fontFamily: 'var(--mono-font)',
              color: 'var(--ink)',
              background: 'var(--bg-paper)',
              overflowY: 'auto',
            }}
          />
        </div>

        {/* Preview pane (Hidden if in write-only full screen mode) */}
        <div
          style={{
            flex: fullScreenMode === 'preview' ? '1 1 100%' : '0 0 50%',
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
            borderLeft: fullScreenMode === 'preview' ? 'none' : '1px solid var(--border)',
            display:
              fullScreenMode === 'write'
                ? 'none'
                : fullScreenMode === 'preview'
                ? 'block'
                : undefined, // handled by CSS media queries on mobile
          }}
          className={`preview-pane ${fullScreenMode === 'preview' ? 'fullscreen-active' : ''}`}
        >
          {/* Pane Control Header (Desktop split view only) */}
          {!isFullScreen && (
            <div
              className="pane-header-bar desktop-only-pane-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 14px',
                background: 'var(--bg-app)',
                borderBottom: '1px solid var(--border)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--ink-muted)',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}
            >
              <span>Live Preview</span>
              <button
                onClick={toggleFullScreenPreview}
                title="Full Screen Preview"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ink-soft)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 2,
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            </div>
          )}

          <div
            style={{
              position: 'absolute',
              top: !isFullScreen ? 26 : 0,
              left: 0,
              right: 0,
              bottom: 0,
              overflowY: 'auto',
            }}
          >
            <MarkdownPreview note={{ ...note, content }} />
          </div>
        </div>
      </div>

      {/* Responsive CSS */}
      <style>{`
        .note-title-input {
          field-sizing: content;
        }
        .note-title-input:hover {
          border-color: var(--ink-muted) !important;
        }
        .note-title-input:focus {
          border-color: var(--accent) !important;
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent) !important;
          background: var(--bg-paper) !important;
        }

        @media (max-width: 820px) {
          .note-title-container { padding: 10px 12px 4px !important; }
          .note-title-input { padding: 8px 12px !important; font-size: 18px !important; }
          .desktop-only-pane-header { display: none !important; }
          .mobile-tabs { display: ${isFullScreen ? 'none' : 'flex'} !important; }
          .write-pane  {
            flex: 0 0 100% !important;
            display: ${fullScreenMode === 'preview' ? 'none' : fullScreenMode === 'write' ? 'block' : mobileTab === 'write' ? 'block' : 'none'} !important;
          }
          .preview-pane {
            flex: 0 0 100% !important;
            border-left: none !important;
            display: ${fullScreenMode === 'write' ? 'none' : fullScreenMode === 'preview' ? 'block' : mobileTab === 'preview' ? 'block' : 'none'} !important;
          }
        }
      `}</style>
    </div>
  );
}
