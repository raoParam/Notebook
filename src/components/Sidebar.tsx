'use client';

import React, { useEffect, useRef } from 'react';
import type { Note } from '@/lib/db';
import type { SortOrder } from '@/hooks/useNotes';

interface SidebarProps {
  notes: Note[];
  activeId: string | null;
  sortOrder: SortOrder;
  onSelectNote: (id: string) => void;
  onAddNote: () => void;
  onDeleteNote: (id: string) => void;
  onSortChange: (order: SortOrder) => void;
  onClose?: () => void;
  connectedCount: number;
  onOpenSettings: () => void;
  onOpenPairDevice: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function stripMarkdown(s: string): string {
  return s.replace(/[#*`>[\]!|~_\-]/g, '').trim().slice(0, 60) || 'Empty note';
}

export function Sidebar({
  notes,
  activeId,
  sortOrder,
  onSelectNote,
  onAddNote,
  onDeleteNote,
  onSortChange,
  onClose,
  connectedCount,
  onOpenSettings,
  onOpenPairDevice,
}: SidebarProps) {
  const listRef = useRef<HTMLDivElement>(null);

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontFamily: 'var(--serif-font)',
              fontWeight: 600,
              fontSize: 16,
              color: 'var(--accent)',
            }}
          >
            Notebook
          </span>
          {onClose && (
            <button onClick={onClose} title="Close sidebar" style={iconBtnStyle}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* Add note button */}
        <button onClick={onAddNote} style={addBtnStyle}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Note
        </button>

        {/* Sort + Pair row */}
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={sortOrder}
            onChange={(e) => onSortChange(e.target.value as SortOrder)}
            style={{
              flex: 1,
              padding: '6px 8px',
              background: 'var(--bg-paper)',
              color: 'var(--ink)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
              fontFamily: 'var(--font)',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="lastChange">Last changed</option>
            <option value="ascending">A → Z</option>
            <option value="descending">Z → A</option>
          </select>
          <button
            onClick={onOpenPairDevice}
            title="Pair a device"
            style={{
              ...iconBtnStyle,
              position: 'relative',
              flexShrink: 0,
              padding: '6px 10px',
              fontSize: 12,
              gap: 5,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
            </svg>
            Pair
            {connectedCount > 0 && (
              <span
                title={`${connectedCount} device(s) connected`}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: '#22c55e',
                }}
              />
            )}
          </button>
        </div>
      </div>

      {/* Notes list */}
      <div
        ref={listRef}
        style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}
      >
        {notes.length === 0 ? (
          <p style={{ padding: '20px 12px', textAlign: 'center', fontSize: 13, color: 'var(--ink-muted)' }}>
            No notes yet. Create one!
          </p>
        ) : (
          notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              isActive={note.id === activeId}
              onSelect={() => onSelectNote(note.id)}
              onDelete={() => onDeleteNote(note.id)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  padding: 6,
  color: 'var(--ink-soft)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'color 0.12s, background 0.12s',
};

const addBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 14px',
  background: 'var(--accent)',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 'var(--radius)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  fontFamily: 'var(--font)',
  transition: 'background 0.15s',
};

function NoteItem({
  note,
  isActive,
  onSelect,
  onDelete,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 10px',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        marginBottom: 2,
        position: 'relative',
        borderLeft: `3px solid ${isActive ? 'var(--gold)' : 'transparent'}`,
        background: isActive
          ? 'var(--bg-paper)'
          : hovered
          ? 'var(--hover)'
          : 'transparent',
        boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
        transition: 'background 0.1s',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
        {note.title.trim() || 'Untitled'}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {stripMarkdown(note.content)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 }}>
        {formatDate(note.updatedAt)}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete note"
        style={{
          position: 'absolute',
          top: 8,
          right: 7,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
          color: 'var(--ink-muted)',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.15s, color 0.15s',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  );
}
