'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { ArrowLeftIcon, PlusIcon, FolderIcon } from './icons';

export interface ModulesHeaderProps {
  totalModules: number;
  onNewModule: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ModulesHeader({
  totalModules,
  onNewModule,
  className = '',
  style,
}: ModulesHeaderProps) {
  return (
    <header
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 'var(--header-height, 56px)',
        minHeight: 'var(--header-height, 56px)',
        padding: '0 24px',
        background: 'var(--bg-paper)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        ...style,
      }}
    >
      {/* Left: Brand / Title / Count badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textDecoration: 'none',
            color: 'inherit',
          }}
          title="Return to Editor"
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 'var(--radius-control)',
              background: 'var(--accent)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FolderIcon size={16} />
          </div>
          <span
            style={{
              fontFamily: 'var(--serif-font)',
              fontWeight: 700,
              fontSize: 'var(--font-size-lg, 17px)',
              color: 'var(--ink)',
              letterSpacing: '-0.01em',
            }}
          >
            Notebook
          </span>
        </Link>

        <span
          style={{
            color: 'var(--border)',
            userSelect: 'none',
            fontSize: '14px',
          }}
        >
          /
        </span>

        <span
          style={{
            fontFamily: 'var(--font)',
            fontWeight: 600,
            fontSize: 'var(--font-size-base, 15px)',
            color: 'var(--ink-soft)',
          }}
        >
          Modules
        </span>

        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: '9999px',
            fontSize: 'var(--font-size-xs, 12px)',
            fontWeight: 500,
            background: 'var(--bg-sidebar)',
            color: 'var(--ink-muted)',
            border: '1px solid var(--border)',
          }}
        >
          {totalModules} {totalModules === 1 ? 'module' : 'modules'}
        </span>
      </div>

      {/* Right: Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <Button variant="secondary" size="md" leftIcon={<ArrowLeftIcon size={14} />}>
            Back to Editor
          </Button>
        </Link>

        <Button
          variant="primary"
          size="md"
          leftIcon={<PlusIcon size={15} />}
          onClick={onNewModule}
        >
          New Module
        </Button>
      </div>
    </header>
  );
}
