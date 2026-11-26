// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/SettingsModal';
import { SyncDialog } from '@/components/SyncDialog';
import { ThemeProvider } from '@/components/ThemeProvider';
import type { Pairing } from '@/lib/db';
import type { ManualPreviewState } from '@/hooks/useSync';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SyncDialog & SettingsModal Auto-sync UI', () => {
  const roots: Array<{ unmount: () => Promise<void> }> = [];

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(async () => {
    while (roots.length > 0) {
      const item = roots.pop();
      if (item) await item.unmount();
    }
    vi.restoreAllMocks();
  });

  async function renderElement(element: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(element);
    });
    roots.push({
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    });
    return {
      container,
      rerender: async (next: React.ReactElement) => {
        await act(async () => {
          root.render(next);
        });
      },
    };
  }

  function clickButtonByText(container: HTMLElement, textMatch: string | RegExp) {
    const buttons = Array.from(container.querySelectorAll('button'));
    const btn = buttons.find((b) =>
      typeof textMatch === 'string'
        ? b.textContent?.includes(textMatch)
        : textMatch.test(b.textContent ?? '')
    );
    if (!btn) {
      throw new Error(
        `Button matching ${String(textMatch)} not found. Available: ${buttons
          .map((b) => JSON.stringify(b.textContent?.trim()))
          .join(', ')}`
      );
    }
    btn.click();
    return btn;
  }

  it('requests fresh manifest on open and supports Sync all, Selective sync, and Deny sync', async () => {
    const pairings: Pairing[] = [
      { id: 'room-1', label: 'Work Laptop', pairedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'room-2', label: 'Phone', pairedAt: '2026-01-02T00:00:00.000Z' },
    ];
    const readyPreview: ManualPreviewState = {
      stage: 'ready',
      pairingId: 'room-1',
      peerId: 'peer-1',
      peerManifestSessionId: 'sess-1',
      peerManifest: [
        { noteId: 'n-new', title: 'Peer New Note', contentHash: 'h1', updatedAt: '2026-01-05T12:00:00.000Z' },
        { noteId: 'n-upd', title: 'Peer Updated Note', contentHash: 'h2', updatedAt: '2026-01-04T12:00:00.000Z' },
        { noteId: 'n-same', title: 'Same Note', contentHash: 'h3', updatedAt: '2026-01-01T12:00:00.000Z' },
      ],
      notes: [
        {
          noteId: 'n-new',
          title: 'Peer New Note',
          updatedAt: '2026-01-05T12:00:00.000Z',
          contentHash: 'h1',
          relation: 'new',
        },
        {
          noteId: 'n-upd',
          title: 'Peer Updated Note',
          updatedAt: '2026-01-04T12:00:00.000Z',
          contentHash: 'h2',
          relation: 'updated',
        },
        {
          noteId: 'n-same',
          title: 'Same Note',
          updatedAt: '2026-01-01T12:00:00.000Z',
          contentHash: 'h3',
          relation: 'identical',
        },
      ],
    };

    const onSelectPairing = vi.fn();
    const onRefreshManifest = vi.fn();
    const onSyncAll = vi.fn();
    const onSyncSelected = vi.fn();
    const onDeny = vi.fn();

    const { container } = await renderElement(
      <SyncDialog
        pairings={pairings}
        connectedPeers={[{ pairingId: 'room-1', peerId: 'peer-1' }]}
        manualPreview={readyPreview}
        syncStatus={{ stage: 'idle' }}
        autoSyncEnabled={false}
        peerAutoSync={{ 'room-1\x00peer-1': false }}
        onSelectPairing={onSelectPairing}
        onRefreshManifest={onRefreshManifest}
        onSyncAll={onSyncAll}
        onSyncSelected={onSyncSelected}
        onDeny={onDeny}
        onOpenPairDevice={vi.fn()}
      />
    );

    // Mount triggers fresh manifest request for active device
    expect(onSelectPairing).toHaveBeenCalledWith('room-1');

    // Sync all triggers full sync
    await act(async () => {
      clickButtonByText(container, 'Sync all');
    });
    expect(onSyncAll).toHaveBeenCalledWith('room-1');

    // Expand Sync selected notes list -> defaults select new & updated ('n-new', 'n-upd')
    await act(async () => {
      clickButtonByText(container, /Sync selected notes/i);
    });

    const checkboxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]')
    ) as HTMLInputElement[];
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes.filter((c) => c.checked)).toHaveLength(2);

    // Uncheck the second checkbox so only 'n-new' stays checked
    await act(async () => {
      checkboxes[1].click();
    });

    await act(async () => {
      clickButtonByText(container, /Transfer selected \(1\)/i);
    });
    expect(onSyncSelected).toHaveBeenCalledWith('room-1', ['n-new']);

    // Clear selection -> transfer button disabled
    await act(async () => {
      clickButtonByText(container, 'Clear');
    });
    const syncSelectedConfirm = Array.from(container.querySelectorAll('button')).find((b) =>
      /Transfer selected \(\d+\)/i.test(b.textContent ?? '')
    );
    expect(syncSelectedConfirm?.disabled).toBe(true);

    // Deny sync closes dialogue without transferring
    await act(async () => {
      clickButtonByText(container, 'Deny sync');
    });
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('handles loading, disconnected, error, empty device list, and device switching states', async () => {
    const pairings: Pairing[] = [
      { id: 'room-1', label: 'Laptop', pairedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'room-2', label: 'Tablet', pairedAt: '2026-01-02T00:00:00.000Z' },
    ];
    const onSelectPairing = vi.fn();
    const onOpenPairDevice = vi.fn();

    const { container, rerender } = await renderElement(
      <SyncDialog
        pairings={[]}
        connectedPeers={[]}
        manualPreview={{ stage: 'idle' }}
        syncStatus={{ stage: 'idle' }}
        autoSyncEnabled={false}
        peerAutoSync={{}}
        onSelectPairing={onSelectPairing}
        onRefreshManifest={vi.fn()}
        onSyncAll={vi.fn()}
        onSyncSelected={vi.fn()}
        onDeny={vi.fn()}
        onOpenPairDevice={onOpenPairDevice}
      />
    );

    expect(container.textContent).toContain('No paired devices yet');

    // Loading state
    await rerender(
      <SyncDialog
        pairings={pairings}
        connectedPeers={[{ pairingId: 'room-1', peerId: 'peer-1' }]}
        manualPreview={{ stage: 'loading', pairingId: 'room-1', peerId: 'peer-1' }}
        syncStatus={{ stage: 'idle' }}
        autoSyncEnabled={false}
        peerAutoSync={{}}
        onSelectPairing={onSelectPairing}
        onRefreshManifest={vi.fn()}
        onSyncAll={vi.fn()}
        onSyncSelected={vi.fn()}
        onDeny={vi.fn()}
        onOpenPairDevice={onOpenPairDevice}
      />
    );
    expect(container.textContent).toMatch(/Requesting fresh note list/i);

    // Disconnected state
    await rerender(
      <SyncDialog
        pairings={pairings}
        connectedPeers={[]}
        manualPreview={{ stage: 'disconnected', pairingId: 'room-1', message: 'Device offline' }}
        syncStatus={{ stage: 'idle' }}
        autoSyncEnabled={false}
        peerAutoSync={{}}
        onSelectPairing={onSelectPairing}
        onRefreshManifest={vi.fn()}
        onSyncAll={vi.fn()}
        onSyncSelected={vi.fn()}
        onDeny={vi.fn()}
        onOpenPairDevice={onOpenPairDevice}
      />
    );
    expect(container.textContent).toContain('Device offline');

    // Switching device calls onSelectPairing for new pairing
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    await act(async () => {
      const setSelectValue = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value'
      )?.set;
      setSelectValue?.call(select, 'room-2');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelectPairing).toHaveBeenCalledWith('room-2');
  });

  it('exposes the Auto-sync toggle in SettingsModal under the Sync tab', async () => {
    const onToggleAutoSync = vi.fn();

    const { container } = await renderElement(
      <ThemeProvider>
        <SettingsModal
          onClose={vi.fn()}
          autoSyncEnabled={false}
          onToggleAutoSync={onToggleAutoSync}
        />
      </ThemeProvider>
    );

    await act(async () => {
      clickButtonByText(container, 'Sync');
    });

    const toggle = container.querySelector('button[role="switch"]') as HTMLButtonElement | null;
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle?.click();
    });
    expect(onToggleAutoSync).toHaveBeenCalledWith(true);
  });
});
