import type { Pairing } from '@/lib/db';
import { getIceServers } from '@/lib/turn';
import { APP_ID, CONNECT_POLL_INTERVAL_MS, CONNECT_WAIT_TIMEOUT_MS } from './constants';
import type { PeerState, RoomEntry, TrysteroModule } from './types';

async function loadTrystero(): Promise<TrysteroModule> {
  const mod = await import('@trystero-p2p/torrent');
  return mod as unknown as TrysteroModule;
}

export interface JoinPairingRoomParams {
  pairing: Pairing;
  rooms: Map<string, RoomEntry>;
  pendingJoins: Map<string, Promise<void>>;
  desiredRooms: Set<string>;
  isUnmounted: () => boolean;
  onPeerJoin: (pairingId: string, entry: RoomEntry, peerId: string) => void;
  onPeerLeave: (pairingId: string, entry: RoomEntry, peerId: string) => void;
  onSyncMessage: (pairingId: string, entry: RoomEntry, data: unknown, peerId: string) => void;
}

export function joinPairingRoom(params: JoinPairingRoomParams): Promise<void> {
  const {
    pairing,
    rooms,
    pendingJoins,
    desiredRooms,
    isUnmounted,
    onPeerJoin,
    onPeerLeave,
    onSyncMessage,
  } = params;

  desiredRooms.add(pairing.id);

  if (isUnmounted() || rooms.has(pairing.id)) {
    return Promise.resolve();
  }

  const existingJoin = pendingJoins.get(pairing.id);
  if (existingJoin) {
    return existingJoin;
  }

  let joinPromise: Promise<void> | null = null;
  joinPromise = (async () => {
    try {
      const iceServers = await getIceServers();
      if (isUnmounted() || !desiredRooms.has(pairing.id)) {
        return;
      }

      const trystero = await loadTrystero();
      if (isUnmounted() || !desiredRooms.has(pairing.id)) {
        return;
      }

      const room = trystero.joinRoom(
        {
          appId: APP_ID,
          turnConfig: iceServers,
        },
        pairing.id
      );

      if (isUnmounted() || !desiredRooms.has(pairing.id)) {
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
      // Register the room before assigning onPeerJoin, which may fire synchronously.
      rooms.set(pairing.id, entry);

      room.onPeerJoin = (peerId: string) => {
        onPeerJoin(pairing.id, entry, peerId);
      };

      room.onPeerLeave = (peerId: string) => {
        onPeerLeave(pairing.id, entry, peerId);
      };

      // NOTE: onMessage must NOT be async directly to avoid message channel closing warnings.
      syncAction.onMessage = (data: unknown, { peerId }: { peerId: string }) => {
        onSyncMessage(pairing.id, entry, data, peerId);
      };
    } catch (e) {
      console.warn('Failed to join Trystero room', pairing.id, e);
    } finally {
      if (joinPromise && pendingJoins.get(pairing.id) === joinPromise) {
        pendingJoins.delete(pairing.id);
      }
    }
  })();

  pendingJoins.set(pairing.id, joinPromise);
  return joinPromise;
}

export function leavePairingRoom(
  pairingId: string,
  rooms: Map<string, RoomEntry>,
  desiredRooms: Set<string>
): void {
  desiredRooms.delete(pairingId);
  const entry = rooms.get(pairingId);
  if (!entry) return;

  rooms.delete(pairingId);
  try {
    void Promise.resolve(entry.room.leave?.()).catch(() => {});
  } catch {}
}

export async function waitForConnectedPeers(
  getConnectedPeers: () => PeerState[],
  isUnmounted: () => boolean,
  timeoutMs = CONNECT_WAIT_TIMEOUT_MS,
  pollMs = CONNECT_POLL_INTERVAL_MS
): Promise<PeerState[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isUnmounted()) return [];
    const peers = getConnectedPeers();
    if (peers.length > 0) return peers;
    await new Promise((res) => setTimeout(res, pollMs));
  }
  return getConnectedPeers();
}
