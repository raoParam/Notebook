'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Note } from '@/lib/db';
import { Toolbar } from './Toolbar';
import { MarkdownPreview } from './MarkdownPreview';
import { DrawingCanvas } from './DrawingCanvas';

interface EditorProps {
  note: Note;
  onUpdate: (patch: Partial<Pick<Note, 'title' | 'content' | 'attachments'>>) => void;
  onImportNote: (title: string, content: string) => void;
  onExportPdf: () => void;
  onExportMd: () => void;
}

type MobileTab = 'write' | 'preview';
type FullScreenMode = 'none' | 'write' | 'preview';

function resizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const maxSide = 1400;
        const largest = Math.max(img.width, img.height);
        if (largest <= maxSide && file.size <= 900 * 1024) { resolve(dataUrl); return; }
        const scale = Math.min(1, maxSide / largest);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  const [editorFontSize, setEditorFontSize] = useState(14);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const noteIdRef = useRef(note.id);
  const lastWrittenRef = useRef({ title: note.title, content: note.content });

  useEffect(() => {
    if (note.id !== noteIdRef.current) {
      noteIdRef.current = note.id;
      lastWrittenRef.current = { title: note.title, content: note.content };
      setTitle(note.title);
      setContent(note.content);
      setShowDrawing(false);
      setFullScreenMode('none');
      return;
    }

    const last = lastWrittenRef.current;
    if (note.title !== last.title || note.content !== last.content) {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        saveTimeout.current = null;
      }
      lastWrittenRef.current = { title: note.title, content: note.content };
      setTitle(note.title);
      setContent(note.content);
    }
  }, [note.id, note.title, note.content]);

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
    (patch: Partial<Pick<Note, 'title' | 'content'>>) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        saveTimeout.current = null;
        lastWrittenRef.current = {
          title: patch.title ?? title,
          content: patch.content ?? content,
        };
        onUpdate(patch);
      }, 350);
    },
    [onUpdate, title, content]
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    scheduleUpdate({ title: e.target.value, content });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    scheduleUpdate({ title, content: e.target.value });
  };

  /* ── Markdown insertion helpers ── */
  function insertAround(before: string, after: string, placeholder: string) {
    const ta = taRef.current!;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.substring(s, e) || placeholder;
    const next = value.slice(0, s) + before + selected + after + value.slice(e);
    setContent(next);
    ta.focus();
    const pos = s + before.length + selected.length + after.length;
    requestAnimationFrame(() => { ta.value = next; ta.setSelectionRange(pos, pos); });
    scheduleUpdate({ title, content: next });
  }

  function insertAtLine(prefix: string) {
    const ta = taRef.current!;
    if (!ta) return;
    const { selectionStart: s, value } = ta;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    setContent(next);
    ta.focus();
    const pos = s + prefix.length;
    requestAnimationFrame(() => { ta.value = next; ta.setSelectionRange(pos, pos); });
    scheduleUpdate({ title, content: next });
  }

  function insertFull(before: string, after: string, placeholder: string) {
    const ta = taRef.current!;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.substring(s, e) || placeholder;
    const next = value.slice(0, s) + before + selected + after + value.slice(e);
    setContent(next);
    ta.focus();
    requestAnimationFrame(() => {
      ta.value = next;
      ta.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
    scheduleUpdate({ title, content: next });
  }

  function insertText(text: string) {
    const ta = taRef.current!;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const before = s > 0 && value[s - 1] !== '\n' ? '\n' : '';
    const after = value[e] && value[e] !== '\n' ? '\n' : '';
    const next = value.slice(0, s) + before + text + after + value.slice(e);
    setContent(next);
    ta.focus();
    const pos = s + before.length + text.length + after.length;
    requestAnimationFrame(() => { ta.value = next; ta.setSelectionRange(pos, pos); });
    scheduleUpdate({ title, content: next });
  }

  async function handleImageUpload(file: File) {
    try {
      const dataUrl = await resizeImageFile(file);
      const attachments = { ...note.attachments };
      const label = uniqueLabel(attachments, file.name);
      attachments[label] = {
        name: file.name,
        data: dataUrl,
        createdAt: new Date().toISOString(),
      };
      const newContent = content + (content && !content.endsWith('\n') ? '\n' : '') + `![${label}]\n`;
      setContent(newContent);
      lastWrittenRef.current = { title, content: newContent };
      onUpdate({ attachments, content: newContent, title });
    } catch {
      alert('Could not add that image. Please try another file.');
    }
  }

  function handleDrawingInsert(dataUrl: string) {
    const attachments = { ...note.attachments };
    const label = uniqueLabel(attachments, 'drawing');
    attachments[label] = {
      name: 'drawing',
      data: dataUrl,
      createdAt: new Date().toISOString(),
    };
    const newContent = content + (content && !content.endsWith('\n') ? '\n' : '') + `![${label}]\n`;
    setContent(newContent);
    lastWrittenRef.current = { title, content: newContent };
    onUpdate({ attachments, content: newContent, title });
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
      link: () => insertFull('[', '](url)', 'link text'),
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, title]);

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
        onOpenMd={() => {}}
        onExportPdf={onExportPdf}
        onExportMd={onExportMd}
        onToggleFullScreenWrite={toggleFullScreenWrite}
        onToggleFullScreenPreview={toggleFullScreenPreview}
        onExitFullScreen={() => setFullScreenMode('none')}
        fullScreenMode={fullScreenMode}
        currentFontSize={editorFontSize}
        onFontSizeChange={setEditorFontSize}
      />

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
              fontSize: editorFontSize,
              lineHeight: 1.7,
              fontFamily: 'var(--mono-font)',
              color: 'var(--ink)',
              background: 'var(--bg-paper)',
              overflowY: 'auto',
              transition: 'font-size 0.1s ease',
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
          box-shadow: 0 0 0 3px rgba(127, 168, 204, 0.18) !important;
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
