import type { Tombstone } from '@/lib/db';
import type { ManifestEntry, PeerNotePreview } from '@/lib/sync';
import type { IceServer } from '@/lib/turn';

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

export interface TrysteroAction {
  send: (data: unknown, options?: { target?: string | string[] }) => Promise<void>;
  onMessage: ((data: unknown, context: { peerId: string }) => void) | null;
}

export interface TrysteroRoom {
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  makeAction: (name: string) => TrysteroAction;
  leave: () => Promise<void>;
}

export interface TrysteroModule {
  joinRoom: (
    config: { appId: string; turnConfig?: IceServer[] },
    roomId: string
  ) => TrysteroRoom;
}

export interface RoomEntry {
  room: TrysteroRoom;
  send: (data: unknown, targetPeerId?: string) => Promise<void>;
}

export interface PeerRunState {
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

export interface ActiveSyncRun {
  runId: string;
  peers: Map<string, PeerRunState>;
  timeoutId: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

export interface AutoSyncRun {
  runId: string;
  peer: PeerRunState;
  timeoutId: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

export type PeerRunMatch =
  | { kind: 'manual'; run: ActiveSyncRun; peerRun: PeerRunState }
  | { kind: 'auto'; autoRun: AutoSyncRun; peerRun: PeerRunState };

export interface PendingPreviewRequest {
  sessionId: string;
  pairingId: string;
  peerId: string;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export interface OutboundResponderSession {
  pairingId: string;
  peerId: string;
  allowedNoteIds: Set<string>;
  requestHandled: boolean;
  isAutoSync: boolean;
  createdAt: number;
}

export interface InboundResponderSession {
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

export interface PendingAckEntry {
  sessionId: string;
  pairingId: string;
  peerId: string;
  noteId: string;
  runType: 'manual' | 'auto' | 'responder';
  runId: string | null;
  createdAt: number;
}

export interface CachedTransferAck {
  ok: boolean;
  noteId: string;
  error?: string;
  createdAt: number;
}

export interface PendingDeletionAck {
  pairingId: string;
  peerId: string;
  tombstone: Tombstone;
  timeoutId: ReturnType<typeof setTimeout>;
}

export type SendForPairing = (
  pairingId: string,
  data: unknown,
  targetPeerId?: string
) => Promise<boolean>;
