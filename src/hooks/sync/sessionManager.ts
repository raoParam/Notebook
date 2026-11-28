import { updateTombstoneDelivery } from '@/lib/tombstones';
import { SESSION_TTL_MS } from './constants';
import type {
  ActiveSyncRun,
  AutoSyncRun,
  CachedTransferAck,
  InboundResponderSession,
  OutboundResponderSession,
  PendingAckEntry,
  PendingDeletionAck,
  PendingPreviewRequest,
  PeerRunMatch,
  PeerRunState,
  RoomEntry,
} from './types';

export interface BookkeepingMaps {
  processedManifestSessions: Map<string, number>;
  outboundResponders: Map<string, OutboundResponderSession>;
  inboundResponders: Map<string, InboundResponderSession>;
  pendingAcks: Map<string, PendingAckEntry>;
  processedIncomingTransfers: Map<string, CachedTransferAck>;
  handledNoteErrors: Map<string, number>;
}

export interface AutoSyncCancelState {
  autoDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  autoPendingResync: Set<string>;
  lastAutoSyncedDigest: Map<string, string>;
  autoRuns: Map<string, AutoSyncRun>;
  pendingAcks: Map<string, PendingAckEntry>;
  inboundResponders: Map<string, InboundResponderSession>;
  outboundResponders: Map<string, OutboundResponderSession>;
}

export function clearInboundResponderSession(
  inboundResponders: Map<string, InboundResponderSession>,
  responderKey: string,
  expectedSession?: InboundResponderSession
): void {
  const current = inboundResponders.get(responderKey);
  if (!current || (expectedSession && current !== expectedSession)) {
    return;
  }
  if (current.timeoutId !== null) {
    clearTimeout(current.timeoutId);
  }
  inboundResponders.delete(responderKey);
}

export function clearPendingPreview(
  getPending: () => PendingPreviewRequest | null,
  setPending: (next: PendingPreviewRequest | null) => void
): void {
  const pending = getPending();
  if (pending?.timeoutId !== null && pending?.timeoutId !== undefined) {
    clearTimeout(pending.timeoutId);
  }
  setPending(null);
}

export function pruneStaleBookkeeping(
  maps: BookkeepingMaps,
  activeRunId: string | null,
  autoRuns: ReadonlyMap<string, AutoSyncRun>,
  now = Date.now()
): void {
  const cutoff = now - SESSION_TTL_MS;
  for (const [k, ts] of maps.processedManifestSessions) {
    if (ts < cutoff) maps.processedManifestSessions.delete(k);
  }
  for (const [k, session] of maps.outboundResponders) {
    if (session.createdAt < cutoff) maps.outboundResponders.delete(k);
  }
  for (const [k, session] of maps.inboundResponders) {
    if (session.expiresAt < now) {
      clearInboundResponderSession(maps.inboundResponders, k, session);
    }
  }
  for (const [k, entry] of maps.pendingAcks) {
    const activeAuto = Array.from(autoRuns.values()).some((r) => r.runId === entry.runId);
    if (entry.createdAt < cutoff && entry.runId !== activeRunId && !activeAuto) {
      maps.pendingAcks.delete(k);
    }
  }
  for (const [k, cached] of maps.processedIncomingTransfers) {
    if (cached.createdAt < cutoff) maps.processedIncomingTransfers.delete(k);
  }
  for (const [k, ts] of maps.handledNoteErrors) {
    if (ts < cutoff) maps.handledNoteErrors.delete(k);
  }
}

export function cancelAutoSyncForPeerState(key: string, state: AutoSyncCancelState): void {
  const timer = state.autoDebounceTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    state.autoDebounceTimers.delete(key);
  }
  state.autoPendingResync.delete(key);
  state.lastAutoSyncedDigest.delete(key);

  const autoRun = state.autoRuns.get(key);
  if (autoRun) {
    autoRun.settled = true;
    if (autoRun.timeoutId !== null) {
      clearTimeout(autoRun.timeoutId);
      autoRun.timeoutId = null;
    }
    state.autoRuns.delete(key);
    for (const [transferId, entry] of state.pendingAcks) {
      if (entry.runType === 'auto' && entry.runId === autoRun.runId) {
        state.pendingAcks.delete(transferId);
      }
    }
  }

  for (const [rKey, session] of state.inboundResponders) {
    if (session.isAutoSync && `${session.pairingId}\x00${session.peerId}` === key) {
      clearInboundResponderSession(state.inboundResponders, rKey, session);
    }
  }
  for (const [sId, session] of state.outboundResponders) {
    if (session.isAutoSync && `${session.pairingId}\x00${session.peerId}` === key) {
      state.outboundResponders.delete(sId);
    }
  }
}

export function findPeerRunForSession(
  key: string,
  activeRun: ActiveSyncRun | null,
  autoRuns: ReadonlyMap<string, AutoSyncRun>,
  predicate: (peerRun: PeerRunState) => boolean
): PeerRunMatch | null {
  if (activeRun && !activeRun.settled) {
    const manualPeer = activeRun.peers.get(key);
    if (manualPeer && predicate(manualPeer)) {
      return { kind: 'manual', run: activeRun, peerRun: manualPeer };
    }
  }
  const autoRun = autoRuns.get(key);
  if (autoRun && !autoRun.settled && predicate(autoRun.peer)) {
    return { kind: 'auto', autoRun, peerRun: autoRun.peer };
  }
  return null;
}

export function failPendingDeletionAcksForPeer(
  pendingDeletionAcks: Map<string, PendingDeletionAck>,
  pairingId: string,
  peerId?: string
): void {
  for (const [key, pending] of Array.from(pendingDeletionAcks.entries())) {
    if (
      pending.pairingId === pairingId &&
      (peerId === undefined || pending.peerId === peerId)
    ) {
      clearTimeout(pending.timeoutId);
      pendingDeletionAcks.delete(key);
      void updateTombstoneDelivery(
        pending.tombstone,
        { pairingId: pending.pairingId, peerId: pending.peerId },
        'failed'
      ).catch((err) => {
        console.warn('Failed to record deletion delivery failure:', err);
      });
    }
  }
}

export function failPendingManualTransfersForPeer(
  run: ActiveSyncRun | null,
  pairingId: string,
  peerId: string | undefined,
  pendingAcks: Map<string, PendingAckEntry>
): boolean {
  if (!run || run.settled) return false;

  let touched = false;
  for (const peerRun of run.peers.values()) {
    if (peerRun.pairingId !== pairingId) continue;
    if (peerId !== undefined && peerRun.peerId !== peerId) continue;
    if (peerRun.done) continue;

    const pendingCount = peerRun.pendingOutgoing.size + peerRun.pendingIncomingIds.size;
    peerRun.failedCount += pendingCount > 0 ? pendingCount : 1;

    for (const transferId of peerRun.pendingOutgoing.keys()) {
      pendingAcks.delete(transferId);
    }
    peerRun.pendingOutgoing.clear();
    peerRun.pendingIncomingIds.clear();
    peerRun.disconnected = true;
    peerRun.done = true;
    touched = true;
  }

  return touched;
}

export interface SyncUnmountResources {
  rooms: Map<string, RoomEntry>;
  pendingJoins: Map<string, Promise<void>>;
  desiredRooms: Set<string>;
  autoDebounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  autoRuns: Map<string, AutoSyncRun>;
  startingAutoRuns: Set<string>;
  autoPendingResync: Set<string>;
  lastAutoSyncedDigest: Map<string, string>;
  inboundResponders: Map<string, InboundResponderSession>;
  outboundResponders: Map<string, OutboundResponderSession>;
  pendingAcks: Map<string, PendingAckEntry>;
  pendingDeletionAcks: Map<string, PendingDeletionAck>;
}

export function cleanupAllSyncResources(res: SyncUnmountResources): void {
  for (const timer of res.autoDebounceTimers.values()) {
    clearTimeout(timer);
  }
  res.autoDebounceTimers.clear();

  for (const autoRun of res.autoRuns.values()) {
    if (autoRun.timeoutId !== null) {
      clearTimeout(autoRun.timeoutId);
      autoRun.timeoutId = null;
    }
  }
  res.autoRuns.clear();
  res.startingAutoRuns.clear();
  res.autoPendingResync.clear();
  res.lastAutoSyncedDigest.clear();

  for (const session of res.inboundResponders.values()) {
    if (session.timeoutId !== null) {
      clearTimeout(session.timeoutId);
    }
  }
  res.inboundResponders.clear();
  res.outboundResponders.clear();
  res.pendingAcks.clear();

  for (const pending of res.pendingDeletionAcks.values()) {
    clearTimeout(pending.timeoutId);
    void updateTombstoneDelivery(
      pending.tombstone,
      { pairingId: pending.pairingId, peerId: pending.peerId },
      'failed'
    ).catch((err) => {
      console.warn('Failed to record deletion delivery failure:', err);
    });
  }
  res.pendingDeletionAcks.clear();

  res.desiredRooms.clear();
  res.pendingJoins.clear();

  const entries = Array.from(res.rooms.values());
  res.rooms.clear();
  for (const entry of entries) {
    try {
      void Promise.resolve(entry.room.leave?.()).catch(() => {});
    } catch {}
  }
}
