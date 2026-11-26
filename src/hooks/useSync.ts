'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { db, type Pairing } from '@/lib/db';
import {
  buildLocalManifest,
  compressNote,
  computeDiff,
  countUnchangedNotes,
  decompressNote,
  parseSyncMessage,
  type ManifestEntry,
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

const APP_ID = 'notebook-p2p-sync-v1';
export const SYNC_TIMEOUT_MS = 15_000;
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
  outboundSessionId: string;
  inboundSessionId: string | null;
  localManifest: ManifestEntry[];
  outboundRequestReceived: boolean;
  outboundSendingInProgress: boolean;
  inboundManifestReceived: boolean;
  pendingOutgoing: Map<string, string>; // transferId -> noteId
  pendingIncomingIds: Set<string>;
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

interface OutboundResponderSession {
  pairingId: string;
  peerId: string;
  requestHandled: boolean;
  createdAt: number;
}

interface PendingAckEntry {
  sessionId: string;
  pairingId: string;
  peerId: string;
  noteId: string;
  runId: string | null;
  createdAt: number;
}

interface CachedTransferAck {
  ok: boolean;
  noteId: string;
  error?: string;
  createdAt: number;
}

function peerCompositeKey(pairingId: string, peerId: string): string {
  return `${pairingId}\x00${peerId}`;
}

export function useSync(onNotesChanged: () => void) {
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<PeerState[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ stage: 'idle' });

  const roomsRef = useRef<Map<string, RoomEntry>>(new Map());
  const pendingJoinsRef = useRef<Map<string, Promise<void>>>(new Map());
  const desiredRoomsRef = useRef<Set<string>>(new Set());
  const isUnmountedRef = useRef(false);
  const connectedPeersRef = useRef<PeerState[]>([]);
  const onNotesChangedRef = useRef(onNotesChanged);

  const activeRunRef = useRef<ActiveSyncRun | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processedManifestSessionsRef = useRef<Map<string, number>>(new Map());
  const outboundRespondersRef = useRef<Map<string, OutboundResponderSession>>(new Map());
  const pendingAcksRef = useRef<Map<string, PendingAckEntry>>(new Map());
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

  const pruneStaleBookkeeping = useCallback(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [k, ts] of processedManifestSessionsRef.current) {
      if (ts < cutoff) processedManifestSessionsRef.current.delete(k);
    }
    for (const [k, session] of outboundRespondersRef.current) {
      if (session.createdAt < cutoff) outboundRespondersRef.current.delete(k);
    }
    for (const [k, entry] of pendingAcksRef.current) {
      if (entry.createdAt < cutoff && entry.runId !== activeRunRef.current?.runId) {
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

  const evaluateRunCompletion = useCallback(
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
    },
    [scheduleIdleReset]
  );

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
        if (entry.runId === run.runId) {
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
        evaluateRunCompletion(run);
      }
    },
    [evaluateRunCompletion]
  );

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
            if (alreadyConnected) return;
            const next = [...connectedPeersRef.current, { pairingId: pairing.id, peerId }];
            connectedPeersRef.current = next;
            setConnectedPeers(next);
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

                // Phase 1: Peer sends manifest
                if (msg.type === 'manifest') {
                  if (!msg.sessionId) {
                    console.warn('Ignoring manifest without sessionId from peer:', peerId);
                    return;
                  }

                  const dedupeKey = `${key}\x00${msg.sessionId}`;
                  if (processedManifestSessionsRef.current.has(dedupeKey)) {
                    return;
                  }
                  processedManifestSessionsRef.current.set(dedupeKey, Date.now());

                  const currentRun = activeRunRef.current;
                  const peerRun =
                    currentRun && !currentRun.settled ? currentRun.peers.get(key) : undefined;

                  if (peerRun) {
                    if (peerRun.inboundManifestReceived) {
                      return;
                    }

                    const toRequest = Array.from(
                      new Set(computeDiff(peerRun.localManifest, msg.entries))
                    );
                    const peerNeeds = Array.from(
                      new Set(computeDiff(msg.entries, peerRun.localManifest))
                    );

                    peerRun.inboundManifestReceived = true;
                    peerRun.inboundSessionId = msg.sessionId;
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
                    evaluateRunCompletion(currentRun!);
                    return;
                  }

                  // Passive responder path (remote peer initiated sync)
                  const localManifest = await buildLocalManifest(db);
                  const toRequest = Array.from(
                    new Set(computeDiff(localManifest, msg.entries))
                  );
                  await sendForPairing(
                    pairing.id,
                    { type: 'request', sessionId: msg.sessionId, noteIds: toRequest },
                    peerId
                  );

                  if (msg.wantsManifest === true) {
                    const replySessionId = crypto.randomUUID();
                    outboundRespondersRef.current.set(replySessionId, {
                      pairingId: pairing.id,
                      peerId,
                      requestHandled: false,
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

                  const currentRun = activeRunRef.current;
                  const peerRun =
                    currentRun && !currentRun.settled ? currentRun.peers.get(key) : undefined;
                  const isActiveOutbound =
                    peerRun && peerRun.outboundSessionId === msg.sessionId;
                  const responder = !isActiveOutbound
                    ? outboundRespondersRef.current.get(msg.sessionId)
                    : undefined;
                  const isValidResponder =
                    responder &&
                    responder.pairingId === pairing.id &&
                    responder.peerId === peerId;

                  if (!isActiveOutbound && !isValidResponder) {
                    return;
                  }

                  if (isActiveOutbound) {
                    if (peerRun.outboundRequestReceived) return;
                    peerRun.outboundRequestReceived = true;
                    peerRun.outboundSendingInProgress = true;
                  } else if (responder) {
                    if (responder.requestHandled) return;
                    responder.requestHandled = true;
                  }

                  const uniqueNoteIds = Array.from(new Set(msg.noteIds));

                  if (uniqueNoteIds.length === 0) {
                    if (isActiveOutbound && currentRun) {
                      peerRun.outboundSendingInProgress = false;
                      evaluateRunCompletion(currentRun);
                    }
                    return;
                  }

                  try {
                    for (const noteId of uniqueNoteIds) {
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
                        if (isActiveOutbound) {
                          peerRun.failedCount++;
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
                          runId: isActiveOutbound && currentRun ? currentRun.runId : null,
                          createdAt: Date.now(),
                        });

                        if (isActiveOutbound && currentRun) {
                          peerRun.pendingOutgoing.set(transferId, noteId);
                          evaluateRunCompletion(currentRun);
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
                          if (isActiveOutbound) {
                            peerRun.pendingOutgoing.delete(transferId);
                            peerRun.failedCount++;
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
                        if (isActiveOutbound) {
                          peerRun.failedCount++;
                        }
                      }
                    }
                  } finally {
                    if (isActiveOutbound && currentRun) {
                      peerRun.outboundSendingInProgress = false;
                      evaluateRunCompletion(currentRun);
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

                  const currentRun = activeRunRef.current;
                  const peerRun =
                    currentRun &&
                    !currentRun.settled &&
                    currentRun.peers.get(key)?.inboundSessionId === msg.sessionId
                      ? currentRun.peers.get(key)
                      : undefined;

                  try {
                    const note = await decompressNote(msg.payload);
                    if (msg.noteId !== undefined && msg.noteId !== note.id) {
                      throw new Error('Note ID mismatch');
                    }

                    const existing = await db.notes.get(note.id);
                    const incomingTime = Date.parse(note.updatedAt);
                    const existingTime = existing
                      ? Date.parse(existing.updatedAt)
                      : Number.NEGATIVE_INFINITY;
                    if (!existing || !Number.isFinite(existingTime) || incomingTime > existingTime) {
                      const hash = await computeContentHash(note.content, note.attachments);
                      await db.notes.put({
                        id: note.id,
                        title: note.title,
                        content: note.content,
                        attachments: note.attachments,
                        createdAt: note.createdAt,
                        updatedAt: note.updatedAt,
                        contentHash: hash,
                      });
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

                    if (peerRun && peerRun.pendingIncomingIds.has(note.id)) {
                      peerRun.pendingIncomingIds.delete(note.id);
                      peerRun.receivedCount++;
                      evaluateRunCompletion(currentRun!);
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

                    if (peerRun && msg.noteId && peerRun.pendingIncomingIds.has(msg.noteId)) {
                      peerRun.pendingIncomingIds.delete(msg.noteId);
                      peerRun.failedCount++;
                      evaluateRunCompletion(currentRun!);
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

                  const currentRun = activeRunRef.current;
                  if (!currentRun || currentRun.settled || currentRun.runId !== pending.runId) {
                    return;
                  }
                  const peerRun = currentRun.peers.get(key);
                  if (!peerRun || !peerRun.pendingOutgoing.has(msg.transferId)) {
                    return;
                  }

                  peerRun.pendingOutgoing.delete(msg.transferId);
                  if (msg.ok) {
                    peerRun.sentCount++;
                  } else {
                    peerRun.failedCount++;
                  }
                  evaluateRunCompletion(currentRun);
                  return;
                }

                // Sender-reported error for a requested note
                if (msg.type === 'note-error') {
                  const errorKey = `${key}\x00${msg.sessionId}\x00${msg.noteId}`;
                  if (handledNoteErrorsRef.current.has(errorKey)) return;
                  handledNoteErrorsRef.current.set(errorKey, Date.now());

                  const currentRun = activeRunRef.current;
                  const peerRun =
                    currentRun &&
                    !currentRun.settled &&
                    currentRun.peers.get(key)?.inboundSessionId === msg.sessionId
                      ? currentRun.peers.get(key)
                      : undefined;

                  if (peerRun && peerRun.pendingIncomingIds.has(msg.noteId)) {
                    peerRun.pendingIncomingIds.delete(msg.noteId);
                    peerRun.failedCount++;
                    evaluateRunCompletion(currentRun!);
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
    [evaluateRunCompletion, handlePeerDisconnected, pruneStaleBookkeeping, sendForPairing]
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

  // On mount: load pairings and join all rooms
  useEffect(() => {
    isUnmountedRef.current = false;
    const roomsMap = roomsRef.current;
    const pendingMap = pendingJoinsRef.current;
    const desiredSet = desiredRoomsRef.current;

    void (async () => {
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
      if (activeRunRef.current?.timeoutId !== null && activeRunRef.current?.timeoutId !== undefined) {
        clearTimeout(activeRunRef.current.timeoutId);
        activeRunRef.current.timeoutId = null;
      }
      activeRunRef.current = null;
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
  }, [clearIdleTimer, joinRoom]);

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
    if (activeRunRef.current && !activeRunRef.current.settled) {
      return;
    }

    clearIdleTimer();
    pruneStaleBookkeeping();

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

    if (activePeers.length === 0) {
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

      for (const peer of activePeers) {
        const key = peerCompositeKey(peer.pairingId, peer.peerId);
        peersMap.set(key, {
          key,
          pairingId: peer.pairingId,
          peerId: peer.peerId,
          outboundSessionId: crypto.randomUUID(),
          inboundSessionId: null,
          localManifest,
          outboundRequestReceived: false,
          outboundSendingInProgress: false,
          inboundManifestReceived: false,
          pendingOutgoing: new Map(),
          pendingIncomingIds: new Set(),
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

      evaluateRunCompletion(run);
    } catch {
      abandonActiveRun('Sync failed. Please try again.');
    }
  }, [
    abandonActiveRun,
    clearIdleTimer,
    evaluateRunCompletion,
    joinRoom,
    pruneStaleBookkeeping,
    scheduleIdleReset,
    sendForPairing,
  ]);

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
