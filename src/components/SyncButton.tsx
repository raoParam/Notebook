'use client';

import React from 'react';
import type { SyncStatus } from '@/hooks/useSync';

interface SyncButtonProps {
  syncStatus: SyncStatus;
  connectedCount: number;
  onSync: () => void;
}

export function SyncButton({ syncStatus, connectedCount, onSync }: SyncButtonProps) {
  const isIdle = syncStatus.stage === 'idle';
  const isBusy = syncStatus.stage === 'exchanging' || syncStatus.stage === 'transferring' || syncStatus.stage === 'connecting';
  const isDone = syncStatus.stage === 'done';
  const isError = syncStatus.stage === 'error';

  function label(): string {
    if (syncStatus.stage === 'connecting') return 'Connecting…';
    if (syncStatus.stage === 'exchanging') return 'Exchanging…';
    if (syncStatus.stage === 'transferring') {
      return syncStatus.total > 0
        ? `Syncing ${syncStatus.progress}/${syncStatus.total}`
        : 'Syncing…';
    }
    if (syncStatus.stage === 'done') return 'Sync done ✓';
    if (syncStatus.stage === 'error') return 'Error';
    return 'Sync';
  }

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        id="sync-button"
        onClick={onSync}
        disabled={isBusy}
        title={
          syncStatus.stage === 'error'
            ? syncStatus.message
            : connectedCount > 0
            ? `${connectedCount} device(s) connected`
            : 'No device connected — sync requires both devices online'
        }
        style={{
          padding: '7px 14px',
          background: isDone ? '#22c55e' : isError ? 'var(--danger)' : 'var(--bg-sidebar)',
          border: `1px solid ${isDone ? '#22c55e' : isError ? 'var(--danger)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          color: isDone || isError ? '#fff' : 'var(--ink-soft)',
          fontSize: 13,
          fontWeight: 500,
          cursor: isBusy ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontFamily: 'var(--font)',
          transition: 'all 0.15s',
          position: 'relative',
          opacity: isBusy ? 0.85 : 1,
        }}
      >
        {/* Spinner icon when busy */}
        {isBusy ? (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="animate-spin-slow"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        ) : isDone ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ) : isError ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        )}
        {label()}

        {/* Connected peer dot */}
        {connectedCount > 0 && isIdle && (
          <span
            className="animate-pulse-dot"
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#22c55e',
              border: '1.5px solid var(--bg-paper)',
            }}
          />
        )}
      </button>

      {/* Error tooltip */}
      {isError && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--danger)',
            boxShadow: 'var(--shadow-sm)',
            zIndex: 100,
            maxWidth: 280,
            whiteSpace: 'normal' as const,
          }}
        >
          {syncStatus.message}
        </div>
      )}

      {/* Done summary */}
      {isDone && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--bg-paper)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--ink-soft)',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-sm)',
            zIndex: 100,
          }}
        >
          ✓ {syncStatus.result.received} received · {syncStatus.result.sent} sent · {syncStatus.result.unchanged} unchanged
        </div>
      )}
    </div>
  );
}
