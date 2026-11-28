'use client';

import React, { useState } from 'react';
import type { Module } from '@/types/workspace';
import { DEFAULT_MODULE_ID } from '@/types/workspace';
import { Dropdown, type DropdownItem } from '@/components/ui/Dropdown';
import { IconButton } from '@/components/ui/IconButton';
import {
  FolderIcon,
  NotebookIcon,
  MoreVerticalIcon,
  EditIcon,
  ArchiveIcon,
  UnarchiveIcon,
  TrashIcon,
  ClockIcon,
} from './icons';

export interface ModuleCardProps {
  module: Module;
  notebookCount?: number;
  variant?: 'standard' | 'compact';
  onOpen: (module: Module) => void;
  onRename?: (module: Module) => void;
  onToggleArchive?: (module: Module) => void;
  onDelete?: (module: Module) => void;
  className?: string;
  style?: React.CSSProperties;
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function ModuleCard({
  module,
  notebookCount = 0,
  variant = 'standard',
  onOpen,
  onRename,
  onToggleArchive,
  onDelete,
  className = '',
  style,
}: ModuleCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isDefault = module.id === DEFAULT_MODULE_ID;
  const isArchived = Boolean(module.isArchived);

  // Color theme for module accent
  const moduleColor = module.color?.trim() || 'var(--accent)';

  // Dropdown action items
  const menuItems: DropdownItem[] = [];

  if (onRename) {
    menuItems.push({
      id: 'rename',
      label: 'Rename',
      icon: <EditIcon size={14} />,
      onClick: () => onRename(module),
    });
  }

  if (onToggleArchive) {
    menuItems.push({
      id: 'archive',
      label: isArchived ? 'Unarchive' : 'Archive',
      icon: isArchived ? <UnarchiveIcon size={14} /> : <ArchiveIcon size={14} />,
      onClick: () => onToggleArchive(module),
    });
  }

  if (onDelete && !isDefault) {
    menuItems.push({
      id: 'divider',
      label: '',
      divider: true,
    });
    menuItems.push({
      id: 'delete',
      label: 'Delete Module',
      icon: <TrashIcon size={14} />,
      danger: true,
      onClick: () => onDelete(module),
    });
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Avoid triggering if clicked on dropdown or buttons
    if ((e.target as HTMLElement).closest('.nb-module-card-actions')) {
      return;
    }
    onOpen(module);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if ((e.target as HTMLElement).closest('.nb-module-card-actions')) {
        return;
      }
      e.preventDefault();
      onOpen(module);
    }
  };

  // Compact variant for Recently Opened section
  if (variant === 'compact') {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`nb-focus-ring ${className}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          background: isHovered ? 'var(--hover)' : 'var(--bg-paper)',
          borderRadius: 'var(--radius)',
          border: isHovered ? '1px solid var(--accent-soft)' : '1px solid var(--border)',
          boxShadow: isHovered ? 'var(--shadow-sm)' : 'none',
          cursor: 'pointer',
          transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
          position: 'relative',
          userSelect: 'none',
          minWidth: 200,
          ...style,
        }}
        aria-label={`Open recent module ${module.name}`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--radius-control)',
              background: 'var(--bg-sidebar)',
              border: `1.5px solid ${moduleColor}`,
              color: moduleColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FolderIcon size={18} />
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 'var(--font-size-sm, 13px)',
                  fontWeight: 600,
                  color: 'var(--ink)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: '1.3',
                }}
              >
                {module.name}
              </span>
              {isDefault && (
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--gold)',
                    background: 'var(--bg-sidebar)',
                    padding: '1px 5px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    flexShrink: 0,
                  }}
                >
                  Default
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: 'var(--font-size-xs, 12px)',
                color: 'var(--ink-muted)',
                marginTop: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <NotebookIcon size={12} />
              <span>
                {notebookCount} {notebookCount === 1 ? 'notebook' : 'notebooks'}
              </span>
            </div>
          </div>
        </div>

        {menuItems.length > 0 && (
          <div className="nb-module-card-actions" onClick={(e) => e.stopPropagation()}>
            <Dropdown
              align="right"
              trigger={
                <IconButton
                  aria-label={`Actions for ${module.name}`}
                  size="sm"
                  variant="ghost"
                  style={{ opacity: isHovered ? 1 : 0.6 }}
                >
                  <MoreVerticalIcon size={14} />
                </IconButton>
              }
              items={menuItems}
            />
          </div>
        )}
      </div>
    );
  }

  // Standard Grid Card variant
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`nb-focus-ring ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '18px 20px',
        background: 'var(--bg-paper)',
        borderRadius: 'var(--radius-panel, 12px)',
        border: isHovered ? '1px solid var(--accent-soft)' : '1px solid var(--border)',
        boxShadow: isHovered ? 'var(--shadow)' : 'var(--shadow-sm)',
        cursor: 'pointer',
        transition: 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s ease',
        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
        position: 'relative',
        userSelect: 'none',
        minHeight: 160,
        opacity: isArchived ? 0.75 : 1,
        ...style,
      }}
      aria-label={`Open module ${module.name}`}
    >
      {/* Top row: Color tab/folder icon, Name, Actions */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-control)',
                background: 'var(--bg-sidebar)',
                border: `1.5px solid ${moduleColor}`,
                color: moduleColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FolderIcon size={20} />
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <h3
                  style={{
                    fontFamily: 'var(--serif-font)',
                    fontSize: 'var(--font-size-base, 16px)',
                    fontWeight: 600,
                    color: 'var(--ink)',
                    margin: 0,
                    lineHeight: '1.3',
                    wordBreak: 'break-word',
                  }}
                >
                  {module.name}
                </h3>

                {isDefault && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: 'var(--gold)',
                      background: 'var(--bg-sidebar)',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      flexShrink: 0,
                    }}
                  >
                    Default
                  </span>
                )}

                {isArchived && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: 'var(--ink-muted)',
                      background: 'var(--bg-sidebar)',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      flexShrink: 0,
                    }}
                  >
                    Archived
                  </span>
                )}
              </div>
            </div>
          </div>

          {menuItems.length > 0 && (
            <div className="nb-module-card-actions" onClick={(e) => e.stopPropagation()}>
              <Dropdown
                align="right"
                trigger={
                  <IconButton
                    aria-label={`Actions for ${module.name}`}
                    size="sm"
                    variant="ghost"
                    style={{
                      color: 'var(--ink-muted)',
                      opacity: isHovered ? 1 : 0.7,
                      transition: 'opacity 0.15s ease',
                    }}
                  >
                    <MoreVerticalIcon size={16} />
                  </IconButton>
                }
                items={menuItems}
              />
            </div>
          )}
        </div>

        {/* Description */}
        <p
          style={{
            fontSize: 'var(--font-size-sm, 13px)',
            color: module.description ? 'var(--ink-soft)' : 'var(--ink-muted)',
            fontStyle: module.description ? 'normal' : 'italic',
            lineHeight: '1.5',
            margin: '0 0 16px 0',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {module.description || 'No description'}
        </p>
      </div>

      {/* Footer: Notebook count & timestamp */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--border)',
          paddingTop: 12,
          marginTop: 'auto',
          fontSize: 'var(--font-size-xs, 12px)',
          color: 'var(--ink-muted)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <NotebookIcon size={13} />
          <span>
            {notebookCount} {notebookCount === 1 ? 'notebook' : 'notebooks'}
          </span>
        </div>

        {module.updatedAt && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ClockIcon size={12} />
            <span>{formatRelativeTime(module.updatedAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
