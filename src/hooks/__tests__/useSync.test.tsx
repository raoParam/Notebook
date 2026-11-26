// @vitest-environment jsdom
import { AsyncLocalStorage } from 'node:async_hooks';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, Pairing } from '@/lib/db';
import { computeContentHash } from '@/lib/hash';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── In-memory DB per device instance ────────────────────────────────────────

interface MockDeviceDb {
  notesMap: Map<string, Note>;
  pairingsMap: Map<string, Pairing>;
  failNextPutNoteId: string | null;
  notes: {
    toArray: () => Promise<Note[]>;
    get: (id: string) => Promise<Note | undefined>;
    put: (note: Note) => Promise<string>;
    delete: (id: string) => Promise<void>;
  };
  pairings: {
    toArray: () => Promise<Pairing[]>;
    put: (pairing: Pairing) => Promise<string>;
    delete: (id: string) => Promise<void>;
  };
}

function createMockDb(initialNotes: Note[] = [], initialPairings: Pairing[] = []): MockDeviceDb {
  const notesMap = new Map(initialNotes.map((n) => [n.id, n]));
  const pairingsMap = new Map(initialPairings.map((p) => [p.id, p]));
  const mock: MockDeviceDb = {
    notesMap,
    pairingsMap,
    failNextPutNoteId: null,
    notes: {
      toArray: async () => Array.from(notesMap.values()),
      get: async (id: string) => notesMap.get(id),
      put: async (note: Note) => {
        if (mock.failNextPutNoteId === note.id) {
          mock.failNextPutNoteId = null;
          throw new Error('Simulated IndexedDB write error');
        }
        notesMap.set(note.id, note);
        return note.id;
      },
      delete: async (id: string) => {
        notesMap.delete(id);
      },
    },
    pairings: {
      toArray: async () => Array.from(pairingsMap.values()),
      put: async (pairing: Pairing) => {
        pairingsMap.set(pairing.id, pairing);
        return pairing.id;
      },
      delete: async (id: string) => {
        pairingsMap.delete(id);
      },
    },
  };
  return mock;
}

// Per-async-context DB store so concurrent Device A & Device B async tasks never cross DBs
const dbContext = new AsyncLocalStorage<MockDeviceDb>();
let fallbackDb: MockDeviceDb = createMockDb();
const getCurrentDb = () => dbContext.getStore() ?? fallbackDb;

vi.mock('@/lib/db', () => ({
  db: {
    notes: {
      toArray: () => getCurrentDb().notes.toArray(),
      get: (id: string) => getCurrentDb().notes.get(id),
      put: (note: Note) => getCurrentDb().notes.put(note),
      delete: (id: string) => getCurrentDb().notes.delete(id),
    },
    pairings: {
      toArray: () => getCurrentDb().pairings.toArray(),
      put: (p: Pairing) => getCurrentDb().pairings.put(p),
      delete: (id: string) => getCurrentDb().pairings.delete(id),
    },
  },
}));

// ─── Controllable Trystero In-Memory Network Mock ────────────────────────────

interface MockRoomRecord {
  deviceId: string;
  roomId: string;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  onMessage: ((data: unknown, context: { peerId: string }) => void) | null;
  left: boolean;
}

interface SentWireMessage {
  fromDevice: string;
  toPeerId?: string;
  roomId: string;
  data: unknown;
}

interface MockNetworkState {
  rooms: MockRoomRecord[];
  sentMessages: SentWireMessage[];
  joinRoomCalls: Array<{ roomId: string; peerId: string }>;
  leaveCalls: Array<{ roomId: string; peerId: string }>;
  holdMessages: boolean;
  heldMessages: Array<() => void>;
  dropMessagePredicate: ((msg: SentWireMessage) => boolean) | null;
  transformMessage: ((msg: SentWireMessage) => unknown) | null;
}

let currentDeviceId = 'device-A';
const network: MockNetworkState = {
  rooms: [],
  sentMessages: [],
  joinRoomCalls: [],
  leaveCalls: [],
  holdMessages: false,
  heldMessages: [],
  dropMessagePredicate: null,
  transformMessage: null,
};

function resetNetwork() {
  network.rooms = [];
  network.sentMessages = [];
  network.joinRoomCalls = [];
  network.leaveCalls = [];
  network.holdMessages = false;
  network.heldMessages = [];
  network.dropMessagePredicate = null;
  network.transformMessage = null;
  currentDeviceId = 'device-A';
}

function flushHeldMessages() {
  const queue = network.heldMessages.splice(0);
  for (const deliver of queue) {
    deliver();
  }
}

vi.mock('@trystero-p2p/torrent', () => ({
  joinRoom: (_config: unknown, roomId: string) => {
    const deviceId = currentDeviceId;
    network.joinRoomCalls.push({ roomId, peerId: deviceId });

    const record: MockRoomRecord = {
      deviceId,
      roomId,
      onPeerJoin: null,
      onPeerLeave: null,
      onMessage: null,
      left: false,
    };
    network.rooms.push(record);

    const roomApi = {
      get onPeerJoin() {
        return record.onPeerJoin;
      },
      set onPeerJoin(fn: ((peerId: string) => void) | null) {
        record.onPeerJoin = fn;
        if (fn && !record.left) {
          for (const other of network.rooms) {
            if (!other.left && other.roomId === roomId && other.deviceId !== deviceId) {
              fn(other.deviceId);
            }
          }
        }
      },
      get onPeerLeave() {
        return record.onPeerLeave;
      },
      set onPeerLeave(fn: ((peerId: string) => void) | null) {
        record.onPeerLeave = fn;
      },
      makeAction: () => ({
        send: async (data: unknown, options?: { target?: string | string[] }) => {
          const targets = options?.target
            ? Array.isArray(options.target)
              ? options.target
              : [options.target]
            : network.rooms
                .filter((r) => !r.left && r.roomId === roomId && r.deviceId !== deviceId)
                .map((r) => r.deviceId);

          for (const targetPeer of targets) {
            const wire: SentWireMessage = {
              fromDevice: deviceId,
              toPeerId: targetPeer,
              roomId,
              data,
            };
            network.sentMessages.push(wire);

            if (network.dropMessagePredicate?.(wire)) {
              continue;
            }

            const payload = network.transformMessage ? network.transformMessage(wire) : data;
            const targetRooms = network.rooms.filter(
              (r) => !r.left && r.roomId === roomId && r.deviceId === targetPeer
            );

            const deliver = () => {
              for (const tr of targetRooms) {
                tr.onMessage?.(structuredClone(payload), { peerId: deviceId });
              }
            };

            if (network.holdMessages) {
              network.heldMessages.push(deliver);
            } else {
              queueMicrotask(deliver);
            }
          }
        },
        get onMessage() {
          return record.onMessage;
        },
        set onMessage(fn: ((data: unknown, context: { peerId: string }) => void) | null) {
          record.onMessage = fn;
        },
      }),
      leave: async () => {
        if (record.left) return;
        record.left = true;
        network.leaveCalls.push({ roomId, peerId: deviceId });
        for (const other of network.rooms) {
          if (!other.left && other.roomId === roomId && other.deviceId !== deviceId) {
            other.onPeerLeave?.(deviceId);
          }
        }
      },
    };

    return roomApi;
  },
}));

let mockIceServersImpl: () => Promise<Array<{ urls: string }>> = async () => [
  { urls: 'stun:stun.l.google.com:19302' },
];

vi.mock('@/lib/turn', () => ({
  getIceServers: () => mockIceServersImpl(),
}));

import { SYNC_TIMEOUT_MS, useSync } from '@/hooks/useSync';

type HookApi = ReturnType<typeof useSync>;

interface MountedSync {
  api: () => HookApi;
  unmount: () => Promise<void>;
  onNotesChanged: ReturnType<typeof vi.fn>;
}

async function makeNote(id: string, title: string, content: string, updatedAt: string): Promise<Note> {
  const attachments = {};
  const contentHash = await computeContentHash(content, attachments);
  return {
    id,
    title,
    content,
    attachments,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    contentHash,
  };
}

async function mountSyncHook(deviceId: string, deviceDb: MockDeviceDb): Promise<MountedSync> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let latestApi!: HookApi;
  const onNotesChanged = vi.fn();

  function Harness() {
    // Switch activeDb & deviceId during hook actions via closure wrapper below
    latestApi = useSync(onNotesChanged);
    return null;
  }

  let root!: Root;
  await act(async () => {
    await dbContext.run(deviceDb, async () => {
      fallbackDb = deviceDb;
      currentDeviceId = deviceId;
      root = createRoot(container);
      root.render(<Harness />);
    });
  });

  // Allow mount async loadPairings -> joinRoom microtasks to settle
  await act(async () => {
    await dbContext.run(deviceDb, async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  // Notify peerJoin on pre-existing rooms in the opposite direction as well
  for (const r of network.rooms) {
    if (!r.left && r.deviceId !== deviceId) {
      const matchingLocal = network.rooms.filter(
        (lr) => !lr.left && lr.deviceId === deviceId && lr.roomId === r.roomId
      );
      if (matchingLocal.length > 0) {
        await act(async () => {
          r.onPeerJoin?.(deviceId);
        });
      }
    }
  }

  const wrapAction = <T extends (...args: never[]) => unknown>(fn: T): T => {
    return ((...args: Parameters<T>) => {
      return dbContext.run(deviceDb, () => {
        fallbackDb = deviceDb;
        currentDeviceId = deviceId;
        return fn(...args);
      });
    }) as T;
  };

  return {
    api: () => ({
      ...latestApi,
      addPairing: wrapAction(latestApi.addPairing),
      removePairing: wrapAction(latestApi.removePairing),
      triggerSync: wrapAction(latestApi.triggerSync),
    }),
    onNotesChanged,
    unmount: async () => {
      await act(async () => {
        await dbContext.run(deviceDb, async () => {
          fallbackDb = deviceDb;
          currentDeviceId = deviceId;
          root.unmount();
        });
      });
      container.remove();
    },
  };
}

function setupPerDeviceRouting(
  dbByDevice: Record<string, MockDeviceDb>
): void {
  for (const r of network.rooms) {
    const orig = r.onMessage;
    if (orig && !(orig as { __routed?: boolean }).__routed) {
      const wrapped = (data: unknown, ctx: { peerId: string }) => {
        const targetDb = dbByDevice[r.deviceId];
        dbContext.run(targetDb, () => {
          currentDeviceId = r.deviceId;
          orig(data, ctx);
        });
      };
      (wrapped as { __routed?: boolean }).__routed = true;
      r.onMessage = wrapped;
    }
  }
}

async function flushAsyncTicks(rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((res) => setTimeout(res, 0));
    });
  }
}

describe('useSync reliable protocol & room lifecycle', () => {
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(() => {
    resetNetwork();
    mockIceServersImpl = async () => [{ urls: 'stun:stun.l.google.com:19302' }];
    fallbackDb = createMockDb();
  });

  afterEach(async () => {
    vi.useRealTimers();
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
    vi.restoreAllMocks();
  });

  it('performs normal bidirectional sync with different notes and accurate counts', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const shared = await makeNote('shared-1', 'Shared', 'Identical content', '2026-01-01T00:00:00.000Z');
    const shared2 = await makeNote('shared-2', 'Shared 2', 'Identical 2', '2026-01-01T00:00:00.000Z');
    const noteA = await makeNote('only-a', 'From A', 'Content A', '2026-01-02T00:00:00.000Z');
    const noteB = await makeNote('only-b', 'From B', 'Content B', '2026-01-03T00:00:00.000Z');

    const dbA = createMockDb([shared, shared2, noteA], [pairing]);
    const dbB = createMockDb([shared, shared2, noteB], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);

    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    await act(async () => {
      void mountA.api().triggerSync();
    });
    await flushAsyncTicks();

    // Both sides now have all 4 notes
    expect(dbA.notesMap.has('only-b')).toBe(true);
    expect(dbB.notesMap.has('only-a')).toBe(true);
    expect(mountA.onNotesChanged).toHaveBeenCalledTimes(1);
    expect(mountB.onNotesChanged).toHaveBeenCalledTimes(1);

    // Accurate counts: 1 received, 1 sent, 2 unchanged
    expect(mountA.api().syncStatus).toEqual({
      stage: 'done',
      result: { received: 1, sent: 1, unchanged: 2 },
    });

    // Each transferred note was sent exactly once
    const noteMessages = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    );
    expect(noteMessages).toHaveLength(2);
  });

  it('prevents duplicate transfers when two devices initiate sync simultaneously', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA = await makeNote('note-a', 'Note A', 'A body', '2026-01-02T00:00:00.000Z');
    const noteB = await makeNote('note-b', 'Note B', 'B body', '2026-01-03T00:00:00.000Z');
    const identical = await makeNote('note-same', 'Same', 'Same body', '2026-01-01T00:00:00.000Z');

    const dbA = createMockDb([noteA, identical], [pairing]);
    const dbB = createMockDb([noteB, identical], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    // Hold messages so both devices send their initial manifests before either receives one
    network.holdMessages = true;
    await act(async () => {
      void mountA.api().triggerSync();
      void mountB.api().triggerSync();
    });
    await flushAsyncTicks(3);

    // Release manifests and subsequent rounds
    network.holdMessages = false;
    await act(async () => {
      flushHeldMessages();
    });
    await flushAsyncTicks();

    const noteMessages = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    );
    // Note A sent once (A->B), Note B sent once (B->A) — never 2x!
    expect(noteMessages).toHaveLength(2);
    expect(noteMessages.map((m) => (m.data as { noteId: string }).noteId).sort()).toEqual([
      'note-a',
      'note-b',
    ]);

    expect(mountA.api().syncStatus).toEqual({
      stage: 'done',
      result: { received: 1, sent: 1, unchanged: 1 },
    });
    expect(mountB.api().syncStatus).toEqual({
      stage: 'done',
      result: { received: 1, sent: 1, unchanged: 1 },
    });
  });

  it('ignores duplicate manifests and duplicate requests within a session', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA = await makeNote('n-1', 'N1', 'Body 1', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([noteA], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    cleanups.push(mountA.unmount);

    const roomOnA = network.rooms.find((r) => r.deviceId === 'device-A')!;
    await act(async () => {
      roomOnA.onPeerJoin?.('device-B');
    });

    // Inject duplicate manifests with same sessionId from device-B
    await act(async () => {
      roomOnA.onMessage?.(
        {
          type: 'manifest',
          sessionId: 'sess-dup-1',
          entries: [],
          wantsManifest: true,
        },
        { peerId: 'device-B' }
      );
      roomOnA.onMessage?.(
        {
          type: 'manifest',
          sessionId: 'sess-dup-1',
          entries: [],
          wantsManifest: true,
        },
        { peerId: 'device-B' }
      );
    });
    await flushAsyncTicks();

    const replyManifests = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'manifest'
    );
    expect(replyManifests).toHaveLength(1);
    const replySessionId = (replyManifests[0].data as { sessionId: string }).sessionId;

    // Inject duplicate requests (and duplicate noteIds in one request)
    await act(async () => {
      roomOnA.onMessage?.(
        { type: 'request', sessionId: replySessionId, noteIds: ['n-1', 'n-1'] },
        { peerId: 'device-B' }
      );
      roomOnA.onMessage?.(
        { type: 'request', sessionId: replySessionId, noteIds: ['n-1'] },
        { peerId: 'device-B' }
      );
    });
    await flushAsyncTicks();

    const sentNotes = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    );
    expect(sentNotes).toHaveLength(1);
  });

  it('sends acknowledgement only after validation & persistence, and waits for all pending transfers with live progress', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA1 = await makeNote('a-1', 'A1', 'Body A1', '2026-01-02T00:00:00.000Z');
    const noteA2 = await makeNote('a-2', 'A2', 'Body A2', '2026-01-02T00:00:00.000Z');
    const noteB1 = await makeNote('b-1', 'B1', 'Body B1', '2026-01-03T00:00:00.000Z');

    const dbA = createMockDb([noteA1, noteA2], [pairing]);
    const dbB = createMockDb([noteB1], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    // Intercept ACKs going to device-A so we can verify pending state & progress!
    const heldAcks: Array<() => void> = [];
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (wire.toPeerId === 'device-A' && msg.type === 'ack') {
        const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
        heldAcks.push(() => {
          dbContext.run(dbA, () => {
            currentDeviceId = 'device-A';
            roomA.onMessage?.(structuredClone(wire.data), { peerId: wire.fromDevice });
          });
        });
        return true;
      }
      return false;
    };

    await act(async () => {
      void mountA.api().triggerSync();
    });
    await flushAsyncTicks();

    // Device B received & persisted both A notes and sent 2 ACKs, which are held.
    expect(dbB.notesMap.has('a-1')).toBe(true);
    expect(dbB.notesMap.has('a-2')).toBe(true);
    expect(heldAcks).toHaveLength(2);

    // Device A received b-1, but MUST NOT be done because 2 outbound ACKs are still pending!
    expect(mountA.api().syncStatus).toEqual({
      stage: 'transferring',
      progress: 1,
      total: 3,
    });

    // Deliver first ACK -> progress advances to 2/3, still transferring
    await act(async () => {
      heldAcks.shift()!();
    });
    expect(mountA.api().syncStatus).toEqual({
      stage: 'transferring',
      progress: 2,
      total: 3,
    });

    // Deliver second ACK -> completes with exact counts
    await act(async () => {
      heldAcks.shift()!();
    });
    expect(mountA.api().syncStatus).toEqual({
      stage: 'done',
      result: { received: 1, sent: 2, unchanged: 0 },
    });
  });

  it('does not acknowledge failed or invalid notes as successful', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA = await makeNote('a-1', 'A1', 'Body A1', '2026-01-02T00:00:00.000Z');
    const noteB = await makeNote('b-bad', 'B Bad', 'Body B', '2026-01-03T00:00:00.000Z');

    const dbA = createMockDb([noteA], [pairing]);
    const dbB = createMockDb([noteB], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    // Cause DB persistence failure on B when saving a-1, AND corrupt note b-bad in transit to A
    dbB.failNextPutNoteId = 'a-1';
    network.transformMessage = (wire) => {
      const msg = wire.data as { type?: string; noteId?: string; sessionId?: string; transferId?: string };
      if (msg.type === 'note' && msg.noteId === 'b-bad') {
        return {
          type: 'note',
          sessionId: msg.sessionId,
          transferId: msg.transferId,
          noteId: msg.noteId,
          payload: [1, 2, 3, 4], // invalid gzip
        };
      }
      return wire.data;
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      void mountA.api().triggerSync();
    });
    await flushAsyncTicks();

    // Neither note was persisted
    expect(dbB.notesMap.has('a-1')).toBe(false);
    expect(dbA.notesMap.has('b-bad')).toBe(false);

    // B sent ok:false ACK for a-1; A sent ok:false ACK for b-bad
    const acks = network.sentMessages
      .filter((m) => (m.data as { type?: string }).type === 'ack')
      .map((m) => m.data as { noteId: string; ok: boolean });
    expect(acks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ noteId: 'a-1', ok: false }),
        expect.objectContaining({ noteId: 'b-bad', ok: false }),
      ])
    );

    // Sync status must report error, NEVER 'done'
    expect(mountA.api().syncStatus.stage).toBe('error');
    warnSpy.mockRestore();
  });

  it('times out abandoned sessions, cleans up pending ACKs, and ignores late ACKs', async () => {
    vi.useFakeTimers();

    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA = await makeNote('a-1', 'A1', 'Body A1', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([noteA], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    cleanups.push(mountA.unmount);

    const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
    await act(async () => {
      roomA.onPeerJoin?.('device-B');
    });

    // Drop all messages to simulate an unresponsive peer
    network.dropMessagePredicate = () => true;

    await act(async () => {
      void mountA.api().triggerSync();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mountA.api().syncStatus.stage).toBe('exchanging');

    // Advance past SYNC_TIMEOUT_MS
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 10);
    });

    expect(mountA.api().syncStatus).toEqual({
      stage: 'error',
      message: 'Sync timed out before all transfers completed.',
    });

    // Late ACK arrives after timeout — must be safely ignored without mutating status
    await act(async () => {
      roomA.onMessage?.(
        {
          type: 'ack',
          sessionId: 'stale-session',
          transferId: 'stale-transfer',
          noteId: 'a-1',
          ok: true,
        },
        { peerId: 'device-B' }
      );
    });
    expect(mountA.api().syncStatus.stage).toBe('error');
  });

  it('tracks peers independently per (pairingId, peerId) when multiple pairings share the same peerId', async () => {
    const p1: Pairing = { id: 'room11111111', label: 'Phone Work', pairedAt: '2026-01-01T00:00:00.000Z' };
    const p2: Pairing = { id: 'room22222222', label: 'Phone Personal', pairedAt: '2026-01-01T00:00:00.000Z' };
    const dbA = createMockDb([], [p1, p2]);

    const mountA = await mountSyncHook('device-A', dbA);
    cleanups.push(mountA.unmount);

    const room1 = network.rooms.find((r) => r.roomId === p1.id)!;
    const room2 = network.rooms.find((r) => r.roomId === p2.id)!;

    await act(async () => {
      room1.onPeerJoin?.('shared-peer-id');
      room2.onPeerJoin?.('shared-peer-id');
      // Duplicate join in room1 should be deduplicated
      room1.onPeerJoin?.('shared-peer-id');
    });

    expect(mountA.api().connectedPeers).toEqual([
      { pairingId: p1.id, peerId: 'shared-peer-id' },
      { pairingId: p2.id, peerId: 'shared-peer-id' },
    ]);

    // Leaving room1 must NOT remove shared-peer-id from room2
    await act(async () => {
      room1.onPeerLeave?.('shared-peer-id');
    });

    expect(mountA.api().connectedPeers).toEqual([
      { pairingId: p2.id, peerId: 'shared-peer-id' },
    ]);
  });

  it('deduplicates concurrent joinRoom calls for the same pairing', async () => {
    let resolveIce!: (servers: Array<{ urls: string }>) => void;
    mockIceServersImpl = () =>
      new Promise((res) => {
        resolveIce = res;
      });

    const dbA = createMockDb([], []);
    const mountA = await mountSyncHook('device-A', dbA);
    cleanups.push(mountA.unmount);

    let p1Promise!: Promise<Pairing>;
    let p2Promise!: Promise<Pairing>;

    await act(async () => {
      p1Promise = mountA.api().addPairing('roomconcurrent', 'Device 1');
      p2Promise = mountA.api().addPairing('roomconcurrent', 'Device 1');
    });

    await act(async () => {
      resolveIce([{ urls: 'stun:stun.l.google.com:19302' }]);
      await Promise.all([p1Promise, p2Promise]);
    });

    const joinsForRoom = network.joinRoomCalls.filter((c) => c.roomId === 'roomconcurrent');
    expect(joinsForRoom).toHaveLength(1);
  });

  it('handles room removal during pending initialization without leaving stale room active', async () => {
    let resolveIce!: (servers: Array<{ urls: string }>) => void;
    mockIceServersImpl = () =>
      new Promise((res) => {
        resolveIce = res;
      });

    const dbA = createMockDb([], []);
    const mountA = await mountSyncHook('device-A', dbA);
    cleanups.push(mountA.unmount);

    let addPromise!: Promise<Pairing>;
    await act(async () => {
      addPromise = mountA.api().addPairing('roomcancelled1', 'Temp');
      // Remove pairing BEFORE getIceServers resolves!
      await mountA.api().removePairing('roomcancelled1');
    });

    await act(async () => {
      resolveIce([{ urls: 'stun:stun.l.google.com:19302' }]);
      await addPromise;
    });

    // Must not have registered a live room or left any connected peer active
    expect(network.joinRoomCalls.filter((c) => c.roomId === 'roomcancelled1')).toHaveLength(0);
    expect(mountA.api().pairings).toHaveLength(0);
  });

  it('supports repeated sync sessions cleanly without leaking stale state', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const n1 = await makeNote('n-1', 'One', 'First', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([n1], [pairing]);
    const dbB = createMockDb([], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    // Session 1: A -> B (1 sent, 0 received, 0 unchanged)
    await act(async () => {
      void mountA.api().triggerSync();
    });
    await flushAsyncTicks();

    expect(mountA.api().syncStatus).toEqual({
      stage: 'done',
      result: { received: 0, sent: 1, unchanged: 0 },
    });

    // Add a note on B and a new note on A before Session 2
    const n2 = await makeNote('n-2', 'Two', 'Second on B', '2026-01-03T00:00:00.000Z');
    const n3 = await makeNote('n-3', 'Three', 'Third on A', '2026-01-04T00:00:00.000Z');
    await dbB.notes.put(n2);
    await dbA.notes.put(n3);

    // Session 2: must reflect only Session 2 deltas (1 received, 1 sent, 1 unchanged)
    await act(async () => {
      void mountA.api().triggerSync();
    });
    await flushAsyncTicks();

    expect(mountA.api().syncStatus).toEqual({
      stage: 'done',
      result: { received: 1, sent: 1, unchanged: 1 },
    });
    expect(dbA.notesMap.size).toBe(3);
    expect(dbB.notesMap.size).toBe(3);
  });

  it('ignores duplicate or mismatched ACKs and fails cleanly if peer disconnects mid-sync', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const n1 = await makeNote('n-1', 'One', 'First', '2026-01-02T00:00:00.000Z');
    const n2 = await makeNote('n-2', 'Two', 'Second', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([n1, n2], [pairing]);
    const dbB = createMockDb([], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    const heldAcks: Array<{ data: { sessionId: string; transferId: string; noteId: string; ok: boolean }; deliver: () => void }> = [];
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string; sessionId: string; transferId: string; noteId: string; ok: boolean };
      if (wire.toPeerId === 'device-A' && msg.type === 'ack') {
        const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
        heldAcks.push({
          data: msg,
          deliver: () => {
            dbContext.run(dbA, () => {
              currentDeviceId = 'device-A';
              roomA.onMessage?.(structuredClone(wire.data), { peerId: wire.fromDevice });
            });
          },
        });
        return true;
      }
      return false;
    };

    await act(async () => {
      void mountA.api().triggerSync();
    });
    await flushAsyncTicks();

    expect(heldAcks).toHaveLength(2);
    const firstAck = heldAcks[0];

    // Deliver first ACK twice + one with mismatched noteId
    await act(async () => {
      firstAck.deliver();
      firstAck.deliver();
      const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
      roomA.onMessage?.(
        {
          type: 'ack',
          sessionId: firstAck.data.sessionId,
          transferId: heldAcks[1].data.transferId,
          noteId: 'wrong-note-id',
          ok: true,
        },
        { peerId: 'device-B' }
      );
    });

    // Duplicate ACK must not count as 2/2; mismatched noteId must be ignored
    expect(mountA.api().syncStatus).toEqual({
      stage: 'transferring',
      progress: 1,
      total: 2,
    });

    // Now device-B disconnects while second ACK is still pending -> error, not hung
    const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
    await act(async () => {
      roomA.onPeerLeave?.('device-B');
    });

    expect(mountA.api().syncStatus.stage).toBe('error');
  });
});
