'use client';

import React, { useState } from 'react';
import type { Notebook } from '@/types/workspace';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { IconButton } from '@/components/ui/IconButton';
import { FocusStyles } from '@/components/ui/focus-styles';
import {
  PinIcon,
  MoreHorizontalIcon,
  EditPencilIcon,
  MoveFolderIcon,
  TrashIcon,
  AttachmentClipIcon,
} from './icons';
import { formatNotebookDate, stripMarkdown } from './utils';

export interface NotebookCardProps {
  notebook: Notebook;
  onOpen: (id: string) => void;
  onRename: (notebook: Notebook) => void;
  onMove: (notebook: Notebook) => void;
  onDelete: (notebook: Notebook) => void;
}

export function NotebookCard({
  notebook,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: NotebookCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const title = notebook.title?.trim() || 'Untitled';
  const preview = stripMarkdown(notebook.content);
  const formattedDate = formatNotebookDate(notebook.updatedAt || notebook.createdAt);
  const attachmentCount = notebook.attachments ? Object.keys(notebook.attachments).length : 0;

  const menuItems: DropdownItem[] = [
    {
      id: 'rename',
      label: 'Rename',
      icon: <EditPencilIcon size={14} />,
      onClick: () => onRename(notebook),
    },
    {
      id: 'move',
      label: 'Move to module…',
      icon: <MoveFolderIcon size={14} />,
      onClick: () => onMove(notebook),
    },
    {
      id: 'delete',
      label: 'Delete notebook',
      danger: true,
      icon: <TrashIcon size={14} />,
      onClick: () => onDelete(notebook),
    },
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open notebook ${title}`}
      onClick={() => onOpen(notebook.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(notebook.id);
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="nb-focus-ring"
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 160,
        background: 'var(--bg-paper)',
        border: `1px solid ${isHovered ? 'var(--gold)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '16px 18px',
        cursor: 'pointer',
        boxShadow: isHovered
          ? '0 4px 12px color-mix(in srgb, var(--ink) 8%, transparent)'
          : 'var(--shadow-sm)',
        transition: 'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
        transform: isHovered ? 'translateY(-2px)' : 'none',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <FocusStyles />

      {/* Top Header: Title, Pin Badge, Actions */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 10,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              flex: 1,
            }}
          >
            <h3
              style={{
                fontFamily: 'var(--serif-font)',
                fontSize: 'var(--font-size-base, 16px)',
                fontWeight: 600,
                color: 'var(--ink)',
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: 1.3,
              }}
            >
              {title}
            </h3>

            {notebook.isPinned && (
              <span
                title="Pinned notebook"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)',
                  color: 'var(--gold)',
                  fontSize: '0.7rem',
                  fontWeight: 500,
                  flexShrink: 0,
                }}
              >
                <PinIcon size={10} />
                <span>Pinned</span>
              </span>
            )}
          </div>

          {/* Action Menu Dropdown */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            style={{ flexShrink: 0, marginTop: -2 }}
          >
            <Dropdown
              align="right"
              items={menuItems}
              minWidth={170}
              trigger={({ toggle }) => (
                <IconButton
                  aria-label={`Actions for ${title}`}
                  size="sm"
                  variant="ghost"
                  onClick={toggle}
                  style={{
                    color: isHovered ? 'var(--ink)' : 'var(--ink-muted)',
                    opacity: isHovered ? 1 : 0.75,
                  }}
                >
                  <MoreHorizontalIcon size={16} />
                </IconButton>
              )}
            />
          </div>
        </div>

        {/* Snippet / Content Preview */}
        <p
          style={{
            fontFamily: 'var(--font)',
            fontSize: 'var(--font-size-sm, 13.5px)',
            color: 'var(--ink-soft)',
            lineHeight: 1.5,
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            wordBreak: 'break-word',
          }}
        >
          {preview}
        </p>
      </div>

      {/* Footer Info: Last Modified & Attachments */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          paddingTop: 10,
          borderTop: '1px solid var(--border)',
          fontSize: 'var(--font-size-xs, 12px)',
          color: 'var(--ink-muted)',
        }}
      >
        <span style={{ fontFamily: 'var(--font)' }}>
          Updated {formattedDate}
        </span>

        {attachmentCount > 0 && (
          <span
            title={`${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--ink-muted)',
            }}
          >
            <AttachmentClipIcon size={12} />
            <span>{attachmentCount}</span>
          </span>
        )}
      </div>
    </div>
  );
}
