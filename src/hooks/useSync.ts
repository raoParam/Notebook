'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { db, type Pairing, type Tombstone } from '@/lib/db';
import {
  applyRemoteTombstone,
  persistIncomingNote,
  prepareDeletionDeliveries,
  updateTombstoneDelivery,
} from '@/lib/tombstones';
import {
  buildLocalManifest,
  classifyPeerNotes,
  compressNote,
  computeDiff,
  computeManifestDigest,
  countUnchangedNotes,
  decompressNote,
  parseSyncMessage,
  type ManifestEntry,
  type PeerNotePreview,
} from '@/lib/sync';
import { computeContentHash } from '@/lib/hash';
import { getIceServers, type IceServer } from '@/lib/turn';

export type PeerState = {
  pairingId: string;
  peerId: string;
};

export type SyncStatus =
  | { stage: 'idle' }
  | { stage: 'connecting' }
  | { stage: 'exchanging' }
  | { stage: 'transferring'; progress: number; total: number }
  | { stage: 'done'; result: { received: number; sent: number; unchanged: number } }
  | { stage: 'error'; message: string };

export type ManualPreviewState =
  | { stage: 'idle' }
  | { stage: 'loading'; pairingId: string; peerId: string }
  | {
      stage: 'ready';
      pairingId: string;
      peerId: string;
      peerManifestSessionId: string;
      peerManifest: ManifestEntry[];
      notes: PeerNotePreview[];
    }
  | { stage: 'disconnected'; pairingId: string; message: string }
  | { stage: 'error'; pairingId: string; message: string };

const APP_ID = 'notebook-p2p-sync-v1';
const AUTO_SYNC_STORAGE_KEY = 'nb-auto-sync';
export const SYNC_TIMEOUT_MS = 15_000;
export const MANIFEST_PREVIEW_TIMEOUT_MS = 10_000;
export const AUTO_SYNC_DEBOUNCE_MS = 400;
const SESSION_TTL_MS = 60_000;
const CONNECT_WAIT_TIMEOUT_MS = 5_000;
const CONNECT_POLL_INTERVAL_MS = 250;
const STATUS_RESET_DELAY_MS = 5_000;

interface TrysteroAction {
  send: (data: unknown, options?: { target?: string | string[] }) => Promise<void>;
  onMessage: ((data: unknown, context: { peerId: string }) => void) | null;
}

interface TrysteroRoom {
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  makeAction: (name: string) => TrysteroAction;
  leave: () => Promise<void>;
}

interface TrysteroModule {
  joinRoom: (
    config: { appId: string; turnConfig?: IceServer[] },
    roomId: string
  ) => TrysteroRoom;
}

async function getTrystero(): Promise<TrysteroModule> {
  const mod = await import('@trystero-p2p/torrent');
  return mod as unknown as TrysteroModule;
}

interface RoomEntry {
  room: TrysteroRoom;
  send: (data: unknown, targetPeerId?: string) => Promise<void>;
}

interface PeerRunState {
  key: string;
  pairingId: string;
  peerId: string;
  mode: 'manual-all' | 'manual-selected' | 'auto';
  outboundSessionId: string | null;
  inboundSessionId: string | null;
  localManifest: ManifestEntry[];
  allowedOutboundIds: Set<string>;
  allowedIncomingIds: Set<string> | null;
  outboundRequestReceived: boolean;
  outboundSendingInProgress: boolean;
  inboundManifestReceived: boolean;
  pendingOutgoing: Map<string, string>; // transferId -> noteId
  pendingIncomingIds: Set<string>;
  syncedIncomingEntries: Map<string, ManifestEntry>;
  sentCount: number;
  receivedCount: number;
  failedCount: number;
  unchangedCount: number;
  disconnected: boolean;
  done: boolean;
}

interface ActiveSyncRun {
  runId: string;
  peers: Map<string, PeerRunState>;
  timeoutId: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

interface AutoSyncRun {
  runId: string;
  peer: PeerRunState;
  timeoutId: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

interface PendingPreviewRequest {
  sessionId: string;
  pairingId: string;
  peerId: string;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

interface OutboundResponderSession {
  pairingId: string;
  peerId: string;
  allowedNoteIds: Set<string>;
  requestHandled: boolean;
  isAutoSync: boolean;
  createdAt: number;
}

interface InboundResponderSession {
  sessionId: string;
  pairingId: string;
  peerId: string;
  allowedNoteIds: Set<string>;
  pendingNoteIds: Set<string>;
  isAutoSync: boolean;
  createdAt: number;
  expiresAt: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

interface PendingAckEntry {
  sessionId: string;
  pairingId: string;
  peerId: string;
  noteId: string;
  runType: 'manual' | 'auto' | 'responder';
  runId: string | null;
  createdAt: number;
}

interface CachedTransferAck {
  ok: boolean;
  noteId: string;
  error?: string;
  createdAt: number;
}

interface PendingDeletionAck {
  pairingId: string;
  peerId: string;
  tombstone: Tombstone;
  timeoutId: ReturnType<typeof setTimeout>;
}

function peerCompositeKey(pairingId: string, peerId: string): string {
  return `${pairingId}\x00${peerId}`;
}

function deletionAckKey(pairingId: string, peerId: string, deletionId: string): string {
  return `${peerCompositeKey(pairingId, peerId)}\x00${deletionId}`;
}

export function useSync(onNotesChanged: () => void) {
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<PeerState[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ stage: 'idle' });
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState<boolean>(false);
  const [peerAutoSync, setPeerAutoSync] = useState<Record<string, boolean>>({});
  const [manualPreview, setManualPreview] = useState<ManualPreviewState>({ stage: 'idle' });

  const roomsRef = useRef<Map<string, RoomEntry>>(new Map());
  const pendingJoinsRef = useRef<Map<string, Promise<void>>>(new Map());
  const desiredRoomsRef = useRef<Set<string>>(new Set());
  const isUnmountedRef = useRef(false);
  const connectedPeersRef = useRef<PeerState[]>([]);
  const onNotesChangedRef = useRef(onNotesChanged);

  const autoSyncEnabledRef = useRef<boolean>(false);
  const peerAutoSyncRef = useRef<Map<string, boolean>>(new Map());
  const autoRunsRef = useRef<Map<string, AutoSyncRun>>(new Map());
  const startingAutoRunsRef = useRef<Set<string>>(new Set());
  const autoDebounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const autoPendingResyncRef = useRef<Set<string>>(new Set());
  const lastAutoSyncedDigestRef = useRef<Map<string, string>>(new Map());

  const activeRunRef = useRef<ActiveSyncRun | null>(null);
  const pendingPreviewRef = useRef<PendingPreviewRequest | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processedManifestSessionsRef = useRef<Map<string, number>>(new Map());
  const outboundRespondersRef = useRef<Map<string, OutboundResponderSession>>(new Map());
  const inboundRespondersRef = useRef<Map<string, InboundResponderSession>>(new Map());
  const pendingAcksRef = useRef<Map<string, PendingAckEntry>>(new Map());
  const pendingDeletionAcksRef = useRef<Map<string, PendingDeletionAck>>(new Map());
  const processedIncomingTransfersRef = useRef<Map<string, CachedTransferAck>>(new Map());
  const handledNoteErrorsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    onNotesChangedRef.current = onNotesChanged;
  }, [onNotesChanged]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const scheduleIdleReset = useCallback(
    (delayMs = STATUS_RESET_DELAY_MS) => {
      clearIdleTimer();
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        if (!isUnmountedRef.current && !activeRunRef.current) {
          setSyncStatus({ stage: 'idle' });
        }
      }, delayMs);
    },
    [clearIdleTimer]
  );

  const clearPreviewRequest = useCallback(() => {
    const pending = pendingPreviewRef.current;
    if (pending?.timeoutId !== null && pending?.timeoutId !== undefined) {
      clearTimeout(pending.timeoutId);
    }
    pendingPreviewRef.current = null;
  }, []);

  const cancelAutoSyncForPeer = useCallback((key: string) => {
    const timer = autoDebounceTimersRef.current.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      autoDebounceTimersRef.current.delete(key);
    }
    autoPendingResyncRef.current.delete(key);
    lastAutoSyncedDigestRef.current.delete(key);

    const autoRun = autoRunsRef.current.get(key);
    if (autoRun) {
      autoRun.settled = true;
      if (autoRun.timeoutId !== null) {
        clearTimeout(autoRun.timeoutId);
        autoRun.timeoutId = null;
      }
      autoRunsRef.current.delete(key);
      for (const [transferId, entry] of pendingAcksRef.current) {
        if (entry.runType === 'auto' && entry.runId === autoRun.runId) {
          pendingAcksRef.current.delete(transferId);
        }
      }
    }

    for (const [rKey, session] of inboundRespondersRef.current) {
      if (session.isAutoSync && peerCompositeKey(session.pairingId, session.peerId) === key) {
        if (session.timeoutId !== null) {
          clearTimeout(session.timeoutId);
        }
        inboundRespondersRef.current.delete(rKey);
      }
    }
    for (const [sId, session] of outboundRespondersRef.current) {
      if (session.isAutoSync && peerCompositeKey(session.pairingId, session.peerId) === key) {
        outboundRespondersRef.current.delete(sId);
      }
    }
  }, []);

  const pruneStaleBookkeeping = useCallback(() => {
    const now = Date.now();
    const cutoff = now - SESSION_TTL_MS;
    for (const [k, ts] of processedManifestSessionsRef.current) {
      if (ts < cutoff) processedManifestSessionsRef.current.delete(k);
    }
    for (const [k, session] of outboundRespondersRef.current) {
      if (session.createdAt < cutoff) outboundRespondersRef.current.delete(k);
    }
    for (const [k, session] of inboundRespondersRef.current) {
      if (session.expiresAt < now) {
        if (session.timeoutId !== null) {
          clearTimeout(session.timeoutId);
        }
        inboundRespondersRef.current.delete(k);
      }
    }
    for (const [k, entry] of pendingAcksRef.current) {
      const activeAuto = Array.from(autoRunsRef.current.values()).some(
        (r) => r.runId === entry.runId
      );
      if (
        entry.createdAt < cutoff &&
        entry.runId !== activeRunRef.current?.runId &&
        !activeAuto
      ) {
        pendingAcksRef.current.delete(k);
      }
    }
    for (const [k, cached] of processedIncomingTransfersRef.current) {
      if (cached.createdAt < cutoff) processedIncomingTransfersRef.current.delete(k);
    }
    for (const [k, ts] of handledNoteErrorsRef.current) {
      if (ts < cutoff) handledNoteErrorsRef.current.delete(k);
    }
  }, []);

  const sendForPairing = useCallback(
    async (pairingId: string, data: unknown, targetPeerId?: string): Promise<boolean> => {
      const entry = roomsRef.current.get(pairingId);
      if (!entry) return false;
      try {
        await entry.send(data, targetPeerId);
        return true;
      } catch (err) {
        console.warn('Failed to send sync message:', err);
        return false;
      }
    },
    []
  );

  const getConnectedPeers = useCallback((): PeerState[] => {
    return connectedPeersRef.current.filter(
      (peer) =>
        roomsRef.current.has(peer.pairingId) &&
        desiredRoomsRef.current.has(peer.pairingId)
    );
  }, []);

  const propagateDeletion = useCallback(
    async (tombstone: Tombstone) => {
      const current = await db.tombstones.get(tombstone.noteId);
      if (
        !current ||
        current.deletionId !== tombstone.deletionId ||
        current.scope !== 'local'
      ) {
        return;
      }

      // Snapshot only currently connected peers in active desired rooms.
      // Offline peers are never queued for future deletion delivery.
      const connectedSnapshot = connectedPeersRef.current.filter(
        (peer) =>
          roomsRef.current.has(peer.pairingId) &&
          desiredRoomsRef.current.has(peer.pairingId)
      );

      const deliveries = await prepareDeletionDeliveries(tombstone, connectedSnapshot);
      const pendingDeliveries = deliveries.filter((delivery) => delivery.status === 'pending');
      if (pendingDeliveries.length === 0) {
        return;
      }

      const targetsToSend: Array<{ pairingId: string; peerId: string; ackKey: string }> = [];

      for (const delivery of pendingDeliveries) {
        const key = deletionAckKey(delivery.pairingId, delivery.peerId, tombstone.deletionId);
        if (pendingDeletionAcksRef.current.has(key)) {
          continue;
        }

        const stillConnected =
          connectedPeersRef.current.some(
            (connected) =>
              connected.pairingId === delivery.pairingId &&
              connected.peerId === delivery.peerId
          ) &&
          roomsRef.current.has(delivery.pairingId) &&
          desiredRoomsRef.current.has(delivery.pairingId);

        if (!stillConnected) {
          await updateTombstoneDelivery(
            tombstone,
            { pairingId: delivery.pairingId, peerId: delivery.peerId },
            'failed'
          ).catch((err) => {
            console.warn('Failed to record deletion delivery failure:', err);
          });
          continue;
        }

        const timeoutId = setTimeout(() => {
          const pending = pendingDeletionAcksRef.current.get(key);
          if (!pending || pending.tombstone.deletionId !== tombstone.deletionId) return;
          pendingDeletionAcksRef.current.delete(key);
          void updateTombstoneDelivery(
            tombstone,
            { pairingId: delivery.pairingId, peerId: delivery.peerId },
            'failed'
          ).catch((err) => {
            console.warn('Failed to record deletion delivery failure:', err);
          });
        }, SYNC_TIMEOUT_MS);

        pendingDeletionAcksRef.current.set(key, {
          pairingId: delivery.pairingId,
          peerId: delivery.peerId,
          tombstone,
          timeoutId,
        });
        targetsToSend.push({
          pairingId: delivery.pairingId,
          peerId: delivery.peerId,
          ackKey: key,
        });
      }

      await Promise.all(
        targetsToSend.map(async ({ pairingId, peerId, ackKey }) => {
          const sent = await sendForPairing(
            pairingId,
            {
              type: 'tombstone',
              noteId: tombstone.noteId,
              deletedAt: tombstone.deletedAt,
              deletionId: tombstone.deletionId,
            },
            peerId
          );
          if (!sent) {
            const pending = pendingDeletionAcksRef.current.get(ackKey);
            if (pending && pending.tombstone.deletionId === tombstone.deletionId) {
              clearTimeout(pending.timeoutId);
              pendingDeletionAcksRef.current.delete(ackKey);
              await updateTombstoneDelivery(
                tombstone,
                { pairingId, peerId },
                'failed'
              ).catch((err) => {
                console.warn('Failed to record deletion delivery failure:', err);
              });
            }
          }
        })
      );
    },
    [sendForPairing]
  );

  const evaluateAutoRunCompletionRef = useRef<(autoRun: AutoSyncRun) => void>(() => {});

  const startAutoSyncForPeer = useCallback(
    async (pairingId: string, peerId: string, reason: 'handshake' | 'local-change') => {
      const key = peerCompositeKey(pairingId, peerId);
      if (
        isUnmountedRef.current ||
        !autoSyncEnabledRef.current ||
        peerAutoSyncRef.current.get(key) !== true
      ) {
        return;
      }

      const isConnected = connectedPeersRef.current.some(
        (p) => p.pairingId === pairingId && p.peerId === peerId
      );
      if (!isConnected || !roomsRef.current.has(pairingId)) {
        return;
      }

      // Never collide with an active manual sync or an already active/starting auto-sync on this peer
      const manualBusyWithPeer =
        activeRunRef.current !== null &&
        !activeRunRef.current.settled &&
        activeRunRef.current.peers.has(key);
      if (
        manualBusyWithPeer ||
        autoRunsRef.current.has(key) ||
        startingAutoRunsRef.current.has(key)
      ) {
        if (reason === 'local-change') {
          autoPendingResyncRef.current.add(key);
        }
        return;
      }

      startingAutoRunsRef.current.add(key);

      try {
        while (true) {
          pruneStaleBookkeeping();
          const localManifest = await buildLocalManifest(db);
          if (
            isUnmountedRef.current ||
            !autoSyncEnabledRef.current ||
            peerAutoSyncRef.current.get(key) !== true
          ) {
            return;
          }

          const stillConnected = connectedPeersRef.current.some(
            (p) => p.pairingId === pairingId && p.peerId === peerId
          );
          if (!stillConnected || !roomsRef.current.has(pairingId)) {
            return;
          }

          const manualBecameBusy =
            activeRunRef.current !== null &&
            !activeRunRef.current.settled &&
            activeRunRef.current.peers.has(key);
          if (manualBecameBusy || autoRunsRef.current.has(key)) {
            if (reason === 'local-change') {
              autoPendingResyncRef.current.add(key);
            }
            return;
          }

          const digest = computeManifestDigest(localManifest);
          if (
            reason === 'local-change' &&
            lastAutoSyncedDigestRef.current.get(key) === digest
          ) {
            if (autoPendingResyncRef.current.has(key)) {
              autoPendingResyncRef.current.delete(key);
              continue;
            }
            return;
          }

          const runId = crypto.randomUUID();
          const outboundSessionId = crypto.randomUUID();

          const peerRun: PeerRunState = {
            key,
            pairingId,
            peerId,
            mode: 'auto',
            outboundSessionId,
            inboundSessionId: null,
            localManifest,
            allowedOutboundIds: new Set(localManifest.map((e) => e.noteId)),
            allowedIncomingIds: null,
            outboundRequestReceived: false,
            outboundSendingInProgress: false,
            inboundManifestReceived: false,
            pendingOutgoing: new Map(),
            pendingIncomingIds: new Set(),
            syncedIncomingEntries: new Map(),
            sentCount: 0,
            receivedCount: 0,
            failedCount: 0,
            unchangedCount: 0,
            disconnected: false,
            done: false,
          };

          const autoRun: AutoSyncRun = {
            runId,
            peer: peerRun,
            timeoutId: null,
            settled: false,
          };

          autoRun.timeoutId = setTimeout(() => {
            if (autoRunsRef.current.get(key) === autoRun && !autoRun.settled) {
              peerRun.failedCount++;
              peerRun.disconnected = true;
              evaluateAutoRunCompletionRef.current(autoRun);
            }
          }, SYNC_TIMEOUT_MS);

          autoRunsRef.current.set(key, autoRun);

          const sentOk = await sendForPairing(
            pairingId,
            {
              type: 'manifest',
              sessionId: outboundSessionId,
              entries: localManifest,
              wantsManifest: true,
              autoSync: true,
            },
            peerId
          );

          if (!sentOk && autoRunsRef.current.get(key) === autoRun && !autoRun.settled) {
            peerRun.failedCount++;
            peerRun.disconnected = true;
            evaluateAutoRunCompletionRef.current(autoRun);
          }
          break;
        }
      } finally {
        startingAutoRunsRef.current.delete(key);
      }
    },
    [pruneStaleBookkeeping, sendForPairing]
  );

  const evaluateManualRunCompletion = useCallback(
    (run: ActiveSyncRun) => {
      if (run.settled || activeRunRef.current !== run) return;

      let received = 0;
      let sent = 0;
      let failed = 0;
      let unchanged = 0;
      let pending = 0;
      let allDone = true;

      for (const peerRun of run.peers.values()) {
        if (
          !peerRun.done &&
          (peerRun.disconnected ||
            (peerRun.outboundRequestReceived &&
              !peerRun.outboundSendingInProgress &&
              peerRun.inboundManifestReceived &&
              peerRun.pendingOutgoing.size === 0 &&
              peerRun.pendingIncomingIds.size === 0))
        ) {
          peerRun.done = true;
        }

        if (!peerRun.done) {
          allDone = false;
        }

        received += peerRun.receivedCount;
        sent += peerRun.sentCount;
        failed += peerRun.failedCount;
        unchanged += peerRun.unchangedCount;
        pending += peerRun.pendingOutgoing.size + peerRun.pendingIncomingIds.size;
      }

      const completedTransfers = received + sent + failed;
      const totalTransfers = completedTransfers + pending;

      if (!allDone) {
        if (totalTransfers > 0) {
          setSyncStatus({
            stage: 'transferring',
            progress: completedTransfers,
            total: totalTransfers,
          });
        }
        return;
      }

      run.settled = true;
      if (run.timeoutId !== null) {
        clearTimeout(run.timeoutId);
        run.timeoutId = null;
      }
      if (activeRunRef.current === run) {
        activeRunRef.current = null;
      }

      if (failed > 0) {
        setSyncStatus({
          stage: 'error',
          message: `Sync incomplete: ${received} received, ${sent} sent, ${failed} failed.`,
        });
      } else {
        setSyncStatus({
          stage: 'done',
          result: { received, sent, unchanged },
        });
      }
      scheduleIdleReset();

      if (!isUnmountedRef.current && autoSyncEnabledRef.current) {
        for (const peerRun of run.peers.values()) {
          if (
            autoPendingResyncRef.current.has(peerRun.key) &&
            peerAutoSyncRef.current.get(peerRun.key) === true
          ) {
            autoPendingResyncRef.current.delete(peerRun.key);
            void startAutoSyncForPeer(
              peerRun.pairingId,
              peerRun.peerId,
              'local-change'
            );
          }
        }
      }
    },
    [scheduleIdleReset, startAutoSyncForPeer]
  );

  const evaluateAutoRunCompletion = useCallback((autoRun: AutoSyncRun) => {
    const peerRun = autoRun.peer;
    if (autoRun.settled || autoRunsRef.current.get(peerRun.key) !== autoRun) return;

    const isDone =
      peerRun.disconnected ||
      (peerRun.outboundRequestReceived &&
        !peerRun.outboundSendingInProgress &&
        peerRun.inboundManifestReceived &&
        peerRun.pendingOutgoing.size === 0 &&
        peerRun.pendingIncomingIds.size === 0);

    if (!isDone) return;

    peerRun.done = true;
    autoRun.settled = true;
    if (autoRun.timeoutId !== null) {
      clearTimeout(autoRun.timeoutId);
      autoRun.timeoutId = null;
    }
    autoRunsRef.current.delete(peerRun.key);

    for (const [transferId, entry] of pendingAcksRef.current) {
      if (entry.runType === 'auto' && entry.runId === autoRun.runId) {
        pendingAcksRef.current.delete(transferId);
      }
    }

    // Record only the manifest state actually synchronized by this run (its initial snapshot
    // merged with notes received and persisted during this exchange), never post-snapshot edits.
    if (peerRun.failedCount === 0 && !peerRun.disconnected) {
      const syncedMap = new Map(peerRun.localManifest.map((e) => [e.noteId, e]));
      for (const [noteId, entry] of peerRun.syncedIncomingEntries) {
        syncedMap.set(noteId, entry);
      }
      lastAutoSyncedDigestRef.current.set(
        peerRun.key,
        computeManifestDigest(Array.from(syncedMap.values()))
      );
    }

    if (
      !isUnmountedRef.current &&
      autoPendingResyncRef.current.has(peerRun.key) &&
      autoSyncEnabledRef.current &&
      peerAutoSyncRef.current.get(peerRun.key) === true
    ) {
      autoPendingResyncRef.current.delete(peerRun.key);
      void startAutoSyncForPeer(peerRun.pairingId, peerRun.peerId, 'local-change');
    }
  }, [startAutoSyncForPeer]);

  useEffect(() => {
    evaluateAutoRunCompletionRef.current = evaluateAutoRunCompletion;
  }, [evaluateAutoRunCompletion]);

  const abandonActiveRun = useCallback(
    (message: string) => {
      const run = activeRunRef.current;
      if (!run || run.settled) return;

      run.settled = true;
      if (run.timeoutId !== null) {
        clearTimeout(run.timeoutId);
        run.timeoutId = null;
      }
      activeRunRef.current = null;

      for (const [transferId, entry] of pendingAcksRef.current) {
        if (entry.runType === 'manual' && entry.runId === run.runId) {
          pendingAcksRef.current.delete(transferId);
        }
      }

      if (!isUnmountedRef.current) {
        setSyncStatus({ stage: 'error', message });
        scheduleIdleReset();
      }
    },
    [scheduleIdleReset]
  );

  const handlePeerDisconnected = useCallback(
    (pairingId: string, peerId?: string) => {
      // Cancel pending preview if it targeted this pairing/peer
      const pendingPreview = pendingPreviewRef.current;
      if (
        pendingPreview &&
        pendingPreview.pairingId === pairingId &&
        (peerId === undefined || pendingPreview.peerId === peerId)
      ) {
        clearPreviewRequest();
        if (!isUnmountedRef.current) {
          setManualPreview({
            stage: 'disconnected',
            pairingId,
            message: 'Peer disconnected before returning its note list.',
          });
        }
      } else if (!isUnmountedRef.current) {
        setManualPreview((prev) => {
          if (
            prev.stage === 'ready' &&
            prev.pairingId === pairingId &&
            (peerId === undefined || prev.peerId === peerId)
          ) {
            return {
              stage: 'disconnected',
              pairingId,
              message: 'Peer disconnected while the sync dialogue was open.',
            };
          }
          return prev;
        });
      }

      // Clean up auto-sync state for disconnected peer(s)
      for (const [key] of Array.from(peerAutoSyncRef.current.entries())) {
        const [pId, rPeerId] = key.split('\x00');
        if (pId === pairingId && (peerId === undefined || rPeerId === peerId)) {
          peerAutoSyncRef.current.delete(key);
          cancelAutoSyncForPeer(key);
        }
      }
      if (peerId !== undefined) {
        cancelAutoSyncForPeer(peerCompositeKey(pairingId, peerId));
      }

      // Cancel any responder sessions and pending ACKs for disconnected peer(s)
      for (const [rKey, session] of inboundRespondersRef.current) {
        if (
          session.pairingId === pairingId &&
          (peerId === undefined || session.peerId === peerId)
        ) {
          if (session.timeoutId !== null) {
            clearTimeout(session.timeoutId);
          }
          inboundRespondersRef.current.delete(rKey);
        }
      }
      for (const [sId, session] of outboundRespondersRef.current) {
        if (
          session.pairingId === pairingId &&
          (peerId === undefined || session.peerId === peerId)
        ) {
          outboundRespondersRef.current.delete(sId);
        }
      }
      for (const [transferId, entry] of pendingAcksRef.current) {
        if (
          entry.pairingId === pairingId &&
          (peerId === undefined || entry.peerId === peerId)
        ) {
          pendingAcksRef.current.delete(transferId);
        }
      }
      for (const [key, pending] of Array.from(pendingDeletionAcksRef.current.entries())) {
        if (
          pending.pairingId === pairingId &&
          (peerId === undefined || pending.peerId === peerId)
        ) {
          clearTimeout(pending.timeoutId);
          pendingDeletionAcksRef.current.delete(key);
          void updateTombstoneDelivery(
            pending.tombstone,
            { pairingId: pending.pairingId, peerId: pending.peerId },
            'failed'
          ).catch((err) => {
            console.warn('Failed to record deletion delivery failure:', err);
          });
        }
      }
      if (!isUnmountedRef.current) {
        const nextMap: Record<string, boolean> = {};
        for (const [k, val] of peerAutoSyncRef.current) {
          nextMap[k] = val;
        }
        setPeerAutoSync(nextMap);
      }

      // Fail pending manual run transfers for disconnected peer(s)
      const run = activeRunRef.current;
      if (!run || run.settled) return;

      let touched = false;
      for (const peerRun of run.peers.values()) {
        if (peerRun.pairingId !== pairingId) continue;
        if (peerId !== undefined && peerRun.peerId !== peerId) continue;
        if (peerRun.done) continue;

        const pendingCount =
          peerRun.pendingOutgoing.size + peerRun.pendingIncomingIds.size;
        peerRun.failedCount += pendingCount > 0 ? pendingCount : 1;

        for (const transferId of peerRun.pendingOutgoing.keys()) {
          pendingAcksRef.current.delete(transferId);
        }
        peerRun.pendingOutgoing.clear();
        peerRun.pendingIncomingIds.clear();
        peerRun.disconnected = true;
        peerRun.done = true;
        touched = true;
      }

      if (touched) {
        evaluateManualRunCompletion(run);
      }
    },
    [cancelAutoSyncForPeer, clearPreviewRequest, evaluateManualRunCompletion]
  );

  // Find active peerRun (either manual or auto) matching peerKey and predicate
  const findPeerRunForSession = useCallback(
    (
      key: string,
      predicate: (peerRun: PeerRunState) => boolean
    ): { kind: 'manual'; run: ActiveSyncRun; peerRun: PeerRunState } | { kind: 'auto'; autoRun: AutoSyncRun; peerRun: PeerRunState } | null => {
      const manualRun = activeRunRef.current;
      if (manualRun && !manualRun.settled) {
        const manualPeer = manualRun.peers.get(key);
        if (manualPeer && predicate(manualPeer)) {
          return { kind: 'manual', run: manualRun, peerRun: manualPeer };
        }
      }
      const autoRun = autoRunsRef.current.get(key);
      if (autoRun && !autoRun.settled && predicate(autoRun.peer)) {
        return { kind: 'auto', autoRun, peerRun: autoRun.peer };
      }
      return null;
    },
    []
  );

  const notifyRunCompletion = useCallback(
    (match: { kind: 'manual'; run: ActiveSyncRun } | { kind: 'auto'; autoRun: AutoSyncRun }) => {
      if (match.kind === 'manual') {
        evaluateManualRunCompletion(match.run);
      } else {
        evaluateAutoRunCompletion(match.autoRun);
      }
    },
    [evaluateAutoRunCompletion, evaluateManualRunCompletion]
  );

  // Join a Trystero room for a pairing
  const joinRoom = useCallback(
    (pairing: Pairing): Promise<void> => {
      desiredRoomsRef.current.add(pairing.id);

      if (isUnmountedRef.current || roomsRef.current.has(pairing.id)) {
        return Promise.resolve();
      }

      const existingJoin = pendingJoinsRef.current.get(pairing.id);
      if (existingJoin) {
        return existingJoin;
      }

      let joinPromise: Promise<void> | null = null;
      joinPromise = (async () => {
        try {
          const iceServers = await getIceServers();
          if (isUnmountedRef.current || !desiredRoomsRef.current.has(pairing.id)) {
            return;
          }

          const trystero = await getTrystero();
          if (isUnmountedRef.current || !desiredRoomsRef.current.has(pairing.id)) {
            return;
          }

          const room = trystero.joinRoom(
            {
              appId: APP_ID,
              turnConfig: iceServers,
            },
            pairing.id
          );

          if (isUnmountedRef.current || !desiredRoomsRef.current.has(pairing.id)) {
            try {
              await room.leave?.();
            } catch {}
            return;
          }

          const syncAction = room.makeAction('sync');

          const sendData = async (data: unknown, targetPeerId?: string) => {
            await syncAction.send(
              data,
              targetPeerId ? { target: targetPeerId } : undefined
            );
          };

          const entry: RoomEntry = { room, send: sendData };
          roomsRef.current.set(pairing.id, entry);

          room.onPeerJoin = (peerId: string) => {
            if (
              isUnmountedRef.current ||
              roomsRef.current.get(pairing.id) !== entry ||
              !desiredRoomsRef.current.has(pairing.id)
            ) {
              return;
            }
            const alreadyConnected = connectedPeersRef.current.some(
              (p) => p.pairingId === pairing.id && p.peerId === peerId
            );
            if (!alreadyConnected) {
              const next = [...connectedPeersRef.current, { pairingId: pairing.id, peerId }];
              connectedPeersRef.current = next;
              setConnectedPeers(next);
            }
            // Announce local auto-sync preference on peer join / reconnection
            void sendForPairing(
              pairing.id,
              { type: 'auto-sync-pref', enabled: autoSyncEnabledRef.current },
              peerId
            );
          };

          room.onPeerLeave = (peerId: string) => {
            if (roomsRef.current.get(pairing.id) !== entry) return;
            const next = connectedPeersRef.current.filter(
              (p) => !(p.pairingId === pairing.id && p.peerId === peerId)
            );
            connectedPeersRef.current = next;
            if (!isUnmountedRef.current) {
              setConnectedPeers(next);
            }
            handlePeerDisconnected(pairing.id, peerId);
          };

          // Handle incoming sync messages
          // NOTE: onMessage must NOT be async directly to avoid message channel closing warnings
          syncAction.onMessage = (data: unknown, { peerId }: { peerId: string }) => {
            if (
              isUnmountedRef.current ||
              roomsRef.current.get(pairing.id) !== entry ||
              !desiredRoomsRef.current.has(pairing.id)
            ) {
              return;
            }

            void (async () => {
              try {
                pruneStaleBookkeeping();
                const msg = parseSyncMessage(data);
                if (!msg) {
                  console.warn('Ignoring invalid sync message from peer:', peerId);
                  return;
                }

                const key = peerCompositeKey(pairing.id, peerId);

                // Trust boundary: a currently connected peer in an established, active
                // pairing room may send deletions independently of an active note-sync
                // session so online deletes propagate immediately. Unpaired, disconnected,
                // or undesired-room peers are always rejected.
                if (msg.type === 'tombstone') {
                  const isEstablishedPeer = connectedPeersRef.current.some(
                    (peer) => peer.pairingId === pairing.id && peer.peerId === peerId
                  );
                  if (
                    !isEstablishedPeer ||
                    roomsRef.current.get(pairing.id) !== entry ||
                    !desiredRoomsRef.current.has(pairing.id)
                  ) {
                    console.warn('Rejecting deletion from an unpaired or disconnected peer:', peerId);
                    return;
                  }
                  const result = await applyRemoteTombstone(msg);
                  if (result.removedNote) onNotesChangedRef.current();
                  if (result.outcome === 'invalid') return;
                  if (
                    connectedPeersRef.current.some(
                      (peer) => peer.pairingId === pairing.id && peer.peerId === peerId
                    ) &&
                    roomsRef.current.get(pairing.id) === entry &&
                    desiredRoomsRef.current.has(pairing.id)
                  ) {
                    await sendForPairing(
                      pairing.id,
                      {
                        type: 'tombstone-ack',
                        noteId: msg.noteId,
                        deletionId: msg.deletionId,
                        outcome: result.outcome,
                      },
                      peerId
                    );
                  }
                  return;
                }

                if (msg.type === 'tombstone-ack') {
                  const isEstablishedPeer = connectedPeersRef.current.some(
                    (peer) => peer.pairingId === pairing.id && peer.peerId === peerId
                  );
                  if (
                    !isEstablishedPeer ||
                    roomsRef.current.get(pairing.id) !== entry ||
                    !desiredRoomsRef.current.has(pairing.id)
                  ) {
                    return;
                  }
                  const ackKey = deletionAckKey(pairing.id, peerId, msg.deletionId);
                  const pending = pendingDeletionAcksRef.current.get(ackKey);
                  if (!pending || pending.tombstone.noteId !== msg.noteId) return;
                  clearTimeout(pending.timeoutId);
                  pendingDeletionAcksRef.current.delete(ackKey);
                  await updateTombstoneDelivery(
                    pending.tombstone,
                    { pairingId: pairing.id, peerId },
                    msg.outcome === 'superseded' ? 'superseded' : 'accepted'
                  );
                  return;
                }

                // Capability exchange: peer's Auto-sync preference
                if (msg.type === 'auto-sync-pref') {
                  peerAutoSyncRef.current.set(key, msg.enabled);
                  if (!isUnmountedRef.current) {
                    setPeerAutoSync((prev) => ({ ...prev, [key]: msg.enabled }));
                  }

                  if (!msg.enabled) {
                    cancelAutoSyncForPeer(key);
                  } else if (autoSyncEnabledRef.current) {
                    void startAutoSyncForPeer(pairing.id, peerId, 'handshake');
                  }
                  return;
                }

                // Manual preview query: return fresh manifest without requesting or sending notes
                if (msg.type === 'manifest-request') {
                  const localManifest = await buildLocalManifest(db);
                  const replySessionId = crypto.randomUUID();
                  outboundRespondersRef.current.set(replySessionId, {
                    pairingId: pairing.id,
                    peerId,
                    allowedNoteIds: new Set(localManifest.map((e) => e.noteId)),
                    requestHandled: false,
                    isAutoSync: false,
                    createdAt: Date.now(),
                  });
                  await sendForPairing(
                    pairing.id,
                    {
                      type: 'manifest',
                      sessionId: replySessionId,
                      inReplyTo: msg.sessionId,
                      entries: localManifest,
                      wantsManifest: false,
                      previewOnly: true,
                    },
                    peerId
                  );
                  return;
                }

                // Phase 1: Peer sends manifest
                if (msg.type === 'manifest') {
                  if (!msg.sessionId) {
                    console.warn('Ignoring manifest without sessionId from peer:', peerId);
                    return;
                  }

                  // Handle preview-only manifest replies strictly for the matching pending preview request
                  if (msg.previewOnly === true) {
                    const pendingPreview = pendingPreviewRef.current;
                    if (
                      !pendingPreview ||
                      pendingPreview.sessionId !== msg.inReplyTo ||
                      pendingPreview.pairingId !== pairing.id ||
                      pendingPreview.peerId !== peerId
                    ) {
                      return;
                    }
                    clearPreviewRequest();
                    const localManifest = await buildLocalManifest(db);
                    if (!isUnmountedRef.current) {
                      setManualPreview({
                        stage: 'ready',
                        pairingId: pairing.id,
                        peerId,
                        peerManifestSessionId: msg.sessionId,
                        peerManifest: msg.entries,
                        notes: classifyPeerNotes(localManifest, msg.entries),
                      });
                    }
                    return;
                  }

                  const dedupeKey = `${key}\x00${msg.sessionId}`;
                  if (processedManifestSessionsRef.current.has(dedupeKey)) {
                    return;
                  }
                  processedManifestSessionsRef.current.set(dedupeKey, Date.now());

                  // Match against an active manual or auto run waiting for inbound manifest
                  const activeMatch = findPeerRunForSession(
                    key,
                    (p) => !p.inboundManifestReceived
                  );

                  if (activeMatch) {
                    const { peerRun } = activeMatch;
                    const toRequest = Array.from(
                      new Set(computeDiff(peerRun.localManifest, msg.entries))
                    );
                    const peerNeeds = Array.from(
                      new Set(computeDiff(msg.entries, peerRun.localManifest))
                    );

                    peerRun.inboundManifestReceived = true;
                    peerRun.inboundSessionId = msg.sessionId;
                    peerRun.allowedIncomingIds = new Set(toRequest);
                    peerRun.pendingIncomingIds = new Set(toRequest);
                    peerRun.unchangedCount = countUnchangedNotes(
                      peerRun.localManifest,
                      msg.entries,
                      toRequest,
                      peerNeeds
                    );

                    const sentOk = await sendForPairing(
                      pairing.id,
                      { type: 'request', sessionId: msg.sessionId, noteIds: toRequest },
                      peerId
                    );
                    if (!sentOk) {
                      peerRun.failedCount += Math.max(peerRun.pendingIncomingIds.size, 1);
                      peerRun.pendingIncomingIds.clear();
                    }
                    notifyRunCompletion(activeMatch);
                    return;
                  }

                  // Passive responder path (remote peer initiated sync)
                  if (
                    msg.autoSync === true &&
                    (!autoSyncEnabledRef.current || peerAutoSyncRef.current.get(key) !== true)
                  ) {
                    return;
                  }

                  const localManifest = await buildLocalManifest(db);
                  if (
                    isUnmountedRef.current ||
                    roomsRef.current.get(pairing.id) !== entry ||
                    !desiredRoomsRef.current.has(pairing.id) ||
                    (msg.autoSync === true &&
                      (!autoSyncEnabledRef.current ||
                        peerAutoSyncRef.current.get(key) !== true))
                  ) {
                    return;
                  }

                  const toRequest = Array.from(
                    new Set(computeDiff(localManifest, msg.entries))
                  );

                  const responderKey = `${key}\x00${msg.sessionId}`;
                  let createdInboundResponder: InboundResponderSession | null = null;
                  if (toRequest.length > 0) {
                    const now = Date.now();
                    const session: InboundResponderSession = {
                      sessionId: msg.sessionId,
                      pairingId: pairing.id,
                      peerId,
                      allowedNoteIds: new Set(toRequest),
                      pendingNoteIds: new Set(toRequest),
                      isAutoSync: msg.autoSync === true,
                      createdAt: now,
                      expiresAt: now + SYNC_TIMEOUT_MS,
                      timeoutId: null,
                    };
                    session.timeoutId = setTimeout(() => {
                      const current = inboundRespondersRef.current.get(responderKey);
                      if (current === session) {
                        inboundRespondersRef.current.delete(responderKey);
                      }
                    }, SYNC_TIMEOUT_MS);
                    inboundRespondersRef.current.set(responderKey, session);
                    createdInboundResponder = session;
                  }

                  const reqSentOk = await sendForPairing(
                    pairing.id,
                    { type: 'request', sessionId: msg.sessionId, noteIds: toRequest },
                    peerId
                  );
                  if (!reqSentOk && createdInboundResponder) {
                    const current = inboundRespondersRef.current.get(responderKey);
                    if (current === createdInboundResponder) {
                      if (current.timeoutId !== null) {
                        clearTimeout(current.timeoutId);
                      }
                      inboundRespondersRef.current.delete(responderKey);
                    }
                  }

                  if (msg.wantsManifest === true) {
                    const replySessionId = crypto.randomUUID();
                    outboundRespondersRef.current.set(replySessionId, {
                      pairingId: pairing.id,
                      peerId,
                      allowedNoteIds: new Set(localManifest.map((e) => e.noteId)),
                      requestHandled: false,
                      isAutoSync: msg.autoSync === true,
                      createdAt: Date.now(),
                    });
                    await sendForPairing(
                      pairing.id,
                      {
                        type: 'manifest',
                        sessionId: replySessionId,
                        inReplyTo: msg.sessionId,
                        entries: localManifest,
                        wantsManifest: false,
                      },
                      peerId
                    );
                  }
                  return;
                }

                // Phase 2: Peer requests specific notes for a session
                if (msg.type === 'request') {
                  if (!msg.sessionId) {
                    console.warn('Ignoring request without sessionId from peer:', peerId);
                    return;
                  }

                  const activeMatch = findPeerRunForSession(
                    key,
                    (p) => p.outboundSessionId === msg.sessionId
                  );
                  const responder = !activeMatch
                    ? outboundRespondersRef.current.get(msg.sessionId)
                    : undefined;
                  const isValidResponder =
                    responder &&
                    responder.pairingId === pairing.id &&
                    responder.peerId === peerId;

                  if (!activeMatch && !isValidResponder) {
                    return;
                  }

                  let allowedOutboundIds: Set<string>;
                  if (activeMatch) {
                    if (activeMatch.peerRun.outboundRequestReceived) return;
                    activeMatch.peerRun.outboundRequestReceived = true;
                    activeMatch.peerRun.outboundSendingInProgress = true;
                    allowedOutboundIds = activeMatch.peerRun.allowedOutboundIds;
                  } else {
                    if (responder!.requestHandled) return;
                    responder!.requestHandled = true;
                    allowedOutboundIds = responder!.allowedNoteIds;
                  }

                  const uniqueNoteIds = Array.from(new Set(msg.noteIds));

                  if (uniqueNoteIds.length === 0) {
                    if (activeMatch) {
                      activeMatch.peerRun.outboundSendingInProgress = false;
                      notifyRunCompletion(activeMatch);
                    }
                    return;
                  }

                  try {
                    for (const noteId of uniqueNoteIds) {
                      // Prevent requesting arbitrary/unlisted note IDs not advertised in this session's manifest
                      if (!allowedOutboundIds.has(noteId)) {
                        await sendForPairing(
                          pairing.id,
                          {
                            type: 'note-error',
                            sessionId: msg.sessionId,
                            noteId,
                            reason: 'Note ID not listed in session manifest',
                          },
                          peerId
                        );
                        if (activeMatch) {
                          activeMatch.peerRun.failedCount++;
                        }
                        continue;
                      }

                      const note = await db.notes.get(noteId);
                      if (!note) {
                        await sendForPairing(
                          pairing.id,
                          {
                            type: 'note-error',
                            sessionId: msg.sessionId,
                            noteId,
                            reason: 'Note not found',
                          },
                          peerId
                        );
                        if (activeMatch) {
                          activeMatch.peerRun.failedCount++;
                        }
                        continue;
                      }

                      try {
                        const compressed = await compressNote(note);
                        const transferId = crypto.randomUUID();

                        pendingAcksRef.current.set(transferId, {
                          sessionId: msg.sessionId,
                          pairingId: pairing.id,
                          peerId,
                          noteId,
                          runType: activeMatch
                            ? activeMatch.kind === 'manual'
                              ? 'manual'
                              : 'auto'
                            : 'responder',
                          runId: activeMatch
                            ? activeMatch.kind === 'manual'
                              ? activeMatch.run.runId
                              : activeMatch.autoRun.runId
                            : null,
                          createdAt: Date.now(),
                        });

                        if (activeMatch) {
                          activeMatch.peerRun.pendingOutgoing.set(transferId, noteId);
                          notifyRunCompletion(activeMatch);
                        }

                        const sentOk = await sendForPairing(
                          pairing.id,
                          {
                            type: 'note',
                            sessionId: msg.sessionId,
                            transferId,
                            noteId,
                            payload: Array.from(compressed),
                          },
                          peerId
                        );

                        if (!sentOk) {
                          pendingAcksRef.current.delete(transferId);
                          if (activeMatch) {
                            activeMatch.peerRun.pendingOutgoing.delete(transferId);
                            activeMatch.peerRun.failedCount++;
                          }
                        }
                      } catch {
                        await sendForPairing(
                          pairing.id,
                          {
                            type: 'note-error',
                            sessionId: msg.sessionId,
                            noteId,
                            reason: 'Compression failed',
                          },
                          peerId
                        );
                        if (activeMatch) {
                          activeMatch.peerRun.failedCount++;
                        }
                      }
                    }
                  } finally {
                    if (activeMatch) {
                      activeMatch.peerRun.outboundSendingInProgress = false;
                      notifyRunCompletion(activeMatch);
                    }
                  }
                  return;
                }

                // Phase 3: Receive a note payload and acknowledge after validation + DB put
                if (msg.type === 'note') {
                  if (!msg.sessionId || !msg.transferId) {
                    console.warn('Ignoring note without sessionId/transferId from peer:', peerId);
                    return;
                  }

                  const transferKey = `${key}\x00${msg.sessionId}\x00${msg.transferId}`;
                  const cachedAck = processedIncomingTransfersRef.current.get(transferKey);
                  if (cachedAck) {
                    await sendForPairing(
                      pairing.id,
                      {
                        type: 'ack',
                        sessionId: msg.sessionId,
                        transferId: msg.transferId,
                        noteId: cachedAck.noteId,
                        ok: cachedAck.ok,
                        ...(cachedAck.error !== undefined ? { error: cachedAck.error } : {}),
                      },
                      peerId
                    );
                    return;
                  }

                  const activeMatch = findPeerRunForSession(
                    key,
                    (p) =>
                      p.inboundSessionId === msg.sessionId &&
                      !p.disconnected &&
                      !p.done &&
                      p.inboundManifestReceived &&
                      p.allowedIncomingIds !== null
                  );
                  const isValidActiveMatch =
                    activeMatch !== null &&
                    (activeMatch.kind === 'manual' ||
                      (autoSyncEnabledRef.current &&
                        peerAutoSyncRef.current.get(key) === true));

                  const responderKey = `${key}\x00${msg.sessionId}`;
                  let inboundResponder: InboundResponderSession | null = null;
                  if (!isValidActiveMatch) {
                    const candidate = inboundRespondersRef.current.get(responderKey);
                    if (candidate) {
                      const now = Date.now();
                      if (candidate.expiresAt < now) {
                        if (candidate.timeoutId !== null) {
                          clearTimeout(candidate.timeoutId);
                        }
                        inboundRespondersRef.current.delete(responderKey);
                      } else if (
                        candidate.pairingId === pairing.id &&
                        candidate.peerId === peerId &&
                        (!candidate.isAutoSync ||
                          (autoSyncEnabledRef.current &&
                            peerAutoSyncRef.current.get(key) === true))
                      ) {
                        inboundResponder = candidate;
                      }
                    }
                  }

                  if (!isValidActiveMatch && !inboundResponder) {
                    console.warn(
                      'Rejecting unauthorized or inactive incoming note session from peer:',
                      peerId,
                      msg.sessionId
                    );
                    return;
                  }

                  const authorizedMatch = isValidActiveMatch ? activeMatch : null;
                  const allowedIds = authorizedMatch
                    ? authorizedMatch.peerRun.allowedIncomingIds!
                    : inboundResponder!.allowedNoteIds;
                  const pendingIds = authorizedMatch
                    ? authorizedMatch.peerRun.pendingIncomingIds
                    : inboundResponder!.pendingNoteIds;

                  const isSessionStillAuthorized = (targetNoteId: string): boolean => {
                    if (
                      isUnmountedRef.current ||
                      roomsRef.current.get(pairing.id) !== entry ||
                      !desiredRoomsRef.current.has(pairing.id)
                    ) {
                      return false;
                    }
                    if (authorizedMatch) {
                      if (authorizedMatch.kind === 'manual') {
                        return (
                          activeRunRef.current === authorizedMatch.run &&
                          !authorizedMatch.run.settled &&
                          !authorizedMatch.peerRun.disconnected &&
                          !authorizedMatch.peerRun.done &&
                          authorizedMatch.peerRun.inboundSessionId === msg.sessionId &&
                          authorizedMatch.peerRun.allowedIncomingIds?.has(targetNoteId) === true &&
                          authorizedMatch.peerRun.pendingIncomingIds.has(targetNoteId)
                        );
                      }
                      return (
                        autoRunsRef.current.get(key) === authorizedMatch.autoRun &&
                        !authorizedMatch.autoRun.settled &&
                        !authorizedMatch.peerRun.disconnected &&
                        !authorizedMatch.peerRun.done &&
                        autoSyncEnabledRef.current &&
                        peerAutoSyncRef.current.get(key) === true &&
                        authorizedMatch.peerRun.inboundSessionId === msg.sessionId &&
                        authorizedMatch.peerRun.allowedIncomingIds?.has(targetNoteId) === true &&
                        authorizedMatch.peerRun.pendingIncomingIds.has(targetNoteId)
                      );
                    }
                    const currentResponder = inboundRespondersRef.current.get(responderKey);
                    return (
                      currentResponder === inboundResponder &&
                      currentResponder.pairingId === pairing.id &&
                      currentResponder.peerId === peerId &&
                      currentResponder.expiresAt >= Date.now() &&
                      (!currentResponder.isAutoSync ||
                        (autoSyncEnabledRef.current &&
                          peerAutoSyncRef.current.get(key) === true)) &&
                      currentResponder.allowedNoteIds.has(targetNoteId) &&
                      currentResponder.pendingNoteIds.has(targetNoteId)
                    );
                  };

                  try {
                    if (
                      msg.noteId !== undefined &&
                      (!allowedIds.has(msg.noteId) || !pendingIds.has(msg.noteId))
                    ) {
                      throw new Error('Unexpected note ID not requested in this session');
                    }

                    const note = await decompressNote(msg.payload);
                    if (msg.noteId !== undefined && msg.noteId !== note.id) {
                      throw new Error('Note ID mismatch');
                    }

                    // Enforce session allowlist and pending state before any DB read/write.
                    if (!allowedIds.has(note.id) || !pendingIds.has(note.id)) {
                      throw new Error('Unexpected note ID not requested in this session');
                    }

                    if (!isSessionStillAuthorized(note.id)) {
                      console.warn(
                        'Aborting incoming note write after session became inactive:',
                        peerId,
                        msg.sessionId
                      );
                      return;
                    }

                    const hash = await computeContentHash(note.content, note.attachments);
                    if (!isSessionStillAuthorized(note.id)) {
                      console.warn(
                        'Aborting incoming note write after session became inactive:',
                        peerId,
                        msg.sessionId
                      );
                      return;
                    }
                    const persistence = await persistIncomingNote(
                      { ...note, contentHash: hash },
                      authorizedMatch?.kind === 'manual' &&
                        authorizedMatch.peerRun.mode === 'manual-selected',
                      () => isSessionStillAuthorized(note.id)
                    );
                    if (persistence === 'inactive') return;
                    if (persistence === 'blocked') {
                      throw new Error('Incoming note is blocked by a deletion tombstone');
                    }
                    if (persistence === 'stored') {
                      if (authorizedMatch) {
                        authorizedMatch.peerRun.syncedIncomingEntries.set(note.id, {
                          noteId: note.id,
                          contentHash: hash,
                          updatedAt: note.updatedAt,
                          title: note.title,
                        });
                      }
                      onNotesChangedRef.current();
                    }

                    processedIncomingTransfersRef.current.set(transferKey, {
                      ok: true,
                      noteId: note.id,
                      createdAt: Date.now(),
                    });

                    await sendForPairing(
                      pairing.id,
                      {
                        type: 'ack',
                        sessionId: msg.sessionId,
                        transferId: msg.transferId,
                        noteId: note.id,
                        ok: true,
                      },
                      peerId
                    );

                    if (authorizedMatch) {
                      if (authorizedMatch.peerRun.pendingIncomingIds.has(note.id)) {
                        authorizedMatch.peerRun.pendingIncomingIds.delete(note.id);
                        authorizedMatch.peerRun.receivedCount++;
                        notifyRunCompletion(authorizedMatch);
                      }
                    } else if (inboundResponder) {
                      inboundResponder.pendingNoteIds.delete(note.id);
                      if (inboundResponder.pendingNoteIds.size === 0) {
                        if (inboundResponder.timeoutId !== null) {
                          clearTimeout(inboundResponder.timeoutId);
                        }
                        if (inboundRespondersRef.current.get(responderKey) === inboundResponder) {
                          inboundRespondersRef.current.delete(responderKey);
                        }
                      }
                    }
                  } catch (err) {
                    console.warn('Failed to process incoming note payload:', err);
                    const reportedNoteId = msg.noteId ?? 'unknown';
                    const errText = 'Validation or persistence failed';

                    processedIncomingTransfersRef.current.set(transferKey, {
                      ok: false,
                      noteId: reportedNoteId,
                      error: errText,
                      createdAt: Date.now(),
                    });

                    await sendForPairing(
                      pairing.id,
                      {
                        type: 'ack',
                        sessionId: msg.sessionId,
                        transferId: msg.transferId,
                        noteId: reportedNoteId,
                        ok: false,
                        error: errText,
                      },
                      peerId
                    );

                    if (
                      authorizedMatch &&
                      msg.noteId &&
                      authorizedMatch.peerRun.pendingIncomingIds.has(msg.noteId)
                    ) {
                      authorizedMatch.peerRun.pendingIncomingIds.delete(msg.noteId);
                      authorizedMatch.peerRun.failedCount++;
                      notifyRunCompletion(authorizedMatch);
                    } else if (
                      inboundResponder &&
                      msg.noteId &&
                      inboundResponder.pendingNoteIds.has(msg.noteId)
                    ) {
                      inboundResponder.pendingNoteIds.delete(msg.noteId);
                      if (inboundResponder.pendingNoteIds.size === 0) {
                        if (inboundResponder.timeoutId !== null) {
                          clearTimeout(inboundResponder.timeoutId);
                        }
                        if (inboundRespondersRef.current.get(responderKey) === inboundResponder) {
                          inboundRespondersRef.current.delete(responderKey);
                        }
                      }
                    }
                  }
                  return;
                }

                // Phase 4: Receive transfer acknowledgement from receiver
                if (msg.type === 'ack') {
                  const pending = pendingAcksRef.current.get(msg.transferId);
                  if (
                    !pending ||
                    pending.sessionId !== msg.sessionId ||
                    pending.pairingId !== pairing.id ||
                    pending.peerId !== peerId ||
                    pending.noteId !== msg.noteId
                  ) {
                    return;
                  }
                  pendingAcksRef.current.delete(msg.transferId);

                  if (pending.runType === 'manual') {
                    const currentRun = activeRunRef.current;
                    if (!currentRun || currentRun.settled || currentRun.runId !== pending.runId) {
                      return;
                    }
                    const peerRun = currentRun.peers.get(key);
                    if (!peerRun || !peerRun.pendingOutgoing.has(msg.transferId)) {
                      return;
                    }
                    peerRun.pendingOutgoing.delete(msg.transferId);
                    if (msg.ok) peerRun.sentCount++;
                    else peerRun.failedCount++;
                    evaluateManualRunCompletion(currentRun);
                  } else if (pending.runType === 'auto') {
                    const autoRun = autoRunsRef.current.get(key);
                    if (!autoRun || autoRun.settled || autoRun.runId !== pending.runId) {
                      return;
                    }
                    if (!autoRun.peer.pendingOutgoing.has(msg.transferId)) {
                      return;
                    }
                    autoRun.peer.pendingOutgoing.delete(msg.transferId);
                    if (msg.ok) autoRun.peer.sentCount++;
                    else autoRun.peer.failedCount++;
                    evaluateAutoRunCompletion(autoRun);
                  }
                  return;
                }

                // Sender-reported error for a requested note
                if (msg.type === 'note-error') {
                  const errorKey = `${key}\x00${msg.sessionId}\x00${msg.noteId}`;
                  if (handledNoteErrorsRef.current.has(errorKey)) return;
                  handledNoteErrorsRef.current.set(errorKey, Date.now());

                  const activeMatch = findPeerRunForSession(
                    key,
                    (p) => p.inboundSessionId === msg.sessionId
                  );
                  if (activeMatch && activeMatch.peerRun.pendingIncomingIds.has(msg.noteId)) {
                    activeMatch.peerRun.pendingIncomingIds.delete(msg.noteId);
                    activeMatch.peerRun.failedCount++;
                    notifyRunCompletion(activeMatch);
                    return;
                  }

                  const responderKey = `${key}\x00${msg.sessionId}`;
                  const inboundResponder = inboundRespondersRef.current.get(responderKey);
                  if (inboundResponder && inboundResponder.pendingNoteIds.has(msg.noteId)) {
                    inboundResponder.pendingNoteIds.delete(msg.noteId);
                    if (inboundResponder.pendingNoteIds.size === 0) {
                      if (inboundResponder.timeoutId !== null) {
                        clearTimeout(inboundResponder.timeoutId);
                      }
                      inboundRespondersRef.current.delete(responderKey);
                    }
                  }
                }
              } catch (e) {
                console.warn('Failed to handle incoming sync message:', e);
              }
            })();
          };
        } catch (e) {
          console.warn('Failed to join Trystero room', pairing.id, e);
        } finally {
          if (joinPromise && pendingJoinsRef.current.get(pairing.id) === joinPromise) {
            pendingJoinsRef.current.delete(pairing.id);
          }
        }
      })();

      pendingJoinsRef.current.set(pairing.id, joinPromise);
      return joinPromise;
    },
    [
      cancelAutoSyncForPeer,
      clearPreviewRequest,
      evaluateAutoRunCompletion,
      evaluateManualRunCompletion,
      findPeerRunForSession,
      handlePeerDisconnected,
      notifyRunCompletion,
      pruneStaleBookkeeping,
      sendForPairing,
      startAutoSyncForPeer,
    ]
  );

  const leaveRoom = useCallback(
    (pairingId: string) => {
      desiredRoomsRef.current.delete(pairingId);
      const entry = roomsRef.current.get(pairingId);
      if (entry) {
        roomsRef.current.delete(pairingId);
        try {
          void Promise.resolve(entry.room.leave?.()).catch(() => {});
        } catch {}
      }
      const next = connectedPeersRef.current.filter((p) => p.pairingId !== pairingId);
      connectedPeersRef.current = next;
      if (!isUnmountedRef.current) {
        setConnectedPeers(next);
      }
      handlePeerDisconnected(pairingId);
    },
    [handlePeerDisconnected]
  );

  // On mount: load auto-sync preference + pairings and join all rooms
  useEffect(() => {
    isUnmountedRef.current = false;
    const roomsMap = roomsRef.current;
    const pendingMap = pendingJoinsRef.current;
    const desiredSet = desiredRoomsRef.current;
    const autoDebounceMap = autoDebounceTimersRef.current;
    const autoRunsMap = autoRunsRef.current;
    const startingAutoSet = startingAutoRunsRef.current;
    const autoPendingSet = autoPendingResyncRef.current;
    const lastAutoDigestMap = lastAutoSyncedDigestRef.current;
    const inboundRespondersMap = inboundRespondersRef.current;
    const outboundRespondersMap = outboundRespondersRef.current;
    const pendingAcksMap = pendingAcksRef.current;
    const pendingDeletionAcksMap = pendingDeletionAcksRef.current;

    void (async () => {
      let storedAutoSync = false;
      try {
        storedAutoSync = localStorage.getItem(AUTO_SYNC_STORAGE_KEY) === 'true';
      } catch {}
      if (isUnmountedRef.current) return;
      autoSyncEnabledRef.current = storedAutoSync;
      setAutoSyncEnabledState(storedAutoSync);

      const all = await db.pairings.toArray();
      if (isUnmountedRef.current) return;
      setPairings(all);
      all.forEach((p) => {
        void joinRoom(p);
      });
    })();

    return () => {
      isUnmountedRef.current = true;
      clearIdleTimer();
      clearPreviewRequest();
      if (activeRunRef.current?.timeoutId !== null && activeRunRef.current?.timeoutId !== undefined) {
        clearTimeout(activeRunRef.current.timeoutId);
        activeRunRef.current.timeoutId = null;
      }
      activeRunRef.current = null;
      for (const timer of autoDebounceMap.values()) {
        clearTimeout(timer);
      }
      autoDebounceMap.clear();
      for (const autoRun of autoRunsMap.values()) {
        if (autoRun.timeoutId !== null) {
          clearTimeout(autoRun.timeoutId);
          autoRun.timeoutId = null;
        }
      }
      autoRunsMap.clear();
      startingAutoSet.clear();
      autoPendingSet.clear();
      lastAutoDigestMap.clear();
      for (const session of inboundRespondersMap.values()) {
        if (session.timeoutId !== null) {
          clearTimeout(session.timeoutId);
        }
      }
      inboundRespondersMap.clear();
      outboundRespondersMap.clear();
      pendingAcksMap.clear();
      for (const pending of pendingDeletionAcksMap.values()) {
        clearTimeout(pending.timeoutId);
        void updateTombstoneDelivery(
          pending.tombstone,
          { pairingId: pending.pairingId, peerId: pending.peerId },
          'failed'
        ).catch((err) => {
          console.warn('Failed to record deletion delivery failure:', err);
        });
      }
      pendingDeletionAcksMap.clear();
      desiredSet.clear();
      pendingMap.clear();
      const entries = Array.from(roomsMap.values());
      roomsMap.clear();
      for (const entry of entries) {
        try {
          void Promise.resolve(entry.room.leave?.()).catch(() => {});
        } catch {}
      }
      connectedPeersRef.current = [];
    };
  }, [clearIdleTimer, clearPreviewRequest, joinRoom]);

  const setAutoSyncEnabled = useCallback(
    (enabled: boolean) => {
      autoSyncEnabledRef.current = enabled;
      setAutoSyncEnabledState(enabled);
      try {
        localStorage.setItem(AUTO_SYNC_STORAGE_KEY, String(enabled));
      } catch {}

      for (const peer of connectedPeersRef.current) {
        void sendForPairing(
          peer.pairingId,
          { type: 'auto-sync-pref', enabled },
          peer.peerId
        );
      }

      if (!enabled) {
        const keysToCancel = new Set<string>([
          ...autoDebounceTimersRef.current.keys(),
          ...autoRunsRef.current.keys(),
          ...lastAutoSyncedDigestRef.current.keys(),
          ...autoPendingResyncRef.current,
          ...connectedPeersRef.current.map((p) => peerCompositeKey(p.pairingId, p.peerId)),
        ]);
        for (const session of inboundRespondersRef.current.values()) {
          if (session.isAutoSync) {
            keysToCancel.add(peerCompositeKey(session.pairingId, session.peerId));
          }
        }
        for (const session of outboundRespondersRef.current.values()) {
          if (session.isAutoSync) {
            keysToCancel.add(peerCompositeKey(session.pairingId, session.peerId));
          }
        }
        for (const key of keysToCancel) {
          cancelAutoSyncForPeer(key);
        }
        autoPendingResyncRef.current.clear();
        lastAutoSyncedDigestRef.current.clear();
        return;
      }

      for (const peer of connectedPeersRef.current) {
        const key = peerCompositeKey(peer.pairingId, peer.peerId);
        if (peerAutoSyncRef.current.get(key) === true) {
          void startAutoSyncForPeer(peer.pairingId, peer.peerId, 'handshake');
        }
      }
    },
    [cancelAutoSyncForPeer, sendForPairing, startAutoSyncForPeer]
  );

  const notifyLocalNoteChange = useCallback(() => {
    if (!autoSyncEnabledRef.current || isUnmountedRef.current) {
      return;
    }

    for (const peer of connectedPeersRef.current) {
      const key = peerCompositeKey(peer.pairingId, peer.peerId);
      if (peerAutoSyncRef.current.get(key) !== true) {
        continue;
      }

      const existingTimer = autoDebounceTimersRef.current.get(key);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        autoDebounceTimersRef.current.delete(key);
        void startAutoSyncForPeer(peer.pairingId, peer.peerId, 'local-change');
      }, AUTO_SYNC_DEBOUNCE_MS);
      autoDebounceTimersRef.current.set(key, timer);
    }
  }, [startAutoSyncForPeer]);

  const addPairing = useCallback(
    async (id: string, label: string): Promise<Pairing> => {
      const pairing: Pairing = {
        id,
        label,
        pairedAt: new Date().toISOString(),
      };
      await db.pairings.put(pairing);
      setPairings((prev) => {
        if (prev.some((p) => p.id === id)) return prev;
        return [...prev, pairing];
      });
      await joinRoom(pairing);
      return pairing;
    },
    [joinRoom]
  );

  const removePairing = useCallback(
    async (id: string) => {
      await db.pairings.delete(id);
      leaveRoom(id);
      setPairings((prev) => prev.filter((p) => p.id !== id));
    },
    [leaveRoom]
  );

  const requestPeerManifest = useCallback(
    async (pairingId: string) => {
      clearPreviewRequest();

      const peer = connectedPeersRef.current.find((p) => p.pairingId === pairingId);
      if (!peer || !roomsRef.current.has(pairingId)) {
        setManualPreview({
          stage: 'disconnected',
          pairingId,
          message: 'No live connection to this device. Ensure both devices are online with Notebook open.',
        });
        return;
      }

      const sessionId = crypto.randomUUID();
      const timeoutId = setTimeout(() => {
        if (pendingPreviewRef.current?.sessionId === sessionId) {
          pendingPreviewRef.current = null;
          if (!isUnmountedRef.current) {
            setManualPreview({
              stage: 'error',
              pairingId,
              message: 'Timed out waiting for peer note list.',
            });
          }
        }
      }, MANIFEST_PREVIEW_TIMEOUT_MS);

      pendingPreviewRef.current = {
        sessionId,
        pairingId,
        peerId: peer.peerId,
        timeoutId,
      };
      setManualPreview({
        stage: 'loading',
        pairingId,
        peerId: peer.peerId,
      });

      const sentOk = await sendForPairing(
        pairingId,
        { type: 'manifest-request', sessionId },
        peer.peerId
      );

      if (!sentOk && pendingPreviewRef.current?.sessionId === sessionId) {
        clearPreviewRequest();
        setManualPreview({
          stage: 'error',
          pairingId,
          message: 'Failed to request note list from peer.',
        });
      }
    },
    [clearPreviewRequest, sendForPairing]
  );

  const denyManualSync = useCallback(() => {
    clearPreviewRequest();
    setManualPreview({ stage: 'idle' });
  }, [clearPreviewRequest]);

  const executeManualFullSync = useCallback(
    async (targetPeers: PeerState[]) => {
      if (activeRunRef.current && !activeRunRef.current.settled) {
        return;
      }

      clearIdleTimer();
      pruneStaleBookkeeping();

      if (targetPeers.length === 0) {
        setSyncStatus({
          stage: 'error',
          message: 'No device connected. Ensure both devices are online with Notebook open.',
        });
        scheduleIdleReset();
        return;
      }

      setSyncStatus({ stage: 'exchanging' });

      try {
        const localManifest = await buildLocalManifest(db);
        if (isUnmountedRef.current) return;

        const runId = crypto.randomUUID();
        const peersMap = new Map<string, PeerRunState>();
        const allowedOutboundIds = new Set(localManifest.map((e) => e.noteId));

        for (const peer of targetPeers) {
          const key = peerCompositeKey(peer.pairingId, peer.peerId);
          peersMap.set(key, {
            key,
            pairingId: peer.pairingId,
            peerId: peer.peerId,
            mode: 'manual-all',
            outboundSessionId: crypto.randomUUID(),
            inboundSessionId: null,
            localManifest,
            allowedOutboundIds,
            allowedIncomingIds: null,
            outboundRequestReceived: false,
            outboundSendingInProgress: false,
            inboundManifestReceived: false,
            pendingOutgoing: new Map(),
            pendingIncomingIds: new Set(),
            syncedIncomingEntries: new Map(),
            sentCount: 0,
            receivedCount: 0,
            failedCount: 0,
            unchangedCount: 0,
            disconnected: false,
            done: false,
          });
        }

        const run: ActiveSyncRun = {
          runId,
          peers: peersMap,
          timeoutId: null,
          settled: false,
        };

        run.timeoutId = setTimeout(() => {
          abandonActiveRun('Sync timed out before all transfers completed.');
        }, SYNC_TIMEOUT_MS);

        activeRunRef.current = run;

        await Promise.all(
          Array.from(peersMap.values()).map(async (peerRun) => {
            const sentOk = await sendForPairing(
              peerRun.pairingId,
              {
                type: 'manifest',
                sessionId: peerRun.outboundSessionId,
                entries: localManifest,
                wantsManifest: true,
              },
              peerRun.peerId
            );
            if (!sentOk && activeRunRef.current === run && !run.settled) {
              peerRun.failedCount++;
              peerRun.disconnected = true;
              peerRun.done = true;
            }
          })
        );

        evaluateManualRunCompletion(run);
      } catch {
        abandonActiveRun('Sync failed. Please try again.');
      }
    },
    [
      abandonActiveRun,
      clearIdleTimer,
      evaluateManualRunCompletion,
      pruneStaleBookkeeping,
      scheduleIdleReset,
      sendForPairing,
    ]
  );

  const syncAllWithPeer = useCallback(
    async (pairingId: string) => {
      const targetPeers = connectedPeersRef.current.filter((p) => p.pairingId === pairingId);
      await executeManualFullSync(targetPeers);
    },
    [executeManualFullSync]
  );

  const syncSelectedWithPeer = useCallback(
    async (
      pairingId: string,
      selectedNoteIds: string[],
      previewOverride?: { peerId: string; peerManifestSessionId: string; peerManifest: ManifestEntry[] }
    ) => {
      if (activeRunRef.current && !activeRunRef.current.settled) {
        return;
      }

      const selectedSet = new Set(selectedNoteIds);
      if (selectedSet.size === 0) {
        return;
      }

      const preview =
        previewOverride ??
        (manualPreview.stage === 'ready' && manualPreview.pairingId === pairingId
          ? manualPreview
          : null);

      if (!preview) {
        setSyncStatus({
          stage: 'error',
          message: 'Peer note list is not available. Refresh and try again.',
        });
        scheduleIdleReset();
        return;
      }

      const isStillConnected = connectedPeersRef.current.some(
        (p) => p.pairingId === pairingId && p.peerId === preview.peerId
      );
      if (!isStillConnected || !roomsRef.current.has(pairingId)) {
        setSyncStatus({
          stage: 'error',
          message: 'Device disconnected. Ensure both devices are online.',
        });
        scheduleIdleReset();
        return;
      }

      // Only permit IDs that actually appeared in the peer's advertised manifest
      const selectedPeerEntries = preview.peerManifest.filter((e) =>
        selectedSet.has(e.noteId)
      );
      if (selectedPeerEntries.length === 0) {
        return;
      }

      clearIdleTimer();
      pruneStaleBookkeeping();

      const localManifest = await buildLocalManifest(db);
      if (isUnmountedRef.current) return;

      // Preserve existing LWW conflict handling: skip identical or local-newer/equal-ts notes
      const toRequest = Array.from(
        new Set(computeDiff(localManifest, selectedPeerEntries))
      );

      // Count selected notes that are already identical locally
      const selectedLocalEntries = localManifest.filter((e) => selectedSet.has(e.noteId));
      const unchangedSelected = countUnchangedNotes(
        selectedLocalEntries,
        selectedPeerEntries,
        toRequest,
        []
      );

      if (toRequest.length === 0) {
        setSyncStatus({
          stage: 'done',
          result: { received: 0, sent: 0, unchanged: unchangedSelected },
        });
        scheduleIdleReset();
        return;
      }

      const key = peerCompositeKey(pairingId, preview.peerId);
      const runId = crypto.randomUUID();
      const peerRun: PeerRunState = {
        key,
        pairingId,
        peerId: preview.peerId,
        mode: 'manual-selected',
        outboundSessionId: null,
        inboundSessionId: preview.peerManifestSessionId,
        localManifest,
        allowedOutboundIds: new Set(),
        allowedIncomingIds: new Set(toRequest),
        outboundRequestReceived: true,
        outboundSendingInProgress: false,
        inboundManifestReceived: true,
        pendingOutgoing: new Map(),
        pendingIncomingIds: new Set(toRequest),
        syncedIncomingEntries: new Map(),
        sentCount: 0,
        receivedCount: 0,
        failedCount: 0,
        unchangedCount: unchangedSelected,
        disconnected: false,
        done: false,
      };

      const run: ActiveSyncRun = {
        runId,
        peers: new Map([[key, peerRun]]),
        timeoutId: null,
        settled: false,
      };

      run.timeoutId = setTimeout(() => {
        abandonActiveRun('Selective sync timed out before all transfers completed.');
      }, SYNC_TIMEOUT_MS);

      activeRunRef.current = run;
      setSyncStatus({
        stage: 'transferring',
        progress: 0,
        total: toRequest.length,
      });

      const sentOk = await sendForPairing(
        pairingId,
        {
          type: 'request',
          sessionId: preview.peerManifestSessionId,
          noteIds: toRequest,
        },
        preview.peerId
      );

      if (!sentOk && activeRunRef.current === run && !run.settled) {
        peerRun.failedCount += peerRun.pendingIncomingIds.size;
        peerRun.pendingIncomingIds.clear();
        peerRun.disconnected = true;
        peerRun.done = true;
        evaluateManualRunCompletion(run);
      }
    },
    [
      abandonActiveRun,
      clearIdleTimer,
      evaluateManualRunCompletion,
      manualPreview,
      pruneStaleBookkeeping,
      scheduleIdleReset,
      sendForPairing,
    ]
  );

  const triggerSync = useCallback(async () => {
    if (activeRunRef.current && !activeRunRef.current.settled) {
      return;
    }

    clearIdleTimer();
    let activePeers = connectedPeersRef.current;

    // If no active connections, attempt auto-reconnect and wait up to 5s
    if (activePeers.length === 0) {
      setSyncStatus({ stage: 'connecting' });
      const currentPairings = await db.pairings.toArray();

      await Promise.all(
        currentPairings.map((p) => {
          if (!roomsRef.current.has(p.id)) {
            return joinRoom(p);
          }
          return Promise.resolve();
        })
      );

      const start = Date.now();
      while (Date.now() - start < CONNECT_WAIT_TIMEOUT_MS) {
        if (isUnmountedRef.current) return;
        activePeers = connectedPeersRef.current;
        if (activePeers.length > 0) break;
        await new Promise((res) => setTimeout(res, CONNECT_POLL_INTERVAL_MS));
      }
      activePeers = connectedPeersRef.current;
    }

    if (isUnmountedRef.current) return;

    await executeManualFullSync(activePeers);
  }, [clearIdleTimer, executeManualFullSync, joinRoom]);

  return {
    pairings,
    connectedPeers,
    syncStatus,
    autoSyncEnabled,
    setAutoSyncEnabled,
    peerAutoSync,
    notifyLocalNoteChange,
    propagateDeletion,
    getConnectedPeers,
    manualPreview,
    requestPeerManifest,
    syncAllWithPeer,
    syncSelectedWithPeer,
    denyManualSync,
    addPairing,
    removePairing,
    triggerSync,
    setSyncStatus,
  };
}
