'use client';

import React from 'react';
import { Button } from './Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  style?: React.CSSProperties;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = '',
  style,
}: EmptyStateProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 20px',
        width: '100%',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {icon && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 52,
            height: 52,
            borderRadius: 'var(--radius-panel, 12px)',
            background: 'var(--bg-sidebar)',
            border: '1px dashed var(--border)',
            color: 'var(--ink-soft)',
            marginBottom: 16,
          }}
        >
          {icon}
        </div>
      )}

      <h3
        style={{
          fontFamily: 'var(--serif-font)',
          fontSize: 'var(--font-size-base, 16px)',
          fontWeight: 600,
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 6,
        }}
      >
        {title}
      </h3>

      {description && (
        <p
          style={{
            fontFamily: 'var(--font)',
            fontSize: 'var(--font-size-sm, 13.5px)',
            color: 'var(--ink-soft)',
            margin: 0,
            maxWidth: 380,
            lineHeight: 1.55,
            marginBottom: action || secondaryAction ? 20 : 0,
          }}
        >
          {description}
        </p>
      )}

      {(action || secondaryAction) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {action && (
            <Button
              variant={action.variant ?? 'primary'}
              size="md"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          )}

          {secondaryAction && (
            <Button
              variant="outline"
              size="md"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
