import React from 'react';
import { DeletionActivity } from '@/components/DeletionActivity';
import { sectionDescStyle, sectionTitleStyle } from './styles';

export interface SyncSettingsProps {
  autoSyncEnabled: boolean;
  onToggleAutoSync?: (enabled: boolean) => void;
  onNotify: (notification: { type: 'success' | 'error'; message: string }) => void;
}

export function SyncSettings({
  autoSyncEnabled,
  onToggleAutoSync,
  onNotify,
}: SyncSettingsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h3 style={sectionTitleStyle}>Automatic Synchronization</h3>
        <p style={sectionDescStyle}>
          Control whether this device automatically synchronizes notes with paired devices.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '14px 16px',
          background: 'var(--bg-app)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>Auto-sync</div>
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3, lineHeight: 1.5 }}>
            Off by default. Automatic sync runs only when <strong>both</strong> this device and a
            connected paired device have Auto-sync enabled. Manual sync remains available at any
            time.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoSyncEnabled}
          aria-label="Toggle Auto-sync"
          onClick={() => {
            const next = !autoSyncEnabled;
            onToggleAutoSync?.(next);
            onNotify({
              type: 'success',
              message: next
                ? 'Auto-sync enabled for this device.'
                : 'Auto-sync disabled for this device.',
            });
          }}
          style={{
            width: 46,
            height: 26,
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: autoSyncEnabled ? 'var(--accent)' : 'var(--bg-sidebar)',
            position: 'relative',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.15s ease',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: autoSyncEnabled ? 22 : 2,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              transition: 'left 0.15s ease',
            }}
          />
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

      <DeletionActivity />
    </div>
  );
}
