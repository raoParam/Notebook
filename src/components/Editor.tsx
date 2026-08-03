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
  const [showDrawing, setShowDrawing] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const noteIdRef = useRef(note.id);

  // Sync local state when note changes
  useEffect(() => {
    if (note.id !== noteIdRef.current) {
      noteIdRef.current = note.id;
      setTitle(note.title);
      setContent(note.content);
      setShowDrawing(false);
    }
  }, [note.id, note.title, note.content]);

  const scheduleUpdate = useCallback(
    (patch: Partial<Pick<Note, 'title' | 'content'>>) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => onUpdate(patch), 350);
    },
    [onUpdate]
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-paper)' }}>
      {/* Title */}
      <input
        value={title}
        onChange={handleTitleChange}
        placeholder="Untitled"
        spellCheck={false}
        autoComplete="off"
        style={{
          padding: '16px 24px 8px',
          fontSize: 22,
          fontWeight: 600,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--ink)',
          fontFamily: 'var(--serif-font)',
          width: '100%',
          flexShrink: 0,
        }}
      />

      {/* Toolbar */}
      <Toolbar
        onCommand={handleCommand}
        onImageUpload={handleImageUpload}
        onToggleDrawing={() => setShowDrawing((v) => !v)}
        onOpenMd={() => {}}
        onExportPdf={onExportPdf}
        onExportMd={onExportMd}
      />

      {/* Drawing panel */}
      {showDrawing && (
        <DrawingCanvas
          onInsert={handleDrawingInsert}
          onClose={() => setShowDrawing(false)}
        />
      )}

      {/* Mobile tabs */}
      <div className="mobile-tabs" style={{ display: 'none', gap: 4, padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-paper)', flexShrink: 0 }}>
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
      </div>

      {/* Editor body — split pane on desktop, single pane on mobile */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* Write pane */}
        <div
          style={{
            flex: '0 0 50%',
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
          }}
          className="write-pane"
        >
          <textarea
            ref={taRef}
            value={content}
            onChange={handleContentChange}
            placeholder="Start writing in Markdown…"
            spellCheck={false}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              padding: '16px 24px',
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

        {/* Preview pane */}
        <div
          style={{
            flex: '0 0 50%',
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
            borderLeft: '1px solid var(--border)',
          }}
          className="preview-pane"
        >
          <MarkdownPreview note={{ ...note, content }} />
        </div>
      </div>

      {/* Responsive CSS */}
      <style>{`
        @media (max-width: 820px) {
          .mobile-tabs { display: flex !important; }
          .write-pane  { flex: 0 0 100% !important; display: ${mobileTab === 'write' ? 'block' : 'none'} !important; }
          .preview-pane { flex: 0 0 100% !important; border-left: none !important; display: ${mobileTab === 'preview' ? 'block' : 'none'} !important; }
        }
      `}</style>
    </div>
  );
}
