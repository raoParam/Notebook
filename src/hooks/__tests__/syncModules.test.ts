import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TTL_MS } from '../sync/constants';
import {
  cancelAutoSyncForPeerState,
  failPendingManualTransfersForPeer,
  findPeerRunForSession,
  pruneStaleBookkeeping,
} from '../sync/sessionManager';
import type {
  ActiveSyncRun,
  AutoSyncRun,
  InboundResponderSession,
  OutboundResponderSession,
  PendingAckEntry,
} from '../sync/types';
import {
  buildPeerAutoSyncRecord,
  computeSyncedAutoDigest,
  createPeerRunState,
  deletionAckKey,
  isPeerConnected,
  isPeerRunComplete,
  peerCompositeKey,
  summarizeManualRun,
} from '../sync/utils';

afterEach(() => {
  vi.useRealTimers();
});

describe('sync/utils', () => {
  it('formats composite peer and deletion keys cleanly', () => {
    expect(peerCompositeKey('pair-1', 'peer-a')).toBe('pair-1\x00peer-a');
    expect(deletionAckKey('pair-1', 'peer-a', 'del-9')).toBe('pair-1\x00peer-a\x00del-9');
  });

  it('checks peer connectivity and builds auto-sync records', () => {
    const peers = [{ pairingId: 'p1', peerId: 'a' }];
    expect(isPeerConnected(peers, 'p1', 'a')).toBe(true);
    expect(isPeerConnected(peers, 'p1', 'b')).toBe(false);

    const map = new Map<string, boolean>([
      ['p1\x00a', true],
      ['p2\x00b', false],
    ]);
    expect(buildPeerAutoSyncRecord(map)).toEqual({
      'p1\x00a': true,
      'p2\x00b': false,
    });
  });

  it('evaluates peer run completion accurately across pending states and disconnect', () => {
    const base = createPeerRunState({
      key: 'p1\x00a',
      pairingId: 'p1',
      peerId: 'a',
      mode: 'manual-all',
      outboundSessionId: 'out-1',
      inboundSessionId: null,
      localManifest: [{ noteId: 'n1', updatedAt: '2026-01-01T00:00:00.000Z', contentHash: 'h1' }],
    });
    expect(isPeerRunComplete(base)).toBe(false);

    base.outboundRequestReceived = true;
    base.inboundManifestReceived = true;
    expect(isPeerRunComplete(base)).toBe(true);

    base.outboundSendingInProgress = true;
    expect(isPeerRunComplete(base)).toBe(false);

    base.disconnected = true;
    expect(isPeerRunComplete(base)).toBe(true);
  });

  it('summarizes manual sync runs and marks ready peers done', () => {
    const donePeer = createPeerRunState({
      key: 'p1\x00a',
      pairingId: 'p1',
      peerId: 'a',
      mode: 'manual-all',
      outboundSessionId: 'out-1',
      inboundSessionId: 'in-1',
      localManifest: [],
      outboundRequestReceived: true,
      inboundManifestReceived: true,
    });
    donePeer.sentCount = 2;
    donePeer.receivedCount = 1;
    donePeer.unchangedCount = 3;

    const pendingPeer = createPeerRunState({
      key: 'p1\x00b',
      pairingId: 'p1',
      peerId: 'b',
      mode: 'manual-all',
      outboundSessionId: 'out-2',
      inboundSessionId: 'in-2',
      localManifest: [],
      outboundRequestReceived: true,
      inboundManifestReceived: true,
      pendingIncomingIds: new Set(['n9']),
    });

    const run: ActiveSyncRun = {
      runId: 'run-1',
      peers: new Map([
        [donePeer.key, donePeer],
        [pendingPeer.key, pendingPeer],
      ]),
      timeoutId: null,
      settled: false,
    };

    const summary = summarizeManualRun(run);
    expect(donePeer.done).toBe(true);
    expect(pendingPeer.done).toBe(false);
    expect(summary).toEqual({
      allDone: false,
      received: 1,
      sent: 2,
      failed: 0,
      unchanged: 3,
      pending: 1,
    });
  });

  it('computes auto-sync digest merging received entries without mutating local manifest', () => {
    const initial = [
      { noteId: 'n1', updatedAt: '2026-01-01T00:00:00.000Z', contentHash: 'old' },
    ];
    const peerRun = createPeerRunState({
      key: 'p1\x00a',
      pairingId: 'p1',
      peerId: 'a',
      mode: 'auto',
      outboundSessionId: 'out-1',
      inboundSessionId: 'in-1',
      localManifest: initial,
    });
    const withoutIncoming = computeSyncedAutoDigest(peerRun);

    peerRun.syncedIncomingEntries.set('n1', {
      noteId: 'n1',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'new',
    });
    peerRun.syncedIncomingEntries.set('n2', {
      noteId: 'n2',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'added',
    });

    const withIncoming = computeSyncedAutoDigest(peerRun);
    expect(withIncoming).not.toBe(withoutIncoming);
    expect(initial).toHaveLength(1);
    expect(initial[0].contentHash).toBe('old');
  });
});

describe('sync/sessionManager', () => {
  it('prunes expired bookkeeping while keeping active run pending ACKs', () => {
    const now = 1_000_000;
    const staleTs = now - SESSION_TTL_MS - 10;
    const freshTs = now - 1_000;

    const processedManifestSessions = new Map<string, number>([
      ['old', staleTs],
      ['new', freshTs],
    ]);
    const outboundResponders = new Map<string, OutboundResponderSession>([
      [
        'old-out',
        {
          pairingId: 'p1',
          peerId: 'a',
          allowedNoteIds: new Set(),
          requestHandled: false,
          isAutoSync: false,
          createdAt: staleTs,
        },
      ],
    ]);
    const expiredTimeout = setTimeout(() => {}, 1000);
    const inboundResponders = new Map<string, InboundResponderSession>([
      [
        'old-in',
        {
          sessionId: 's1',
          pairingId: 'p1',
          peerId: 'a',
          allowedNoteIds: new Set(),
          pendingNoteIds: new Set(),
          isAutoSync: false,
          createdAt: staleTs,
          expiresAt: now - 1,
          timeoutId: expiredTimeout,
        },
      ],
    ]);
    const pendingAcks = new Map<string, PendingAckEntry>([
      [
        'stale-ack',
        {
          sessionId: 's0',
          pairingId: 'p1',
          peerId: 'a',
          noteId: 'n0',
          runType: 'manual',
          runId: 'dead-run',
          createdAt: staleTs,
        },
      ],
      [
        'active-manual-ack',
        {
          sessionId: 's1',
          pairingId: 'p1',
          peerId: 'a',
          noteId: 'n1',
          runType: 'manual',
          runId: 'live-manual',
          createdAt: staleTs,
        },
      ],
    ]);

    pruneStaleBookkeeping(
      {
        processedManifestSessions,
        outboundResponders,
        inboundResponders,
        pendingAcks,
        processedIncomingTransfers: new Map(),
        handledNoteErrors: new Map(),
      },
      'live-manual',
      new Map(),
      now
    );

    expect(processedManifestSessions.has('old')).toBe(false);
    expect(processedManifestSessions.has('new')).toBe(true);
    expect(outboundResponders.size).toBe(0);
    expect(inboundResponders.size).toBe(0);
    expect(pendingAcks.has('stale-ack')).toBe(false);
    expect(pendingAcks.has('active-manual-ack')).toBe(true);
  });

  it('cancels only auto-sync state for the target peer while preserving manual responders', () => {
    vi.useFakeTimers();
    const key = peerCompositeKey('p1', 'a');

    const debounceTimer = setTimeout(() => {}, 5000);
    const runTimeout = setTimeout(() => {}, 5000);
    const autoPeer = createPeerRunState({
      key,
      pairingId: 'p1',
      peerId: 'a',
      mode: 'auto',
      outboundSessionId: 'out-1',
      inboundSessionId: 'in-1',
      localManifest: [],
    });
    const autoRun: AutoSyncRun = {
      runId: 'auto-1',
      peer: autoPeer,
      timeoutId: runTimeout,
      settled: false,
    };

    const inboundResponders = new Map<string, InboundResponderSession>([
      [
        'auto-in',
        {
          sessionId: 'ai',
          pairingId: 'p1',
          peerId: 'a',
          allowedNoteIds: new Set(),
          pendingNoteIds: new Set(),
          isAutoSync: true,
          createdAt: 1,
          expiresAt: 100_000,
          timeoutId: null,
        },
      ],
      [
        'manual-in',
        {
          sessionId: 'mi',
          pairingId: 'p1',
          peerId: 'a',
          allowedNoteIds: new Set(),
          pendingNoteIds: new Set(),
          isAutoSync: false,
          createdAt: 1,
          expiresAt: 100_000,
          timeoutId: null,
        },
      ],
    ]);

    const outboundResponders = new Map<string, OutboundResponderSession>([
      [
        'auto-out',
        {
          pairingId: 'p1',
          peerId: 'a',
          allowedNoteIds: new Set(),
          requestHandled: false,
          isAutoSync: true,
          createdAt: 1,
        },
      ],
      [
        'manual-out',
        {
          pairingId: 'p1',
          peerId: 'a',
          allowedNoteIds: new Set(),
          requestHandled: false,
          isAutoSync: false,
          createdAt: 1,
        },
      ],
    ]);

    const pendingAcks = new Map<string, PendingAckEntry>([
      [
        't-auto',
        {
          sessionId: 'out-1',
          pairingId: 'p1',
          peerId: 'a',
          noteId: 'n1',
          runType: 'auto',
          runId: 'auto-1',
          createdAt: 1,
        },
      ],
      [
        't-manual',
        {
          sessionId: 'm-1',
          pairingId: 'p1',
          peerId: 'a',
          noteId: 'n2',
          runType: 'manual',
          runId: 'manual-1',
          createdAt: 1,
        },
      ],
    ]);

    const autoDebounceTimers = new Map([[key, debounceTimer]]);
    const autoPendingResync = new Set([key]);
    const lastAutoSyncedDigest = new Map([[key, 'digest-1']]);
    const autoRuns = new Map([[key, autoRun]]);

    cancelAutoSyncForPeerState(key, {
      autoDebounceTimers,
      autoPendingResync,
      lastAutoSyncedDigest,
      autoRuns,
      pendingAcks,
      inboundResponders,
      outboundResponders,
    });

    expect(autoRun.settled).toBe(true);
    expect(autoRuns.size).toBe(0);
    expect(autoDebounceTimers.size).toBe(0);
    expect(autoPendingResync.size).toBe(0);
    expect(lastAutoSyncedDigest.size).toBe(0);
    expect(pendingAcks.has('t-auto')).toBe(false);
    expect(pendingAcks.has('t-manual')).toBe(true);
    expect(inboundResponders.has('auto-in')).toBe(false);
    expect(inboundResponders.has('manual-in')).toBe(true);
    expect(outboundResponders.has('auto-out')).toBe(false);
    expect(outboundResponders.has('manual-out')).toBe(true);
  });

  it('finds matching manual or auto peer runs and fails disconnected manual transfers', () => {
    const key = peerCompositeKey('p1', 'a');
    const manualPeer = createPeerRunState({
      key,
      pairingId: 'p1',
      peerId: 'a',
      mode: 'manual-all',
      outboundSessionId: 'out-manual',
      inboundSessionId: 'in-manual',
      localManifest: [],
      pendingIncomingIds: new Set(['n1']),
    });
    manualPeer.pendingOutgoing.set('tx-1', 'n2');

    const activeRun: ActiveSyncRun = {
      runId: 'manual-1',
      peers: new Map([[key, manualPeer]]),
      timeoutId: null,
      settled: false,
    };
    const pendingAcks = new Map<string, PendingAckEntry>([
      [
        'tx-1',
        {
          sessionId: 'out-manual',
          pairingId: 'p1',
          peerId: 'a',
          noteId: 'n2',
          runType: 'manual',
          runId: 'manual-1',
          createdAt: 1,
        },
      ],
    ]);

    const matched = findPeerRunForSession(
      key,
      activeRun,
      new Map(),
      (p) => p.outboundSessionId === 'out-manual'
    );
    expect(matched?.kind).toBe('manual');

    const touched = failPendingManualTransfersForPeer(activeRun, 'p1', 'a', pendingAcks);
    expect(touched).toBe(true);
    expect(manualPeer.failedCount).toBe(2);
    expect(manualPeer.disconnected).toBe(true);
    expect(manualPeer.done).toBe(true);
    expect(manualPeer.pendingOutgoing.size).toBe(0);
    expect(manualPeer.pendingIncomingIds.size).toBe(0);
    expect(pendingAcks.size).toBe(0);
  });
});
