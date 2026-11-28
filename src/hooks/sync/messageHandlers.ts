import { db } from '@/lib/db';
import { computeContentHash } from '@/lib/hash';
import {
  buildLocalManifest,
  classifyPeerNotes,
  compressNote,
  computeDiff,
  countUnchangedNotes,
  decompressNote,
  parseSyncMessage,
  type ManifestEntry,
  type SyncMessage,
} from '@/lib/sync';
import {
  applyRemoteTombstone,
  persistIncomingNote,
  updateTombstoneDelivery,
} from '@/lib/tombstones';
import { SYNC_TIMEOUT_MS } from './constants';
import {
  clearInboundResponderSession,
  findPeerRunForSession,
} from './sessionManager';
import type {
  ActiveSyncRun,
  AutoSyncRun,
  CachedTransferAck,
  InboundResponderSession,
  ManualPreviewState,
  OutboundResponderSession,
  PeerRunMatch,
  PeerRunState,
  PeerState,
  PendingAckEntry,
  PendingDeletionAck,
  PendingPreviewRequest,
  SendForPairing,
} from './types';
import { deletionAckKey, isPeerConnected, peerCompositeKey } from './utils';

export interface MessageHandlerContext {
  pairingId: string;
  peerId: string;
  isRoomStillActive: () => boolean;
  isUnmounted: () => boolean;
  getConnectedPeers: () => readonly PeerState[];
  getAutoSyncEnabled: () => boolean;
  peerAutoSyncMap: Map<string, boolean>;
  syncPeerAutoSyncState: () => void;
  getActiveRun: () => ActiveSyncRun | null;
  autoRuns: Map<string, AutoSyncRun>;
  getPendingPreview: () => PendingPreviewRequest | null;
  clearPreviewRequest: () => void;
  setManualPreview: (state: ManualPreviewState) => void;
  processedManifestSessions: Map<string, number>;
  outboundResponders: Map<string, OutboundResponderSession>;
  inboundResponders: Map<string, InboundResponderSession>;
  pendingAcks: Map<string, PendingAckEntry>;
  pendingDeletionAcks: Map<string, PendingDeletionAck>;
  processedIncomingTransfers: Map<string, CachedTransferAck>;
  handledNoteErrors: Map<string, number>;
  pruneStaleBookkeeping: () => void;
  sendForPairing: SendForPairing;
  cancelAutoSyncForPeer: (key: string) => void;
  startAutoSyncForPeer: (
    pairingId: string,
    peerId: string,
    reason: 'handshake' | 'local-change'
  ) => Promise<void>;
  evaluateManualRunCompletion: (run: ActiveSyncRun) => void;
  evaluateAutoRunCompletion: (autoRun: AutoSyncRun) => void;
  notifyRunCompletion: (
    match: { kind: 'manual'; run: ActiveSyncRun } | { kind: 'auto'; autoRun: AutoSyncRun }
  ) => void;
  onNotesChanged: () => void;
}

async function handleTombstoneMessage(
  msg: Extract<SyncMessage, { type: 'tombstone' }>,
  ctx: MessageHandlerContext
): Promise<void> {
  // Trust boundary: only connected peers in an active desired pairing room may delete.
  if (
    !isPeerConnected(ctx.getConnectedPeers(), ctx.pairingId, ctx.peerId) ||
    !ctx.isRoomStillActive()
  ) {
    console.warn('Rejecting deletion from an unpaired or disconnected peer:', ctx.peerId);
    return;
  }

  const result = await applyRemoteTombstone(msg);
  if (result.removedNote) ctx.onNotesChanged();
  if (result.outcome === 'invalid') return;

  if (
    isPeerConnected(ctx.getConnectedPeers(), ctx.pairingId, ctx.peerId) &&
    ctx.isRoomStillActive()
  ) {
    await ctx.sendForPairing(
      ctx.pairingId,
      {
        type: 'tombstone-ack',
        noteId: msg.noteId,
        deletionId: msg.deletionId,
        outcome: result.outcome,
      },
      ctx.peerId
    );
  }
}

async function handleTombstoneAckMessage(
  msg: Extract<SyncMessage, { type: 'tombstone-ack' }>,
  ctx: MessageHandlerContext
): Promise<void> {
  if (
    !isPeerConnected(ctx.getConnectedPeers(), ctx.pairingId, ctx.peerId) ||
    !ctx.isRoomStillActive()
  ) {
    return;
  }

  const ackKey = deletionAckKey(ctx.pairingId, ctx.peerId, msg.deletionId);
  const pending = ctx.pendingDeletionAcks.get(ackKey);
  if (!pending || pending.tombstone.noteId !== msg.noteId) return;

  clearTimeout(pending.timeoutId);
  ctx.pendingDeletionAcks.delete(ackKey);
  await updateTombstoneDelivery(
    pending.tombstone,
    { pairingId: ctx.pairingId, peerId: ctx.peerId },
    msg.outcome === 'superseded' ? 'superseded' : 'accepted'
  );
}

function handleAutoSyncPrefMessage(
  msg: Extract<SyncMessage, { type: 'auto-sync-pref' }>,
  key: string,
  ctx: MessageHandlerContext
): void {
  ctx.peerAutoSyncMap.set(key, msg.enabled);
  if (!ctx.isUnmounted()) {
    ctx.syncPeerAutoSyncState();
  }

  if (!msg.enabled) {
    ctx.cancelAutoSyncForPeer(key);
  } else if (ctx.getAutoSyncEnabled()) {
    void ctx.startAutoSyncForPeer(ctx.pairingId, ctx.peerId, 'handshake');
  }
}

async function handleManifestRequestMessage(
  msg: Extract<SyncMessage, { type: 'manifest-request' }>,
  ctx: MessageHandlerContext
): Promise<void> {
  const localManifest = await buildLocalManifest(db);
  const replySessionId = crypto.randomUUID();
  ctx.outboundResponders.set(replySessionId, {
    pairingId: ctx.pairingId,
    peerId: ctx.peerId,
    allowedNoteIds: new Set(localManifest.map((e) => e.noteId)),
    requestHandled: false,
    isAutoSync: false,
    createdAt: Date.now(),
  });

  await ctx.sendForPairing(
    ctx.pairingId,
    {
      type: 'manifest',
      sessionId: replySessionId,
      inReplyTo: msg.sessionId,
      entries: localManifest,
      wantsManifest: false,
      previewOnly: true,
    },
    ctx.peerId
  );
}

async function handleManifestMessage(
  msg: Extract<SyncMessage, { type: 'manifest' }>,
  key: string,
  ctx: MessageHandlerContext
): Promise<void> {
  if (!msg.sessionId) {
    console.warn('Ignoring manifest without sessionId from peer:', ctx.peerId);
    return;
  }

  if (msg.previewOnly === true) {
    const pendingPreview = ctx.getPendingPreview();
    if (
      !pendingPreview ||
      pendingPreview.sessionId !== msg.inReplyTo ||
      pendingPreview.pairingId !== ctx.pairingId ||
      pendingPreview.peerId !== ctx.peerId
    ) {
      return;
    }
    ctx.clearPreviewRequest();
    const localManifest = await buildLocalManifest(db);
    if (!ctx.isUnmounted()) {
      ctx.setManualPreview({
        stage: 'ready',
        pairingId: ctx.pairingId,
        peerId: ctx.peerId,
        peerManifestSessionId: msg.sessionId,
        peerManifest: msg.entries,
        notes: classifyPeerNotes(localManifest, msg.entries),
      });
    }
    return;
  }

  const dedupeKey = `${key}\x00${msg.sessionId}`;
  if (ctx.processedManifestSessions.has(dedupeKey)) {
    return;
  }
  ctx.processedManifestSessions.set(dedupeKey, Date.now());

  const activeMatch = findPeerRunForSession(
    key,
    ctx.getActiveRun(),
    ctx.autoRuns,
    (p) => !p.inboundManifestReceived
  );

  if (activeMatch) {
    const { peerRun } = activeMatch;
    const toRequest = Array.from(new Set(computeDiff(peerRun.localManifest, msg.entries)));
    const peerNeeds = Array.from(new Set(computeDiff(msg.entries, peerRun.localManifest)));

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

    const sentOk = await ctx.sendForPairing(
      ctx.pairingId,
      { type: 'request', sessionId: msg.sessionId, noteIds: toRequest },
      ctx.peerId
    );
    if (!sentOk) {
      peerRun.failedCount += Math.max(peerRun.pendingIncomingIds.size, 1);
      peerRun.pendingIncomingIds.clear();
    }
    ctx.notifyRunCompletion(activeMatch);
    return;
  }

  const isMutualAutoSync = () =>
    ctx.getAutoSyncEnabled() && ctx.peerAutoSyncMap.get(key) === true;

  if (msg.autoSync === true && !isMutualAutoSync()) {
    return;
  }

  const localManifest = await buildLocalManifest(db);
  if (!ctx.isRoomStillActive() || (msg.autoSync === true && !isMutualAutoSync())) {
    return;
  }

  const toRequest = Array.from(new Set(computeDiff(localManifest, msg.entries)));
  const responderKey = `${key}\x00${msg.sessionId}`;
  let createdInboundResponder: InboundResponderSession | null = null;

  if (toRequest.length > 0) {
    const now = Date.now();
    const session: InboundResponderSession = {
      sessionId: msg.sessionId,
      pairingId: ctx.pairingId,
      peerId: ctx.peerId,
      allowedNoteIds: new Set(toRequest),
      pendingNoteIds: new Set(toRequest),
      isAutoSync: msg.autoSync === true,
      createdAt: now,
      expiresAt: now + SYNC_TIMEOUT_MS,
      timeoutId: null,
    };
    session.timeoutId = setTimeout(() => {
      clearInboundResponderSession(ctx.inboundResponders, responderKey, session);
    }, SYNC_TIMEOUT_MS);
    ctx.inboundResponders.set(responderKey, session);
    createdInboundResponder = session;
  }

  const reqSentOk = await ctx.sendForPairing(
    ctx.pairingId,
    { type: 'request', sessionId: msg.sessionId, noteIds: toRequest },
    ctx.peerId
  );
  if (!reqSentOk && createdInboundResponder) {
    clearInboundResponderSession(ctx.inboundResponders, responderKey, createdInboundResponder);
  }

  if (msg.wantsManifest === true) {
    const replySessionId = crypto.randomUUID();
    ctx.outboundResponders.set(replySessionId, {
      pairingId: ctx.pairingId,
      peerId: ctx.peerId,
      allowedNoteIds: new Set(localManifest.map((e) => e.noteId)),
      requestHandled: false,
      isAutoSync: msg.autoSync === true,
      createdAt: Date.now(),
    });
    await ctx.sendForPairing(
      ctx.pairingId,
      {
        type: 'manifest',
        sessionId: replySessionId,
        inReplyTo: msg.sessionId,
        entries: localManifest,
        wantsManifest: false,
      },
      ctx.peerId
    );
  }
}

async function handleNoteRequestMessage(
  msg: Extract<SyncMessage, { type: 'request' }>,
  key: string,
  ctx: MessageHandlerContext
): Promise<void> {
  if (!msg.sessionId) {
    console.warn('Ignoring request without sessionId from peer:', ctx.peerId);
    return;
  }

  const activeMatch = findPeerRunForSession(
    key,
    ctx.getActiveRun(),
    ctx.autoRuns,
    (p) => p.outboundSessionId === msg.sessionId
  );
  const responder = !activeMatch ? ctx.outboundResponders.get(msg.sessionId) : undefined;
  const isValidResponder =
    responder !== undefined &&
    responder.pairingId === ctx.pairingId &&
    responder.peerId === ctx.peerId;

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
      ctx.notifyRunCompletion(activeMatch);
    }
    return;
  }

  try {
    for (const noteId of uniqueNoteIds) {
      if (!allowedOutboundIds.has(noteId)) {
        await ctx.sendForPairing(
          ctx.pairingId,
          {
            type: 'note-error',
            sessionId: msg.sessionId,
            noteId,
            reason: 'Note ID not listed in session manifest',
          },
          ctx.peerId
        );
        if (activeMatch) activeMatch.peerRun.failedCount++;
        continue;
      }

      const note = await db.notes.get(noteId);
      if (!note) {
        await ctx.sendForPairing(
          ctx.pairingId,
          {
            type: 'note-error',
            sessionId: msg.sessionId,
            noteId,
            reason: 'Note not found',
          },
          ctx.peerId
        );
        if (activeMatch) activeMatch.peerRun.failedCount++;
        continue;
      }

      try {
        const compressed = await compressNote(note);
        const transferId = crypto.randomUUID();

        ctx.pendingAcks.set(transferId, {
          sessionId: msg.sessionId,
          pairingId: ctx.pairingId,
          peerId: ctx.peerId,
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
          ctx.notifyRunCompletion(activeMatch);
        }

        const sentOk = await ctx.sendForPairing(
          ctx.pairingId,
          {
            type: 'note',
            sessionId: msg.sessionId,
            transferId,
            noteId,
            payload: Array.from(compressed),
          },
          ctx.peerId
        );

        if (!sentOk) {
          ctx.pendingAcks.delete(transferId);
          if (activeMatch) {
            activeMatch.peerRun.pendingOutgoing.delete(transferId);
            activeMatch.peerRun.failedCount++;
          }
        }
      } catch {
        await ctx.sendForPairing(
          ctx.pairingId,
          {
            type: 'note-error',
            sessionId: msg.sessionId,
            noteId,
            reason: 'Compression failed',
          },
          ctx.peerId
        );
        if (activeMatch) activeMatch.peerRun.failedCount++;
      }
    }
  } finally {
    if (activeMatch) {
      activeMatch.peerRun.outboundSendingInProgress = false;
      ctx.notifyRunCompletion(activeMatch);
    }
  }
}

function resolveIncomingNoteAuthorization(
  sessionId: string,
  key: string,
  ctx: MessageHandlerContext
): {
  authorizedMatch: PeerRunMatch | null;
  inboundResponder: InboundResponderSession | null;
} | null {
  const isMutualAutoSync = () =>
    ctx.getAutoSyncEnabled() && ctx.peerAutoSyncMap.get(key) === true;

  const activeMatch = findPeerRunForSession(
    key,
    ctx.getActiveRun(),
    ctx.autoRuns,
    (p) =>
      p.inboundSessionId === sessionId &&
      !p.disconnected &&
      !p.done &&
      p.inboundManifestReceived &&
      p.allowedIncomingIds !== null
  );

  const isValidActiveMatch =
    activeMatch !== null && (activeMatch.kind === 'manual' || isMutualAutoSync());

  if (isValidActiveMatch) {
    return { authorizedMatch: activeMatch, inboundResponder: null };
  }

  const responderKey = `${key}\x00${sessionId}`;
  const candidate = ctx.inboundResponders.get(responderKey);
  if (candidate) {
    if (candidate.expiresAt < Date.now()) {
      clearInboundResponderSession(ctx.inboundResponders, responderKey, candidate);
    } else if (
      candidate.pairingId === ctx.pairingId &&
      candidate.peerId === ctx.peerId &&
      (!candidate.isAutoSync || isMutualAutoSync())
    ) {
      return { authorizedMatch: null, inboundResponder: candidate };
    }
  }

  return null;
}

async function handleIncomingNoteMessage(
  msg: Extract<SyncMessage, { type: 'note' }>,
  key: string,
  ctx: MessageHandlerContext
): Promise<void> {
  if (!msg.sessionId || !msg.transferId) {
    console.warn('Ignoring note without sessionId/transferId from peer:', ctx.peerId);
    return;
  }

  const sessionId = msg.sessionId;
  const transferKey = `${key}\x00${sessionId}\x00${msg.transferId}`;
  const cachedAck = ctx.processedIncomingTransfers.get(transferKey);
  if (cachedAck) {
    await ctx.sendForPairing(
      ctx.pairingId,
      {
        type: 'ack',
        sessionId,
        transferId: msg.transferId,
        noteId: cachedAck.noteId,
        ok: cachedAck.ok,
        ...(cachedAck.error !== undefined ? { error: cachedAck.error } : {}),
      },
      ctx.peerId
    );
    return;
  }

  const auth = resolveIncomingNoteAuthorization(sessionId, key, ctx);
  if (!auth) {
    console.warn(
      'Rejecting unauthorized or inactive incoming note session from peer:',
      ctx.peerId,
      sessionId
    );
    return;
  }

  const { authorizedMatch, inboundResponder } = auth;
  const responderKey = `${key}\x00${sessionId}`;
  const allowedIds = authorizedMatch
    ? authorizedMatch.peerRun.allowedIncomingIds!
    : inboundResponder!.allowedNoteIds;
  const pendingIds = authorizedMatch
    ? authorizedMatch.peerRun.pendingIncomingIds
    : inboundResponder!.pendingNoteIds;

  const isSessionStillAuthorized = (targetNoteId: string): boolean => {
    if (!ctx.isRoomStillActive()) return false;

    const isMutualAuto = ctx.getAutoSyncEnabled() && ctx.peerAutoSyncMap.get(key) === true;

    if (authorizedMatch) {
      const peerRun: PeerRunState = authorizedMatch.peerRun;
      const runAlive =
        authorizedMatch.kind === 'manual'
          ? ctx.getActiveRun() === authorizedMatch.run && !authorizedMatch.run.settled
          : ctx.autoRuns.get(key) === authorizedMatch.autoRun &&
            !authorizedMatch.autoRun.settled &&
            isMutualAuto;

      return (
        runAlive &&
        !peerRun.disconnected &&
        !peerRun.done &&
        peerRun.inboundSessionId === sessionId &&
        peerRun.allowedIncomingIds?.has(targetNoteId) === true &&
        peerRun.pendingIncomingIds.has(targetNoteId)
      );
    }

    const currentResponder = ctx.inboundResponders.get(responderKey);
    return (
      currentResponder === inboundResponder &&
      currentResponder.pairingId === ctx.pairingId &&
      currentResponder.peerId === ctx.peerId &&
      currentResponder.expiresAt >= Date.now() &&
      (!currentResponder.isAutoSync || isMutualAuto) &&
      currentResponder.allowedNoteIds.has(targetNoteId) &&
      currentResponder.pendingNoteIds.has(targetNoteId)
    );
  };

  try {
    if (msg.noteId !== undefined && (!allowedIds.has(msg.noteId) || !pendingIds.has(msg.noteId))) {
      throw new Error('Unexpected note ID not requested in this session');
    }

    const note = await decompressNote(msg.payload);
    if (msg.noteId !== undefined && msg.noteId !== note.id) {
      throw new Error('Note ID mismatch');
    }

    if (!allowedIds.has(note.id) || !pendingIds.has(note.id)) {
      throw new Error('Unexpected note ID not requested in this session');
    }

    if (!isSessionStillAuthorized(note.id)) {
      console.warn(
        'Aborting incoming note write after session became inactive:',
        ctx.peerId,
        sessionId
      );
      return;
    }

    const hash = await computeContentHash(note.content, note.attachments);
    if (!isSessionStillAuthorized(note.id)) {
      console.warn(
        'Aborting incoming note write after session became inactive:',
        ctx.peerId,
        sessionId
      );
      return;
    }

    const persistence = await persistIncomingNote(
      { ...note, contentHash: hash },
      authorizedMatch?.kind === 'manual' && authorizedMatch.peerRun.mode === 'manual-selected',
      () => isSessionStillAuthorized(note.id)
    );
    if (persistence === 'inactive') return;
    if (persistence === 'blocked') {
      throw new Error('Incoming note is blocked by a deletion tombstone');
    }
    if (persistence === 'stored') {
      if (authorizedMatch) {
        const entry: ManifestEntry = {
          noteId: note.id,
          contentHash: hash,
          updatedAt: note.updatedAt,
          title: note.title,
        };
        authorizedMatch.peerRun.syncedIncomingEntries.set(note.id, entry);
      }
      ctx.onNotesChanged();
    }

    ctx.processedIncomingTransfers.set(transferKey, {
      ok: true,
      noteId: note.id,
      createdAt: Date.now(),
    });

    await ctx.sendForPairing(
      ctx.pairingId,
      {
        type: 'ack',
        sessionId,
        transferId: msg.transferId,
        noteId: note.id,
        ok: true,
      },
      ctx.peerId
    );

    if (authorizedMatch) {
      if (authorizedMatch.peerRun.pendingIncomingIds.has(note.id)) {
        authorizedMatch.peerRun.pendingIncomingIds.delete(note.id);
        authorizedMatch.peerRun.receivedCount++;
        ctx.notifyRunCompletion(authorizedMatch);
      }
    } else if (inboundResponder) {
      inboundResponder.pendingNoteIds.delete(note.id);
      if (inboundResponder.pendingNoteIds.size === 0) {
        clearInboundResponderSession(ctx.inboundResponders, responderKey, inboundResponder);
      }
    }
  } catch (err) {
    console.warn('Failed to process incoming note payload:', err);
    const reportedNoteId = msg.noteId ?? 'unknown';
    const errText = 'Validation or persistence failed';

    ctx.processedIncomingTransfers.set(transferKey, {
      ok: false,
      noteId: reportedNoteId,
      error: errText,
      createdAt: Date.now(),
    });

    await ctx.sendForPairing(
      ctx.pairingId,
      {
        type: 'ack',
        sessionId,
        transferId: msg.transferId,
        noteId: reportedNoteId,
        ok: false,
        error: errText,
      },
      ctx.peerId
    );

    if (
      authorizedMatch &&
      msg.noteId &&
      authorizedMatch.peerRun.pendingIncomingIds.has(msg.noteId)
    ) {
      authorizedMatch.peerRun.pendingIncomingIds.delete(msg.noteId);
      authorizedMatch.peerRun.failedCount++;
      ctx.notifyRunCompletion(authorizedMatch);
    } else if (inboundResponder && msg.noteId && inboundResponder.pendingNoteIds.has(msg.noteId)) {
      inboundResponder.pendingNoteIds.delete(msg.noteId);
      if (inboundResponder.pendingNoteIds.size === 0) {
        clearInboundResponderSession(ctx.inboundResponders, responderKey, inboundResponder);
      }
    }
  }
}

function handleTransferAckMessage(
  msg: Extract<SyncMessage, { type: 'ack' }>,
  key: string,
  ctx: MessageHandlerContext
): void {
  const pending = ctx.pendingAcks.get(msg.transferId);
  if (
    !pending ||
    pending.sessionId !== msg.sessionId ||
    pending.pairingId !== ctx.pairingId ||
    pending.peerId !== ctx.peerId ||
    pending.noteId !== msg.noteId
  ) {
    return;
  }
  ctx.pendingAcks.delete(msg.transferId);

  if (pending.runType === 'manual') {
    const currentRun = ctx.getActiveRun();
    if (!currentRun || currentRun.settled || currentRun.runId !== pending.runId) return;
    const peerRun = currentRun.peers.get(key);
    if (!peerRun || !peerRun.pendingOutgoing.has(msg.transferId)) return;
    peerRun.pendingOutgoing.delete(msg.transferId);
    if (msg.ok) peerRun.sentCount++;
    else peerRun.failedCount++;
    ctx.evaluateManualRunCompletion(currentRun);
  } else if (pending.runType === 'auto') {
    const autoRun = ctx.autoRuns.get(key);
    if (!autoRun || autoRun.settled || autoRun.runId !== pending.runId) return;
    if (!autoRun.peer.pendingOutgoing.has(msg.transferId)) return;
    autoRun.peer.pendingOutgoing.delete(msg.transferId);
    if (msg.ok) autoRun.peer.sentCount++;
    else autoRun.peer.failedCount++;
    ctx.evaluateAutoRunCompletion(autoRun);
  }
}

function handleNoteErrorMessage(
  msg: Extract<SyncMessage, { type: 'note-error' }>,
  key: string,
  ctx: MessageHandlerContext
): void {
  const errorKey = `${key}\x00${msg.sessionId}\x00${msg.noteId}`;
  if (ctx.handledNoteErrors.has(errorKey)) return;
  ctx.handledNoteErrors.set(errorKey, Date.now());

  const activeMatch = findPeerRunForSession(
    key,
    ctx.getActiveRun(),
    ctx.autoRuns,
    (p) => p.inboundSessionId === msg.sessionId
  );
  if (activeMatch && activeMatch.peerRun.pendingIncomingIds.has(msg.noteId)) {
    activeMatch.peerRun.pendingIncomingIds.delete(msg.noteId);
    activeMatch.peerRun.failedCount++;
    ctx.notifyRunCompletion(activeMatch);
    return;
  }

  const responderKey = `${key}\x00${msg.sessionId}`;
  const inboundResponder = ctx.inboundResponders.get(responderKey);
  if (inboundResponder && inboundResponder.pendingNoteIds.has(msg.noteId)) {
    inboundResponder.pendingNoteIds.delete(msg.noteId);
    if (inboundResponder.pendingNoteIds.size === 0) {
      clearInboundResponderSession(ctx.inboundResponders, responderKey, inboundResponder);
    }
  }
}

export async function handleIncomingSyncMessage(
  data: unknown,
  ctx: MessageHandlerContext
): Promise<void> {
  try {
    ctx.pruneStaleBookkeeping();
    const msg = parseSyncMessage(data);
    if (!msg) {
      console.warn('Ignoring invalid sync message from peer:', ctx.peerId);
      return;
    }

    const key = peerCompositeKey(ctx.pairingId, ctx.peerId);

    switch (msg.type) {
      case 'tombstone':
        await handleTombstoneMessage(msg, ctx);
        return;
      case 'tombstone-ack':
        await handleTombstoneAckMessage(msg, ctx);
        return;
      case 'auto-sync-pref':
        handleAutoSyncPrefMessage(msg, key, ctx);
        return;
      case 'manifest-request':
        await handleManifestRequestMessage(msg, ctx);
        return;
      case 'manifest':
        await handleManifestMessage(msg, key, ctx);
        return;
      case 'request':
        await handleNoteRequestMessage(msg, key, ctx);
        return;
      case 'note':
        await handleIncomingNoteMessage(msg, key, ctx);
        return;
      case 'ack':
        handleTransferAckMessage(msg, key, ctx);
        return;
      case 'note-error':
        handleNoteErrorMessage(msg, key, ctx);
        return;
      case 'done':
        return;
    }
  } catch (e) {
    console.warn('Failed to handle incoming sync message:', e);
  }
}
