'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Module, Notebook } from '@/types/workspace';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { SearchInput } from '@/components/ui/SearchInput';
import {
  ChevronLeftIcon,
  CloseIcon,
  PlusIcon,
  PinIcon,
  SettingsIcon,
} from './icons';

interface EditorSidebarProps {
  currentModule?: Module | null;
  notebooks: Notebook[];
  activeNotebookId: string | null;
  onSelectNotebook: (notebook: Notebook) => void;
  onCreateNotebook: () => void;
  onDeleteNotebook?: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
  isMobile?: boolean;
  onOpenSettings?: () => void;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function EditorSidebar({
  currentModule,
  notebooks,
  activeNotebookId,
  onSelectNotebook,
  onCreateNotebook,
  onDeleteNotebook,
  isOpen,
  onClose,
  isMobile = false,
  onOpenSettings,
}: EditorSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter notebooks by search query
  const filteredNotebooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return notebooks;
    return notebooks.filter((n) => {
      const titleMatch = (n.title || '').toLowerCase().includes(q);
      const contentMatch = (n.content || '').toLowerCase().includes(q);
      return titleMatch || contentMatch;
    });
  }, [notebooks, searchQuery]);

  const moduleName = currentModule?.name || 'General';
  const moduleSlug = currentModule?.slug || currentModule?.id || 'general';
  const moduleColor = currentModule?.color || 'var(--accent)';

  const sidebarContent = (
    <aside
      className="editor-sidebar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: 'var(--sidebar-width, 260px)',
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* 1. Header & Navigation Back to Modules */}
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flexShrink: 0,
        }}
      >
        {/* Route Back to All Modules & Close */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link
            href="/modules"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--font-size-xs, 12px)',
              fontWeight: 600,
              color: 'var(--ink-soft)',
              textDecoration: 'none',
              padding: '4px 6px',
              borderRadius: 'var(--radius-sm)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--accent)';
              e.currentTarget.style.background = 'var(--hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--ink-soft)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <ChevronLeftIcon size={14} />
            <span>All Modules</span>
          </Link>

          {/* Close Sidebar button */}
          <IconButton
            aria-label="Close sidebar"
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </IconButton>
        </div>

        {/* Current Module Title Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: moduleColor,
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <Link
              href={`/${moduleSlug}`}
              title={`View ${moduleName} module details`}
              style={{
                fontFamily: 'var(--serif-font)',
                fontWeight: 700,
                fontSize: 15,
                color: 'var(--ink)',
                textDecoration: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {moduleName}
            </Link>
          </div>

          <span
            style={{
              fontSize: 'var(--font-size-xs, 11px)',
              fontWeight: 600,
              color: 'var(--ink-muted)',
              background: 'var(--bg-app)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              flexShrink: 0,
            }}
          >
            {notebooks.length}
          </span>
        </div>

        {/* Create Notebook Button */}
        <Button
          variant="primary"
          size="sm"
          fullWidth
          leftIcon={<PlusIcon size={14} />}
          onClick={onCreateNotebook}
        >
          New Notebook
        </Button>

        {/* Search Notebooks Input */}
        <SearchInput
          placeholder="Search notebooks…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery('')}
        />
      </div>

      {/* 2. Scrollable Notebook List */}
      <div
        role="navigation"
        aria-label="Notebooks in module"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {filteredNotebooks.length === 0 ? (
          <div
            style={{
              padding: '32px 12px',
              textAlign: 'center',
              color: 'var(--ink-muted)',
              fontSize: 'var(--font-size-xs, 12px)',
            }}
          >
            {searchQuery ? 'No matching notebooks.' : 'No notebooks in this module.'}
          </div>
        ) : (
          filteredNotebooks.map((n) => {
            const isActive = n.id === activeNotebookId;
            const title = n.title?.trim() || 'Untitled Notebook';

            return (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelectNotebook(n);
                  if (isMobile) onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectNotebook(n);
                    if (isMobile) onClose();
                  }
                }}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: isActive ? 'var(--hover)' : 'transparent',
                  borderLeft: isActive
                    ? '3px solid var(--accent)'
                    : '3px solid transparent',
                  cursor: 'pointer',
                  transition: 'background-color 0.12s ease',
                  outline: 'none',
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'var(--hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {n.isPinned && (
                      <PinIcon
                        size={11}
                        style={{ color: 'var(--gold)', flexShrink: 0 }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 'var(--font-size-sm, 13px)',
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                      }}
                    >
                      {title}
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: 'var(--font-size-xs, 11px)',
                      color: 'var(--ink-muted)',
                      marginTop: 2,
                      display: 'block',
                    }}
                  >
                    {formatDate(n.updatedAt)}
                  </span>
                </div>

                {/* Delete button (when provided) */}
                {onDeleteNotebook && (
                  <button
                    type="button"
                    aria-label={`Delete ${title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteNotebook(n.id);
                    }}
                    title="Delete notebook"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--ink-muted)',
                      padding: 4,
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isActive ? 0.8 : 0.4,
                      transition: 'opacity 0.12s ease, color 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.color = 'var(--danger)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = isActive ? '0.8' : '0.4';
                      e.currentTarget.style.color = 'var(--ink-muted)';
                    }}
                  >
                    <CloseIcon size={12} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 3. Footer: Settings & Appearance Entry Point */}
      {onOpenSettings && (
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
            background: 'var(--bg-sidebar)',
          }}
        >
          <button
            type="button"
            onClick={onOpenSettings}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              background: 'none',
              border: 'none',
              padding: '7px 8px',
              fontSize: 'var(--font-size-xs, 12px)',
              fontWeight: 500,
              color: 'var(--ink-soft)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--ink)';
              e.currentTarget.style.background = 'var(--hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--ink-soft)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <SettingsIcon size={16} />
            <span>Settings & Sync</span>
          </button>
        </div>
      )}
    </aside>
  );

  // If Mobile: Render Drawer with backdrop overlay
  if (isMobile) {
    return (
      <>
        {/* Backdrop overlay */}
        {isOpen && (
          <div
            onClick={onClose}
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(2px)',
              zIndex: 100,
              transition: 'opacity 0.25s ease',
            }}
          />
        )}

        {/* Drawer panel */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Notebooks sidebar drawer"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            bottom: 0,
            zIndex: 110,
            transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: isOpen ? '4px 0 24px rgba(0,0,0,0.18)' : 'none',
            maxWidth: '85vw',
          }}
        >
          {sidebarContent}
        </div>
      </>
    );
  }

  // If Desktop: Persistent/Collapsible in Document Flow
  return (
    <div
      style={{
        width: isOpen ? 'var(--sidebar-width, 260px)' : 0,
        overflow: 'hidden',
        transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        flexShrink: 0,
        height: '100%',
        display: 'flex',
      }}
    >
      <div style={{ width: 'var(--sidebar-width, 260px)', height: '100%' }}>
        {sidebarContent}
      </div>
    </div>
  );
}
