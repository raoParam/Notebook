'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface ToolbarProps {
  onCommand: (cmd: string) => void;
  onImageUpload: (file: File) => void;
  onToggleDrawing: () => void;
  onOpenMd: () => void;
  onExportPdf: () => void;
  onExportMd: () => void;
  onToggleFullScreenWrite?: () => void;
  onToggleFullScreenPreview?: () => void;
  fullScreenMode?: 'none' | 'write' | 'preview';
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

export function Toolbar({
  onCommand,
  onImageUpload,
  onToggleDrawing,
  onExportPdf,
  onExportMd,
  onToggleFullScreenWrite,
  onToggleFullScreenPreview,
  fullScreenMode = 'none',
}: ToolbarProps) {
  const imgRef = useRef<HTMLInputElement>(null);
  const mdRef = useRef<HTMLInputElement>(null);
  const [showMoreModal, setShowMoreModal] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleImageChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        alert('Please choose an image file.');
        return;
      }
      onImageUpload(file);
      e.target.value = '';
    },
    [onImageUpload]
  );

  const handleMdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
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
    },
    [onCommand]
  );

  // Close ... menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!showMoreModal) return;

    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowMoreModal(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setShowMoreModal(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showMoreModal]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
        padding: '6px 14px',
        borderBottom: '1px solid var(--border)',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-paper)',
        flexShrink: 0,
      }}
    >
      <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
      <input ref={mdRef} type="file" accept=".md,.markdown" style={{ display: 'none' }} onChange={handleMdChange} />

      {/* Primary Desktop Tools (Hidden on small mobile screens to prevent clutter) */}
      <div className="toolbar-desktop-tools" style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {TOOLS.map((t, i) => {
          if ('sep' in t && t.sep) {
            return (
              <div
                key={`sep-${i}`}
                style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px', flexShrink: 0 }}
              />
            );
          }
          const tool = t as {
            cmd: string;
            label?: string;
            title: string;
            icon?: React.ReactNode;
            style?: React.CSSProperties;
          };
          return (
            <ToolBtn key={tool.cmd} title={tool.title} style={tool.style} onClick={() => onCommand(tool.cmd)}>
              {tool.icon ?? tool.label}
            </ToolBtn>
          );
        })}

        <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />

        {/* Image */}
        <ToolBtn title="Insert Image" onClick={() => imgRef.current?.click()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </ToolBtn>

        {/* Draw */}
        <ToolBtn title="Drawing canvas" onClick={onToggleDrawing}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18" />
            <path d="M2 2l7.586 7.586" />
            <circle cx="11" cy="11" r="2" />
          </svg>
        </ToolBtn>
      </div>

      {/* Mobile Streamlined Quick Bar (Only shown on mobile) */}
      <div className="toolbar-mobile-quick" style={{ display: 'none', alignItems: 'center', gap: 4 }}>
        <ToolBtn title="Bold" onClick={() => onCommand('bold')} style={{ fontWeight: 700 }}>
          B
        </ToolBtn>
        <ToolBtn title="Italic" onClick={() => onCommand('italic')} style={{ fontStyle: 'italic' }}>
          I
        </ToolBtn>
        <ToolBtn title="Heading 1" onClick={() => onCommand('h1')}>
          H1
        </ToolBtn>
        <ToolBtn title="Insert Image" onClick={() => imgRef.current?.click()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </ToolBtn>
        <ToolBtn title="Drawing canvas" onClick={onToggleDrawing}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18" />
          </svg>
        </ToolBtn>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* ... Button (ONLY visible in phone/mobile view) */}
      <button
        className="mobile-tools-btn"
        onClick={() => setShowMoreModal(true)}
        title="More Tools (...)"
        style={{
          display: 'none', // Controlled by CSS @media (max-width: 820px)
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

      {/* Action buttons (Import, Export .md, Export PDF) */}
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
      </div>

      {/* Full Window Modal for "..." (More Options for phone view) */}
      {showMoreModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowMoreModal(false)}
        >
          <div
            ref={modalRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 440,
              maxHeight: '85vh',
              background: 'var(--bg-paper)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              animation: 'modalIn 0.18s ease-out',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-app)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--accent)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  ⋯
                </span>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>
                    Markdown Tools & Actions
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                    Tap anywhere outside to close
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowMoreModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--ink-soft)',
                  padding: 6,
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Close menu"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div
              style={{
                padding: 16,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {/* Category: Text Formatting */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Formatting
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <ModalGridBtn label="Bold" icon="B" onClick={() => { onCommand('bold'); setShowMoreModal(false); }} />
                  <ModalGridBtn label="Italic" icon="I" onClick={() => { onCommand('italic'); setShowMoreModal(false); }} style={{ fontStyle: 'italic' }} />
                  <ModalGridBtn label="Strike" icon="S" onClick={() => { onCommand('strikethrough'); setShowMoreModal(false); }} style={{ textDecoration: 'line-through' }} />
                  <ModalGridBtn label="Code" icon="</>" onClick={() => { onCommand('code'); setShowMoreModal(false); }} />
                  <ModalGridBtn label="Quote" icon="”" onClick={() => { onCommand('quote'); setShowMoreModal(false); }} />
                  <ModalGridBtn label="Divider" icon="―" onClick={() => { onCommand('hr'); setShowMoreModal(false); }} />
                </div>
              </div>

              {/* Category: Headings & Lists */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Structure
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <ModalGridBtn label="Heading 1" icon="H1" onClick={() => { onCommand('h1'); setShowMoreModal(false); }} />
                  <ModalGridBtn label="Heading 2" icon="H2" onClick={() => { onCommand('h2'); setShowMoreModal(false); }} />
                  <ModalGridBtn label="Heading 3" icon="H3" onClick={() => { onCommand('h3'); setShowMoreModal(false); }} />
                  <ModalGridBtn label="Bullet List" icon="•" onClick={() => { onCommand('ul'); setShowMoreModal(false); }} />
                  <ModalGridBtn label="Num List" icon="1." onClick={() => { onCommand('ol'); setShowMoreModal(false); }} />
                  <ModalGridBtn label="Link" icon="🔗" onClick={() => { onCommand('link'); setShowMoreModal(false); }} />
                </div>
              </div>

              {/* Category: Insert Media */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Media & Canvas
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  <ModalGridBtn
                    label="Insert Image"
                    icon="📷"
                    onClick={() => {
                      imgRef.current?.click();
                      setShowMoreModal(false);
                    }}
                  />
                  <ModalGridBtn
                    label="Drawing Canvas"
                    icon="🎨"
                    onClick={() => {
                      onToggleDrawing();
                      setShowMoreModal(false);
                    }}
                  />
                </div>
              </div>

              {/* Category: Full Screen Modes */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  Full Screen Modes
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                  {onToggleFullScreenWrite && (
                    <ModalGridBtn
                      label={fullScreenMode === 'write' ? 'Exit Full Write' : 'Full Screen Write'}
                      icon="⛶"
                      highlight
                      onClick={() => {
                        onToggleFullScreenWrite();
                        setShowMoreModal(false);
                      }}
                    />
                  )}
                  {onToggleFullScreenPreview && (
                    <ModalGridBtn
                      label={fullScreenMode === 'preview' ? 'Exit Full Preview' : 'Full Screen Preview'}
                      icon="👁️"
                      highlight
                      onClick={() => {
                        onToggleFullScreenPreview();
                        setShowMoreModal(false);
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Category: File Operations */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                  File & Export
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <ModalGridBtn
                    label="Import .md"
                    icon="📂"
                    onClick={() => {
                      mdRef.current?.click();
                      setShowMoreModal(false);
                    }}
                  />
                  <ModalGridBtn
                    label="Export .md"
                    icon="💾"
                    onClick={() => {
                      onExportMd();
                      setShowMoreModal(false);
                    }}
                  />
                  <ModalGridBtn
                    label="Export PDF"
                    icon="📄"
                    onClick={() => {
                      onExportPdf();
                      setShowMoreModal(false);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Responsive Styles */}
      <style>{`
        .mobile-tools-btn { display: none !important; }
        @media (max-width: 820px) {
          .toolbar-desktop-tools { display: none !important; }
          .toolbar-mobile-quick  { display: flex !important; }
          .toolbar-actions-group { display: none !important; }
          .mobile-tools-btn { display: flex !important; }
        }
      `}</style>
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
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function ModalGridBtn({
  label,
  icon,
  onClick,
  style,
  highlight = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  style?: React.CSSProperties;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px 8px',
        gap: 4,
        background: highlight ? 'var(--accent)' : 'var(--bg-sidebar)',
        border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        color: highlight ? '#ffffff' : 'var(--ink)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'var(--font)',
        transition: 'transform 0.1s ease, background 0.12s ease',
        ...style,
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
        {label}
      </span>
    </button>
  );
}
