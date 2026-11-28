'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface ToolbarProps {
  onCommand: (cmd: string) => void;
  onImageUpload: (file: File) => void;
  onToggleDrawing: () => void;
  onExportPdf: () => void;
  onExportMd: () => void;
  onToggleFullScreenWrite?: () => void;
  onToggleFullScreenPreview?: () => void;
  onExitFullScreen?: () => void;
  fullScreenMode?: 'none' | 'write' | 'preview';
}

interface ToolItem {
  cmd: string;
  title: string;
  label?: string;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}

type ToolEntry = ToolItem | { sep: true };

const TOOLS: readonly ToolEntry[] = [
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

function isToolItem(entry: ToolEntry): entry is ToolItem {
  return !('sep' in entry);
}

export function Toolbar({
  onCommand,
  onImageUpload,
  onToggleDrawing,
  onExportPdf,
  onExportMd,
  onToggleFullScreenWrite,
  onToggleFullScreenPreview,
  onExitFullScreen,
  fullScreenMode = 'none',
}: ToolbarProps) {
  const imgRef = useRef<HTMLInputElement>(null);
  const mdRef = useRef<HTMLInputElement>(null);
  const [showMoreModal, setShowMoreModal] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    onImageUpload(file);
  };

  const handleMdImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result !== 'string') return;
      const title = file.name.replace(/\.md$/i, '');
      onCommand(`__import__:${JSON.stringify({ title, content: evt.target.result })}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowMoreModal(false);
      }
    }
    if (showMoreModal) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMoreModal]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '5px 12px',
        background: 'var(--bg-app)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        flexWrap: 'nowrap',
        overflowX: 'auto',
      }}
    >
      <input
        ref={imgRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={handleImageChange}
        style={{ display: 'none' }}
      />
      <input
        ref={mdRef}
        type="file"
        accept=".md,.markdown,.txt"
        onChange={handleMdImport}
        style={{ display: 'none' }}
      />

      {/* Formatting Tools */}
      <div className="toolbar-desktop-tools" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {TOOLS.map((item, idx) => {
          if ('sep' in item) {
            return (
              <div
                key={idx}
                style={{
                  width: 1,
                  height: 16,
                  background: 'var(--border)',
                  margin: '0 4px',
                }}
              />
            );
          }

          return (
            <button
              key={item.cmd}
              onClick={() => onCommand(item.cmd)}
              title={item.title}
              style={{
                background: 'none',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                padding: '4px 7px',
                fontWeight: 600,
                color: 'var(--ink-soft)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 26,
                height: 26,
                transition: 'background 0.12s, color 0.12s',
                ...('style' in item ? item.style : { fontSize: 13 }),
              }}
            >
              {'icon' in item ? item.icon : item.label}
            </button>
          );
        })}

        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />

        {/* Attachment & Drawing buttons */}
        <button
          onClick={() => imgRef.current?.click()}
          title="Attach Image"
          style={iconToolBtnStyle}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
        </button>

        <button
          onClick={onToggleDrawing}
          title="Draw / Canvas"
          style={iconToolBtnStyle}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
            <circle cx="11" cy="11" r="2"/>
          </svg>
        </button>

        {/* Fullscreen icons */}
        {onToggleFullScreenWrite && (
          <button
            onClick={onToggleFullScreenWrite}
            title={fullScreenMode === 'write' ? 'Exit Full Screen Write' : 'Full Screen Editor'}
            style={{
              ...iconToolBtnStyle,
              background: fullScreenMode === 'write' ? 'var(--hover)' : 'none',
              color: fullScreenMode === 'write' ? 'var(--accent)' : 'var(--ink-soft)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        )}

        {onToggleFullScreenPreview && (
          <button
            onClick={onToggleFullScreenPreview}
            title={fullScreenMode === 'preview' ? 'Exit Full Screen Preview' : 'Full Screen Preview'}
            style={{
              ...iconToolBtnStyle,
              background: fullScreenMode === 'preview' ? 'var(--hover)' : 'none',
              color: fullScreenMode === 'preview' ? 'var(--accent)' : 'var(--ink-soft)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* ... Button (ONLY visible in mobile view) */}
      <button
        className="mobile-tools-btn"
        onClick={() => setShowMoreModal(true)}
        title="More Tools (...)"
        style={{
          display: 'none',
          alignItems: 'center',
          gap: 4,
          padding: '5px 10px',
          border: '1px solid var(--accent)',
          background: 'var(--bg-app)',
          color: 'var(--accent)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'var(--font)',
          transition: 'all 0.15s',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>⋯</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Tools</span>
      </button>

      {/* Action buttons (Import, Export .md, Export PDF, Close Fullscreen) */}
      <div className="toolbar-actions-group" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ActionBtn onClick={() => mdRef.current?.click()} title="Import .md file">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Import
        </ActionBtn>
        <ActionBtn onClick={onExportMd} title="Download as .md">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
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
            flexShrink: 0,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          PDF
        </button>

        {/* Clean Close Fullscreen Button (Top Right Corner) */}
        {fullScreenMode !== 'none' && onExitFullScreen && (
          <button
            onClick={onExitFullScreen}
            title="Close Full Screen"
            style={{
              padding: '5px 8px',
              background: 'var(--danger)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 6,
              transition: 'opacity 0.15s',
              flexShrink: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Full Window Modal for "..." (More Options for phone view) */}
      {showMoreModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setShowMoreModal(false)}
        >
          <div
            ref={modalRef}
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--bg-paper)',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: '16px 20px 24px',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              animation: 'modalIn 0.2s ease-out',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                Editor Tools
              </span>
              <button
                onClick={() => setShowMoreModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setShowMoreModal(false); mdRef.current?.click(); }}
                style={mobileActionBtnStyle}
              >
                Import .md
              </button>
              <button
                onClick={() => { setShowMoreModal(false); onExportMd(); }}
                style={mobileActionBtnStyle}
              >
                Download .md
              </button>
              <button
                onClick={() => { setShowMoreModal(false); onExportPdf(); }}
                style={{ ...mobileActionBtnStyle, background: 'var(--accent)', color: '#fff', border: 'none' }}
              >
                Export PDF
              </button>
            </div>

            {/* Formatting Tools Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {TOOLS.filter(isToolItem).map((item) => (
                <button
                  key={item.cmd}
                  onClick={() => { setShowMoreModal(false); onCommand(item.cmd); }}
                  style={mobileGridToolStyle}
                  title={item.title}
                >
                  <span style={{ fontSize: 14 }}>{item.icon ?? item.label}</span>
                  <span style={{ fontSize: 10, marginTop: 2, color: 'var(--ink-muted)' }}>{item.cmd.toUpperCase()}</span>
                </button>
              ))}
              <button
                onClick={() => { setShowMoreModal(false); imgRef.current?.click(); }}
                style={mobileGridToolStyle}
                title="Attach Image"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
                <span style={{ fontSize: 10, marginTop: 2, color: 'var(--ink-muted)' }}>IMAGE</span>
              </button>
              <button
                onClick={() => { setShowMoreModal(false); onToggleDrawing(); }}
                style={mobileGridToolStyle}
                title="Draw Canvas"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                </svg>
                <span style={{ fontSize: 10, marginTop: 2, color: 'var(--ink-muted)' }}>DRAW</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Responsive toolbar styles */}
      <style>{`
        @media (max-width: 820px) {
          .toolbar-desktop-tools { display: none !important; }
          .toolbar-actions-group { display: flex !important; }
          .mobile-tools-btn       { display: flex !important; }
        }
      `}</style>
    </div>
  );
}

function ActionBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '5px 10px',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--ink-soft)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'var(--font)',
        transition: 'background 0.12s, color 0.12s',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

const iconToolBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  padding: '4px 6px',
  color: 'var(--ink-soft)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.12s, color 0.12s',
};

const mobileActionBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 10px',
  fontSize: 12.5,
  fontWeight: 500,
  background: 'var(--bg-app)',
  color: 'var(--ink)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  textAlign: 'center',
};

const mobileGridToolStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '10px 4px',
  background: 'var(--bg-app)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  color: 'var(--ink)',
};
