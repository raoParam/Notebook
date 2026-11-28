import { computeManifestDigest, type ManifestEntry } from '@/lib/sync';
import type { ActiveSyncRun, PeerRunState, PeerState } from './types';

export function peerCompositeKey(pairingId: string, peerId: string): string {
  return `${pairingId}\x00${peerId}`;
}

export function deletionAckKey(pairingId: string, peerId: string, deletionId: string): string {
  return `${peerCompositeKey(pairingId, peerId)}\x00${deletionId}`;
}

export function isPeerConnected(
  connectedPeers: readonly PeerState[],
  pairingId: string,
  peerId: string
): boolean {
  return connectedPeers.some(
    (peer) => peer.pairingId === pairingId && peer.peerId === peerId
  );
}

export function buildPeerAutoSyncRecord(
  peerAutoSyncMap: ReadonlyMap<string, boolean>
): Record<string, boolean> {
  const record: Record<string, boolean> = {};
  for (const [key, enabled] of peerAutoSyncMap) {
    record[key] = enabled;
  }
  return record;
}

export interface CreatePeerRunStateInput {
  key: string;
  pairingId: string;
  peerId: string;
  mode: PeerRunState['mode'];
  outboundSessionId: string | null;
  inboundSessionId: string | null;
  localManifest: ManifestEntry[];
  allowedOutboundIds?: Set<string>;
  allowedIncomingIds?: Set<string> | null;
  outboundRequestReceived?: boolean;
  inboundManifestReceived?: boolean;
  pendingIncomingIds?: Set<string>;
  unchangedCount?: number;
}

export function createPeerRunState(input: CreatePeerRunStateInput): PeerRunState {
  return {
    key: input.key,
    pairingId: input.pairingId,
    peerId: input.peerId,
    mode: input.mode,
    outboundSessionId: input.outboundSessionId,
    inboundSessionId: input.inboundSessionId,
    localManifest: input.localManifest,
    allowedOutboundIds: input.allowedOutboundIds ?? new Set(input.localManifest.map((e) => e.noteId)),
    allowedIncomingIds: input.allowedIncomingIds ?? null,
    outboundRequestReceived: input.outboundRequestReceived ?? false,
    outboundSendingInProgress: false,
    inboundManifestReceived: input.inboundManifestReceived ?? false,
    pendingOutgoing: new Map(),
    pendingIncomingIds: input.pendingIncomingIds ?? new Set(),
    syncedIncomingEntries: new Map(),
    sentCount: 0,
    receivedCount: 0,
    failedCount: 0,
    unchangedCount: input.unchangedCount ?? 0,
    disconnected: false,
    done: false,
  };
}

export function isPeerRunComplete(peerRun: PeerRunState): boolean {
  return (
    peerRun.disconnected ||
    (peerRun.outboundRequestReceived &&
      !peerRun.outboundSendingInProgress &&
      peerRun.inboundManifestReceived &&
      peerRun.pendingOutgoing.size === 0 &&
      peerRun.pendingIncomingIds.size === 0)
  );
}

export interface ManualRunSummary {
  allDone: boolean;
  received: number;
  sent: number;
  failed: number;
  unchanged: number;
  pending: number;
}

export function summarizeManualRun(run: ActiveSyncRun): ManualRunSummary {
  let received = 0;
  let sent = 0;
  let failed = 0;
  let unchanged = 0;
  let pending = 0;
  let allDone = true;

  for (const peerRun of run.peers.values()) {
    if (!peerRun.done && isPeerRunComplete(peerRun)) {
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

  return { allDone, received, sent, failed, unchanged, pending };
}

export function computeSyncedAutoDigest(peerRun: PeerRunState): string {
  const syncedMap = new Map(peerRun.localManifest.map((e) => [e.noteId, e]));
  for (const [noteId, entry] of peerRun.syncedIncomingEntries) {
    syncedMap.set(noteId, entry);
  }
  return computeManifestDigest(Array.from(syncedMap.values()));
}
