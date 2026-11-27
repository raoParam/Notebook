// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from '@/components/SettingsModal';
import { ThemeProvider } from '@/components/ThemeProvider';
import { db } from '@/lib/db';
import {
  deleteNoteWithTombstone,
  deletionDeliveryKey,
  updateTombstoneDelivery,
} from '@/lib/tombstones';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushUi(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((res) => setTimeout(res, 5));
    });
  }
}

describe('DeletionActivity inside SettingsModal', () => {
  const roots: Array<{ unmount: () => Promise<void> }> = [];

  beforeEach(async () => {
    window.localStorage.clear();
    db.close();
    await Dexie.delete('NotebookDB');
    await db.open();
  });

  afterEach(async () => {
    while (roots.length > 0) {
      await roots.pop()!.unmount();
    }
    vi.restoreAllMocks();
    db.close();
    await Dexie.delete('NotebookDB');
  });

  async function renderSettingsSyncTab() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ThemeProvider>
          <SettingsModal onClose={vi.fn()} autoSyncEnabled={false} onToggleAutoSync={vi.fn()} />
        </ThemeProvider>
      );
    });
    roots.push({
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    });

    const syncTabBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Sync')
    );
    expect(syncTabBtn).toBeTruthy();
    await act(async () => {
      syncTabBtn!.click();
    });
    await flushUi();
    return container;
  }

  it('renders empty state when there are no deletions', async () => {
    const container = await renderSettingsSyncTab();
    expect(container.textContent).toContain('Deletion Activity');
    expect(container.textContent).toContain('No recent deletions');
  });

  it('shows deletion with no connected recipients and explains offline copies', async () => {
    await db.notes.put({
      id: 'internal-note-id-1',
      title: 'Offline Note',
      content: 'Body',
      attachments: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'h1',
    });
    const tombstone = await deleteNoteWithTombstone('internal-note-id-1', db, []);
    expect(tombstone).not.toBeNull();

    const container = await renderSettingsSyncTab();
    expect(container.textContent).toContain('Offline Note');
    expect(container.textContent).toContain(
      'No paired devices were connected when this note was deleted'
    );
    expect(container.textContent).toContain('Offline devices may still retain their copies.');
    expect(container.textContent).not.toContain('internal-note-id-1');
    expect(container.textContent).not.toContain(tombstone!.deletionId);
  });

  it('shows single-recipient accepted, failed, superseded, and active pending statuses', async () => {
    await db.pairings.bulkPut([
      { id: 'pair-phone-1', label: 'My Phone', pairedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'pair-tablet-1', label: 'Work Tablet', pairedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'pair-laptop-1', label: 'Home Laptop', pairedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'pair-desk-1', label: 'Studio Desktop', pairedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const now = Date.now();
    await db.tombstones.bulkPut([
      {
        noteId: 'n-accepted',
        noteTitle: 'Accepted Note',
        deletedAt: new Date(now - 1000).toISOString(),
        deletionId: 'del-accepted',
        scope: 'propagated',
        deliveryFailures: 0,
      },
      {
        noteId: 'n-failed',
        noteTitle: 'Failed Note',
        deletedAt: new Date(now - 2000).toISOString(),
        deletionId: 'del-failed',
        scope: 'local',
        deliveryFailures: 1,
      },
      {
        noteId: 'n-superseded',
        noteTitle: 'Superseded Note',
        deletedAt: new Date(now - 3000).toISOString(),
        deletionId: 'del-superseded',
        scope: 'local',
        deliveryFailures: 0,
      },
      {
        noteId: 'n-pending',
        noteTitle: '',
        deletedAt: new Date(now - 4000).toISOString(),
        deletionId: 'del-pending',
        scope: 'local',
        deliveryFailures: 0,
      },
    ]);

    await db.deletionDeliveries.bulkPut([
      {
        id: deletionDeliveryKey('del-accepted', 'pair-phone-1', 'peer-phone'),
        noteId: 'n-accepted',
        deletionId: 'del-accepted',
        pairingId: 'pair-phone-1',
        peerId: 'peer-phone',
        status: 'accepted',
        updatedAt: new Date(now - 500).toISOString(),
      },
      {
        id: deletionDeliveryKey('del-failed', 'pair-tablet-1', 'peer-tablet'),
        noteId: 'n-failed',
        deletionId: 'del-failed',
        pairingId: 'pair-tablet-1',
        peerId: 'peer-tablet',
        status: 'failed',
        updatedAt: new Date(now - 500).toISOString(),
      },
      {
        id: deletionDeliveryKey('del-superseded', 'pair-laptop-1', 'peer-laptop'),
        noteId: 'n-superseded',
        deletionId: 'del-superseded',
        pairingId: 'pair-laptop-1',
        peerId: 'peer-laptop',
        status: 'superseded',
        updatedAt: new Date(now - 500).toISOString(),
      },
      {
        id: deletionDeliveryKey('del-pending', 'pair-desk-1', 'peer-desk'),
        noteId: 'n-pending',
        deletionId: 'del-pending',
        pairingId: 'pair-desk-1',
        peerId: 'peer-desk',
        status: 'pending',
        updatedAt: new Date(now).toISOString(),
      },
    ]);

    const container = await renderSettingsSyncTab();
    const items = Array.from(container.querySelectorAll('[data-testid="deletion-activity-item"]'));
    expect(items).toHaveLength(4);

    // Most recent deletions first, with Untitled fallback
    expect(items[0].textContent).toContain('Accepted Note');
    expect(items[0].textContent).toContain('My Phone');
    expect(items[0].textContent).toContain('Deletion confirmed on this device');

    expect(items[1].textContent).toContain('Failed Note');
    expect(items[1].textContent).toContain('Work Tablet');
    expect(items[1].textContent).toContain('Deletion not confirmed; device may still have a copy');

    expect(items[2].textContent).toContain('Superseded Note');
    expect(items[2].textContent).toContain('Home Laptop');
    expect(items[2].textContent).toContain('A newer version existed; that copy was kept');

    expect(items[3].textContent).toContain('Untitled');
    expect(items[3].textContent).toContain('Studio Desktop');
    expect(items[3].textContent).toContain('Waiting for confirmation');

    // Internal IDs must never appear in UI
    for (const internalId of ['pair-phone-1', 'peer-phone', 'del-accepted', 'n-accepted']) {
      expect(container.textContent).not.toContain(internalId);
    }
  });

  it('shows mixed multi-recipient partial outcomes, missing pairings, and refreshes on demand', async () => {
    await db.pairings.bulkPut([
      { id: 'pair-a', label: 'Alpha Phone', pairedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'pair-b', label: 'Beta Tablet', pairedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    await db.notes.put({
      id: 'mixed-note',
      title: 'Shared Plan',
      content: 'Draft',
      attachments: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'h-mix',
    });

    const tombstone = await deleteNoteWithTombstone('mixed-note', db, [
      { pairingId: 'pair-a', peerId: 'peer-a' },
      { pairingId: 'pair-b', peerId: 'peer-b' },
      { pairingId: 'pair-deleted-later', peerId: 'peer-c' },
    ]);
    await updateTombstoneDelivery(
      tombstone!,
      { pairingId: 'pair-a', peerId: 'peer-a' },
      'accepted',
      db
    );
    await updateTombstoneDelivery(
      tombstone!,
      { pairingId: 'pair-b', peerId: 'peer-b' },
      'superseded',
      db
    );
    await updateTombstoneDelivery(
      tombstone!,
      { pairingId: 'pair-deleted-later', peerId: 'peer-c' },
      'failed',
      db
    );

    const container = await renderSettingsSyncTab();
    expect(container.textContent).toContain('Shared Plan');
    expect(container.textContent).toContain('1 confirmed · 1 not confirmed · 1 newer copy kept');
    expect(container.textContent).toContain('Alpha Phone');
    expect(container.textContent).toContain('Deletion confirmed on this device');
    expect(container.textContent).toContain('Beta Tablet');
    expect(container.textContent).toContain('A newer version existed; that copy was kept');
    expect(container.textContent).toContain('Removed device');
    expect(container.textContent).toContain('Deletion not confirmed; device may still have a copy');
    expect(container.textContent).not.toContain('pair-deleted-later');
    expect(container.textContent).not.toContain('peer-c');

    // Add a newer deletion and click Refresh
    await db.notes.put({
      id: 'fresh-note',
      title: 'Newest Deleted',
      content: 'Fresh',
      attachments: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'h-fresh',
    });
    await deleteNoteWithTombstone('fresh-note', db, []);

    const refreshBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Refresh')
    );
    expect(refreshBtn).toBeTruthy();
    await act(async () => {
      refreshBtn!.click();
    });
    await flushUi();

    const itemsAfter = Array.from(
      container.querySelectorAll('[data-testid="deletion-activity-item"]')
    );
    expect(itemsAfter).toHaveLength(2);
    expect(itemsAfter[0].textContent).toContain('Newest Deleted');
    expect(itemsAfter[1].textContent).toContain('Shared Plan');
  });

  it('reconciles stale pending records from interrupted sessions instead of leaving them waiting forever', async () => {
    await db.pairings.put({
      id: 'pair-stale',
      label: 'Stale Peer',
      pairedAt: '2026-01-01T00:00:00.000Z',
    });
    const staleIso = new Date(Date.now() - 60_000).toISOString();
    await db.tombstones.put({
      noteId: 'stale-note',
      noteTitle: 'Interrupted Delete',
      deletedAt: staleIso,
      deletionId: 'del-stale',
      scope: 'local',
      deliveryFailures: 0,
    });
    await db.deletionDeliveries.put({
      id: deletionDeliveryKey('del-stale', 'pair-stale', 'peer-stale'),
      noteId: 'stale-note',
      deletionId: 'del-stale',
      pairingId: 'pair-stale',
      peerId: 'peer-stale',
      status: 'pending',
      updatedAt: staleIso,
    });

    const container = await renderSettingsSyncTab();
    expect(container.textContent).toContain('Interrupted Delete');
    expect(container.textContent).toContain('Stale Peer');
    expect(container.textContent).toContain('Deletion not confirmed; device may still have a copy');
    expect(container.textContent).not.toContain('Waiting for confirmation');

    const storedDelivery = await db.deletionDeliveries.get(
      deletionDeliveryKey('del-stale', 'pair-stale', 'peer-stale')
    );
    expect(storedDelivery?.status).toBe('failed');
    expect((await db.tombstones.get('stale-note'))?.deliveryFailures).toBe(1);
  });
});
