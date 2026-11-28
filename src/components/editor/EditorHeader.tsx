'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Module, Notebook } from '@/types/workspace';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import {
  MenuIcon,
  NotebookLogo,
  MoreVerticalIcon,
  PdfIcon,
  MarkdownIcon,
} from './icons';

interface EditorHeaderProps {
  module?: Module | null;
  notebook?: Notebook | null;
  onToggleSidebar: () => void;
  isSidebarOpen?: boolean;
  onExportPdf?: () => void;
  onExportMd?: () => void;
  lastSavedAt?: string;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diffSec = Math.floor((now - date.getTime()) / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function EditorHeader({
  module,
  notebook,
  onToggleSidebar,
  isSidebarOpen = false,
  onExportPdf,
  onExportMd,
  lastSavedAt,
}: EditorHeaderProps) {
  const router = useRouter();

  const moduleSlug = module?.slug || module?.id || 'general';
  const moduleName = module?.name || 'General';
  const notebookTitle = notebook?.title?.trim() || 'Untitled Notebook';

  const exportItems: DropdownItem[] = [
    ...(onExportPdf
      ? [
          {
            id: 'export-pdf',
            label: 'Export as PDF',
            icon: <PdfIcon size={14} />,
            onClick: onExportPdf,
          },
        ]
      : []),
    ...(onExportMd
      ? [
          {
            id: 'export-md',
            label: 'Export as Markdown',
            icon: <MarkdownIcon size={14} />,
            onClick: onExportMd,
          },
        ]
      : []),
  ];

  return (
    <header
      className="editor-header"
      style={{
        height: 'var(--header-height, 56px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-app)',
        flexShrink: 0,
        gap: 12,
        userSelect: 'none',
        zIndex: 20,
      }}
    >
      {/* Left: Sidebar toggle, Logo, and Breadcrumb */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          flex: '1 1 auto',
        }}
      >
        {/* Sidebar Toggle Button */}
        <IconButton
          aria-label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          variant="ghost"
          size="sm"
          onClick={onToggleSidebar}
        >
          <MenuIcon size={18} />
        </IconButton>

        {/* Notebook Logo (Clicking navigates to /modules) */}
        <button
          type="button"
          onClick={() => router.push('/modules')}
          title="Notebook Workspace (/modules)"
          aria-label="Navigate to Modules overview"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: 'var(--accent)',
            borderRadius: 'var(--radius-sm)',
            flexShrink: 0,
          }}
        >
          <NotebookLogo size={20} />
        </button>

        <span
          style={{
            color: 'var(--border)',
            fontSize: 14,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          /
        </span>

        {/* Breadcrumb: Module Link */}
        <Link
          href={`/${moduleSlug}`}
          title={`Back to ${moduleName}`}
          style={{
            fontFamily: 'var(--font)',
            fontSize: 'var(--font-size-sm, 13px)',
            fontWeight: 500,
            color: 'var(--ink-soft)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 160,
            flexShrink: 1,
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--ink-soft)';
          }}
        >
          {moduleName}
        </Link>

        <span
          style={{
            color: 'var(--border)',
            fontSize: 14,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          /
        </span>

        {/* Breadcrumb: Current Notebook Title */}
        <span
          style={{
            fontFamily: 'var(--font)',
            fontSize: 'var(--font-size-sm, 13px)',
            fontWeight: 600,
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 240,
            flexShrink: 2,
          }}
        >
          {notebookTitle}
        </span>
      </div>

      {/* Right: Saved Indicator & Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
        {/* Saved status text */}
        {lastSavedAt && (
          <span
            className="editor-saved-indicator"
            style={{
              fontSize: 'var(--font-size-xs, 12px)',
              color: 'var(--ink-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            Saved {formatRelativeTime(lastSavedAt)}
          </span>
        )}

        {/* Export Dropdown Menu */}
        {exportItems.length > 0 && (
          <Dropdown
            align="right"
            trigger={
              <Button
                variant="ghost"
                size="sm"
                aria-label="Notebook export actions"
                leftIcon={<MoreVerticalIcon size={16} />}
              >
                <span className="export-btn-label">Export</span>
              </Button>
            }
            items={exportItems}
          />
        )}
      </div>

      <style>{`
        @media (max-width: 640px) {
          .editor-saved-indicator {
            display: none !important;
          }
          .export-btn-label {
            display: none !important;
          }
        }
      `}</style>
    </header>
  );
}
