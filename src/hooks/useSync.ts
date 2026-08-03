'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { db, type Pairing } from '@/lib/db';
import {
  buildLocalManifest,
  compressNote,
  computeDiff,
  decompressNote,
  type ManifestEntry,
} from '@/lib/sync';
import { computeContentHash } from '@/lib/hash';

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

const APP_ID = 'notebook-p2p-sync-v1';

interface TrysteroAction {
  send: (data: unknown, options?: { target?: string | string[] }) => Promise<void>;
  onMessage: ((data: unknown, context: { peerId: string }) => void | Promise<void>) | null;
}

interface TrysteroRoom {
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  makeAction: (name: string) => TrysteroAction;
  leave: () => Promise<void>;
}

interface TrysteroModule {
  joinRoom: (config: { appId: string }, roomId: string) => TrysteroRoom;
}

async function getTrystero(): Promise<TrysteroModule> {
  const mod = await import('@trystero-p2p/torrent');
  return mod as unknown as TrysteroModule;
}

interface RoomEntry {
  room: TrysteroRoom;
  send: (data: unknown, targetPeerId?: string) => void;
}

export function useSync(onNotesChanged: () => void) {
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<PeerState[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ stage: 'idle' });

  const roomsRef = useRef<Map<string, RoomEntry>>(new Map());

  // Load pairings from DB
  const loadPairings = useCallback(async () => {
    const all = await db.pairings.toArray();
    setPairings(all);
    return all;
  }, []);

  // Join a Trystero room for a pairing
  const joinRoom = useCallback(async (pairing: Pairing) => {
    if (roomsRef.current.has(pairing.id)) return;

    try {
      const trystero = await getTrystero();
      const room = trystero.joinRoom({ appId: APP_ID }, pairing.id);
      const syncAction = room.makeAction('sync');

      const sendData = (data: unknown, targetPeerId?: string) => {
        syncAction.send(data, targetPeerId ? { target: targetPeerId } : undefined);
      };

      room.onPeerJoin = (peerId: string) => {
        setConnectedPeers((prev) => {
          if (prev.some((p) => p.peerId === peerId)) return prev;
          return [...prev, { pairingId: pairing.id, peerId }];
        });
      };

      room.onPeerLeave = (peerId: string) => {
        setConnectedPeers((prev) => prev.filter((p) => p.peerId !== peerId));
      };

      // Handle incoming sync messages
      syncAction.onMessage = async (data: unknown, { peerId }: { peerId: string }) => {
        if (typeof data !== 'object' || data === null) return;
        const msg = data as Record<string, unknown>;

        // Phase 1: Peer sends manifest → compute what WE need + what PEER needs
        if (msg.type === 'manifest') {
          const peerManifest = msg.entries as ManifestEntry[];
          const localManifest = await buildLocalManifest(db);

          // What we need from peer
          const toRequest = computeDiff(localManifest, peerManifest);
          sendData({ type: 'request', noteIds: toRequest }, peerId);

          // What peer needs from us
          const peerNeeds = computeDiff(peerManifest, localManifest);
          for (const noteId of peerNeeds) {
            const note = await db.notes.get(noteId);
            if (note) {
              const compressed = await compressNote(note);
              sendData({ type: 'note', payload: Array.from(compressed) }, peerId);
            }
          }
          sendData({ type: 'done' }, peerId);
        }

        // Phase 2: Peer requests specific notes from us
        if (msg.type === 'request') {
          const noteIds = msg.noteIds as string[];
          for (const noteId of noteIds) {
            const note = await db.notes.get(noteId);
            if (note) {
              const compressed = await compressNote(note);
              sendData({ type: 'note', payload: Array.from(compressed) }, peerId);
            }
          }
        }

        // Phase 3: Receive a note payload
        if (msg.type === 'note') {
          const arr = new Uint8Array(msg.payload as number[]);
          try {
            const note = await decompressNote(arr);
            const existing = await db.notes.get(note.id);
            if (!existing || new Date(note.updatedAt) > new Date(existing.updatedAt)) {
              const hash = await computeContentHash(note.content, note.attachments);
              await db.notes.put({ ...note, contentHash: hash });
              onNotesChanged();
            }
          } catch (e) {
            console.warn('Failed to decompress note payload:', e);
          }
        }
      };

      roomsRef.current.set(pairing.id, { room, send: sendData });
    } catch (e) {
      console.warn('Failed to join Trystero room', pairing.id, e);
    }
  }, [onNotesChanged]);

  const leaveRoom = useCallback((pairingId: string) => {
    const entry = roomsRef.current.get(pairingId);
    if (entry) {
      try { entry.room.leave?.(); } catch {}
      roomsRef.current.delete(pairingId);
    }
    setConnectedPeers((prev) => prev.filter((p) => p.pairingId !== pairingId));
  }, []);

  // On mount: load pairings and join all rooms
  useEffect(() => {
    loadPairings().then((all) => {
      all.forEach(joinRoom);
    });
    return () => {
      roomsRef.current.forEach((_, id) => leaveRoom(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const triggerSync = useCallback(async () => {
    const activePeers = connectedPeers;
    if (activePeers.length === 0) {
      setSyncStatus({
        stage: 'error',
        message: 'No device connected. Make sure the other device has the app open.',
      });
      setTimeout(() => setSyncStatus({ stage: 'idle' }), 4000);
      return;
    }

    setSyncStatus({ stage: 'exchanging' });

    try {
      const localManifest = await buildLocalManifest(db);
      let sent = 0;

      for (const peer of activePeers) {
        const roomEntry = roomsRef.current.get(peer.pairingId);
        if (roomEntry) {
          roomEntry.send({ type: 'manifest', entries: localManifest }, peer.peerId);
          sent++;
        }
      }

      setSyncStatus({ stage: 'transferring', progress: 0, total: activePeers.length });

      // Allow time for the exchange to happen
      await new Promise((res) => setTimeout(res, 3000));

      setSyncStatus({
        stage: 'done',
        result: { received: 0, sent, unchanged: 0 },
      });
      setTimeout(() => setSyncStatus({ stage: 'idle' }), 5000);
    } catch {
      setSyncStatus({ stage: 'error', message: 'Sync failed. Please try again.' });
      setTimeout(() => setSyncStatus({ stage: 'idle' }), 4000);
    }
  }, [connectedPeers]);

  return {
    pairings,
    connectedPeers,
    syncStatus,
    addPairing,
    removePairing,
    triggerSync,
    setSyncStatus,
  };
}

