'use client';

import React, { useCallback, useRef } from 'react';

interface ToolbarProps {
  onCommand: (cmd: string) => void;
  onImageUpload: (file: File) => void;
  onToggleDrawing: () => void;
  onOpenMd: () => void;
  onExportPdf: () => void;
  onExportMd: () => void;
}

const TOOLS = [
  { cmd: 'bold',          label: 'B',    title: 'Bold (Ctrl+B)',        style: { fontWeight: 700, fontSize: 14 } },
  { cmd: 'italic',        label: 'I',    title: 'Italic (Ctrl+I)',      style: { fontStyle: 'italic', fontSize: 14 } },
  { cmd: 'strikethrough', label: 'S',    title: 'Strikethrough',        style: { textDecoration: 'line-through', fontSize: 13 } },
  { sep: true },
  { cmd: 'h1',            label: 'H1',   title: 'Heading 1' },
  { cmd: 'h2',            label: 'H2',   title: 'Heading 2' },
  { cmd: 'h3',            label: 'H3',   title: 'Heading 3' },
  { sep: true },
  {
    cmd: 'ul',
    title: 'Bullet List',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/>
        <circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>
      </svg>
    ),
  },
  {
    cmd: 'ol',
    title: 'Numbered List',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
        <path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>
      </svg>
    ),
  },
  { sep: true },
  {
    cmd: 'quote',
    title: 'Blockquote',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/>
        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
      </svg>
    ),
  },
  { cmd: 'code', label: '</>', title: 'Code Block', style: { fontFamily: 'var(--mono-font)', fontSize: 12 } },
  { sep: true },
  {
    cmd: 'link',
    title: 'Insert Link',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    ),
  },
  {
    cmd: 'hr',
    title: 'Horizontal Rule',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="12" x2="21" y2="12"/>
      </svg>
    ),
  },
] as const;

export function Toolbar({ onCommand, onImageUpload, onToggleDrawing, onOpenMd, onExportPdf, onExportMd }: ToolbarProps) {
  const imgRef = useRef<HTMLInputElement>(null);
  const mdRef = useRef<HTMLInputElement>(null);

  const handleImageChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please choose an image file.'); return; }
    onImageUpload(file);
    e.target.value = '';
  }, [onImageUpload]);

  const handleMdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const title = file.name.replace(/\.(md|markdown)$/i, '').trim() || 'Untitled';
      onCommand(`__import__:${JSON.stringify({ title, content })}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [onCommand]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
        padding: '6px 20px',
        borderBottom: '1px solid var(--border)',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-paper)',
        flexShrink: 0,
      }}
    >
      <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
      <input ref={mdRef} type="file" accept=".md,.markdown" style={{ display: 'none' }} onChange={handleMdChange} />

      {TOOLS.map((t, i) => {
        if ('sep' in t && t.sep) {
          return <div key={`sep-${i}`} style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px', flexShrink: 0 }} />;
        }
        const tool = t as { cmd: string; label?: string; title: string; icon?: React.ReactNode; style?: React.CSSProperties };
        return (
          <ToolBtn
            key={tool.cmd}
            title={tool.title}
            style={tool.style}
            onClick={() => onCommand(tool.cmd)}
          >
            {tool.icon ?? tool.label}
          </ToolBtn>
        );
      })}

      <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />

      {/* Image */}
      <ToolBtn title="Insert Image" onClick={() => imgRef.current?.click()}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
      </ToolBtn>

      {/* Draw */}
      <ToolBtn title="Drawing canvas" onClick={onToggleDrawing}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>
        </svg>
      </ToolBtn>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Action buttons */}
      <ActionBtn onClick={() => mdRef.current?.click()} title="Import .md file">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        Import
      </ActionBtn>
      <ActionBtn onClick={onExportMd} title="Download as .md">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        .md
      </ActionBtn>
      <button
        onClick={onExportPdf}
        title="Export as PDF"
        style={{
          padding: '6px 12px',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontFamily: 'var(--font)',
          transition: 'background 0.15s',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
        </svg>
        PDF
      </button>
    </div>
  );
}

function ToolBtn({
  children,
  title,
  style,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  style?: React.CSSProperties;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 28,
        border: '1px solid var(--border)',
        background: 'var(--bg-sidebar)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        color: 'var(--ink-soft)',
        fontSize: 13,
        fontFamily: 'var(--font)',
        transition: 'all 0.1s',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function ActionBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '6px 10px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-paper)',
        color: 'var(--ink-soft)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--font)',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}
