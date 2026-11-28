'use client';

import React from 'react';
import Link from 'next/link';
import type { Module } from '@/types/workspace';
import { Button } from '@/components/ui/Button';
import { ArrowBackIcon, PlusIcon } from './icons';

export interface ModuleHeaderProps {
  module: Module;
  notebookCount: number;
  onNewNotebook: () => void;
  isCreating?: boolean;
}

export function ModuleHeader({
  module,
  notebookCount,
  onNewNotebook,
  isCreating = false,
}: ModuleHeaderProps) {
  // Muted earthy fallback if module has no color
  const badgeColor = module.color || 'var(--gold)';

  return (
    <header
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        paddingBottom: 24,
        borderBottom: '1px solid var(--border)',
        marginBottom: 24,
      }}
    >
      {/* Navigation Row: Back to All Modules */}
      <div>
        <Link
          href="/modules"
          className="nb-focus-ring"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--font-size-sm, 13.5px)',
            color: 'var(--ink-soft)',
            textDecoration: 'none',
            padding: '4px 8px',
            marginLeft: -8,
            borderRadius: 'var(--radius-sm)',
            transition: 'color 0.15s ease, background-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--ink)';
            e.currentTarget.style.backgroundColor = 'var(--hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--ink-soft)';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <ArrowBackIcon size={14} />
          <span>All Modules</span>
        </Link>
      </div>

      {/* Main Module Banner Row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 260 }}>
          {/* Title row with badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: badgeColor,
                border: '1px solid var(--border)',
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <h1
              style={{
                fontFamily: 'var(--serif-font)',
                fontSize: 'clamp(1.5rem, 3.5vw, 2rem)',
                fontWeight: 700,
                color: 'var(--ink)',
                margin: 0,
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
              }}
            >
              {module.name}
            </h1>
            <span
              style={{
                fontSize: 'var(--font-size-xs, 12px)',
                color: 'var(--ink-muted)',
                background: 'var(--bg-sidebar)',
                border: '1px solid var(--border)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 500,
              }}
            >
              {notebookCount} {notebookCount === 1 ? 'notebook' : 'notebooks'}
            </span>
          </div>

          {/* Description if present */}
          {module.description && (
            <p
              style={{
                fontFamily: 'var(--font)',
                fontSize: 'var(--font-size-sm, 14px)',
                color: 'var(--ink-soft)',
                margin: 0,
                maxWidth: 620,
                lineHeight: 1.5,
              }}
            >
              {module.description}
            </p>
          )}
        </div>

        {/* Action Button */}
        <div style={{ flexShrink: 0 }}>
          <Button
            variant="primary"
            size="md"
            onClick={onNewNotebook}
            isLoading={isCreating}
            leftIcon={<PlusIcon size={15} />}
          >
            New Notebook
          </Button>
        </div>
      </div>
    </header>
  );
}
