'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { db, type Pairing, type Tombstone } from '@/lib/db';
import {
  buildLocalManifest,
  computeDiff,
  computeManifestDigest,
  countUnchangedNotes,
  type ManifestEntry,
} from '@/lib/sync';
import {
  prepareDeletionDeliveries,
  reconcileInterruptedDeletionDeliveries,
  updateTombstoneDelivery,
} from '@/lib/tombstones';
import {
  AUTO_SYNC_DEBOUNCE_MS,
  AUTO_SYNC_STORAGE_KEY,
  MANIFEST_PREVIEW_TIMEOUT_MS,
  STATUS_RESET_DELAY_MS,
  SYNC_TIMEOUT_MS,
} from './sync/constants';
import { handleIncomingSyncMessage } from './sync/messageHandlers';
import {
  joinPairingRoom,
  leavePairingRoom,
  waitForConnectedPeers,
} from './sync/roomManager';
import {
  cancelAutoSyncForPeerState,
  cleanupAllSyncResources,
  clearPendingPreview,
  failPendingDeletionAcksForPeer,
  failPendingManualTransfersForPeer,
  pruneStaleBookkeeping as pruneBookkeepingMaps,
} from './sync/sessionManager';
import type {
  ActiveSyncRun,
  AutoSyncRun,
  CachedTransferAck,
  InboundResponderSession,
  ManualPreviewState,
  OutboundResponderSession,
  PeerRunState,
  PeerState,
  PendingAckEntry,
  PendingDeletionAck,
  PendingPreviewRequest,
  RoomEntry,
  SyncStatus,
} from './sync/types';
import {
  buildPeerAutoSyncRecord,
  computeSyncedAutoDigest,
  createPeerRunState,
  deletionAckKey,
  isPeerRunComplete,
  peerCompositeKey,
  summarizeManualRun,
} from './sync/utils';

export { AUTO_SYNC_DEBOUNCE_MS, SYNC_TIMEOUT_MS } from './sync/constants';
export type { ManualPreviewState, PeerState, SyncStatus } from './sync/types';

export function useSync(onNotesChanged: () => void) {
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<PeerState[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ stage: 'idle' });
  const [autoSyncEnabled, setAutoSyncEnabledState] = useState(false);
  const [peerAutoSync, setPeerAutoSync] = useState<Record<string, boolean>>({});
  const [manualPreview, setManualPreview] = useState<ManualPreviewState>({ stage: 'idle' });

  const roomsRef = useRef<Map<string, RoomEntry>>(new Map());
  const pendingJoinsRef = useRef<Map<string, Promise<void>>>(new Map());
  const desiredRoomsRef = useRef<Set<string>>(new Set());
  const connectedPeersRef = useRef<PeerState[]>([]);
  const onNotesChangedRef = useRef(onNotesChanged);
  const isUnmountedRef = useRef(false);

  const autoSyncEnabledRef = useRef(false);
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
    clearPendingPreview(
      () => pendingPreviewRef.current,
      (next) => {
        pendingPreviewRef.current = next;
      }
    );
  }, []);

  const cancelAutoSyncForPeer = useCallback((key: string) => {
    cancelAutoSyncForPeerState(key, {
      autoDebounceTimers: autoDebounceTimersRef.current,
      autoPendingResync: autoPendingResyncRef.current,
      lastAutoSyncedDigest: lastAutoSyncedDigestRef.current,
      autoRuns: autoRunsRef.current,
      pendingAcks: pendingAcksRef.current,
      inboundResponders: inboundRespondersRef.current,
      outboundResponders: outboundRespondersRef.current,
    });
  }, []);

  const pruneStaleBookkeeping = useCallback(() => {
    pruneBookkeepingMaps(
      {
        processedManifestSessions: processedManifestSessionsRef.current,
        outboundResponders: outboundRespondersRef.current,
        inboundResponders: inboundRespondersRef.current,
        pendingAcks: pendingAcksRef.current,
        processedIncomingTransfers: processedIncomingTransfersRef.current,
        handledNoteErrors: handledNoteErrorsRef.current,
      },
      activeRunRef.current?.runId ?? null,
      autoRunsRef.current
    );
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
          const peerRun = createPeerRunState({
            key,
            pairingId,
            peerId,
            mode: 'auto',
            outboundSessionId,
            inboundSessionId: null,
            localManifest,
          });

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

      const { allDone, received, sent, failed, unchanged, pending } = summarizeManualRun(run);
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

  const evaluateAutoRunCompletion = useCallback(
    (autoRun: AutoSyncRun) => {
      const peerRun = autoRun.peer;
      if (autoRun.settled || autoRunsRef.current.get(peerRun.key) !== autoRun) return;

      if (!isPeerRunComplete(peerRun)) return;

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
        lastAutoSyncedDigestRef.current.set(peerRun.key, computeSyncedAutoDigest(peerRun));
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
    },
    [startAutoSyncForPeer]
  );

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

      failPendingDeletionAcksForPeer(pendingDeletionAcksRef.current, pairingId, peerId);

      if (!isUnmountedRef.current) {
        setPeerAutoSync(buildPeerAutoSyncRecord(peerAutoSyncRef.current));
      }

      const run = activeRunRef.current;
      if (run && failPendingManualTransfersForPeer(run, pairingId, peerId, pendingAcksRef.current)) {
        evaluateManualRunCompletion(run);
      }
    },
    [cancelAutoSyncForPeer, clearPreviewRequest, evaluateManualRunCompletion]
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

  const joinRoom = useCallback(
    (pairing: Pairing): Promise<void> =>
      joinPairingRoom({
        pairing,
        rooms: roomsRef.current,
        pendingJoins: pendingJoinsRef.current,
        desiredRooms: desiredRoomsRef.current,
        isUnmounted: () => isUnmountedRef.current,
        onPeerJoin: (pairingId, entry, peerId) => {
          if (
            isUnmountedRef.current ||
            roomsRef.current.get(pairingId) !== entry ||
            !desiredRoomsRef.current.has(pairingId)
          ) {
            return;
          }
          const alreadyConnected = connectedPeersRef.current.some(
            (p) => p.pairingId === pairingId && p.peerId === peerId
          );
          if (!alreadyConnected) {
            const next = [...connectedPeersRef.current, { pairingId, peerId }];
            connectedPeersRef.current = next;
            setConnectedPeers(next);
          }
          // Announce local auto-sync preference on peer join / reconnection
          void sendForPairing(
            pairingId,
            { type: 'auto-sync-pref', enabled: autoSyncEnabledRef.current },
            peerId
          );
        },
        onPeerLeave: (pairingId, entry, peerId) => {
          if (roomsRef.current.get(pairingId) !== entry) return;
          const next = connectedPeersRef.current.filter(
            (p) => !(p.pairingId === pairingId && p.peerId === peerId)
          );
          connectedPeersRef.current = next;
          if (!isUnmountedRef.current) {
            setConnectedPeers(next);
          }
          handlePeerDisconnected(pairingId, peerId);
        },
        onSyncMessage: (pairingId, entry, data, peerId) => {
          const isRoomStillActive = () =>
            !isUnmountedRef.current &&
            roomsRef.current.get(pairingId) === entry &&
            desiredRoomsRef.current.has(pairingId);

          if (!isRoomStillActive()) return;

          void handleIncomingSyncMessage(data, {
            pairingId,
            peerId,
            isRoomStillActive,
            isUnmounted: () => isUnmountedRef.current,
            getConnectedPeers: () => connectedPeersRef.current,
            getAutoSyncEnabled: () => autoSyncEnabledRef.current,
            peerAutoSyncMap: peerAutoSyncRef.current,
            syncPeerAutoSyncState: () => {
              if (!isUnmountedRef.current) {
                setPeerAutoSync(buildPeerAutoSyncRecord(peerAutoSyncRef.current));
              }
            },
            getActiveRun: () => activeRunRef.current,
            autoRuns: autoRunsRef.current,
            getPendingPreview: () => pendingPreviewRef.current,
            clearPreviewRequest,
            setManualPreview,
            processedManifestSessions: processedManifestSessionsRef.current,
            outboundResponders: outboundRespondersRef.current,
            inboundResponders: inboundRespondersRef.current,
            pendingAcks: pendingAcksRef.current,
            pendingDeletionAcks: pendingDeletionAcksRef.current,
            processedIncomingTransfers: processedIncomingTransfersRef.current,
            handledNoteErrors: handledNoteErrorsRef.current,
            pruneStaleBookkeeping,
            sendForPairing,
            cancelAutoSyncForPeer,
            startAutoSyncForPeer,
            evaluateManualRunCompletion,
            evaluateAutoRunCompletion,
            notifyRunCompletion,
            onNotesChanged: () => onNotesChangedRef.current(),
          });
        },
      }),
    [
      cancelAutoSyncForPeer,
      clearPreviewRequest,
      evaluateAutoRunCompletion,
      evaluateManualRunCompletion,
      handlePeerDisconnected,
      notifyRunCompletion,
      pruneStaleBookkeeping,
      sendForPairing,
      startAutoSyncForPeer,
    ]
  );

  const leaveRoom = useCallback(
    (pairingId: string) => {
      leavePairingRoom(pairingId, roomsRef.current, desiredRoomsRef.current);
      const next = connectedPeersRef.current.filter((p) => p.pairingId !== pairingId);
      connectedPeersRef.current = next;
      if (!isUnmountedRef.current) {
        setConnectedPeers(next);
      }
      handlePeerDisconnected(pairingId);
    },
    [handlePeerDisconnected]
  );

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

      await reconcileInterruptedDeletionDeliveries(db).catch((err) => {
        console.warn('Failed to reconcile interrupted deletion deliveries:', err);
      });
    })();

    return () => {
      isUnmountedRef.current = true;
      clearIdleTimer();
      clearPreviewRequest();
      if (
        activeRunRef.current?.timeoutId !== null &&
        activeRunRef.current?.timeoutId !== undefined
      ) {
        clearTimeout(activeRunRef.current.timeoutId);
        activeRunRef.current.timeoutId = null;
      }
      activeRunRef.current = null;
      cleanupAllSyncResources({
        rooms: roomsMap,
        pendingJoins: pendingMap,
        desiredRooms: desiredSet,
        autoDebounceTimers: autoDebounceMap,
        autoRuns: autoRunsMap,
        startingAutoRuns: startingAutoSet,
        autoPendingResync: autoPendingSet,
        lastAutoSyncedDigest: lastAutoDigestMap,
        inboundResponders: inboundRespondersMap,
        outboundResponders: outboundRespondersMap,
        pendingAcks: pendingAcksMap,
        pendingDeletionAcks: pendingDeletionAcksMap,
      });
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
          message:
            'No live connection to this device. Ensure both devices are online with Notebook open.',
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
          peersMap.set(
            key,
            createPeerRunState({
              key,
              pairingId: peer.pairingId,
              peerId: peer.peerId,
              mode: 'manual-all',
              outboundSessionId: crypto.randomUUID(),
              inboundSessionId: null,
              localManifest,
              allowedOutboundIds,
            })
          );
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
      previewOverride?: {
        peerId: string;
        peerManifestSessionId: string;
        peerManifest: ManifestEntry[];
      }
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
      const peerRun = createPeerRunState({
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
        inboundManifestReceived: true,
        pendingIncomingIds: new Set(toRequest),
        unchangedCount: unchangedSelected,
      });

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

      activePeers = await waitForConnectedPeers(
        () => connectedPeersRef.current,
        () => isUnmountedRef.current
      );
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
  };
}
