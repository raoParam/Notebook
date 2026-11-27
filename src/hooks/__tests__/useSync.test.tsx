// @vitest-environment jsdom
import { AsyncLocalStorage } from 'node:async_hooks';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletionDelivery, Note, Pairing, Tombstone } from '@/lib/db';
import { computeContentHash } from '@/lib/hash';
import { compressNote } from '@/lib/sync';
import {
  applyRemoteTombstone,
  deleteNoteWithTombstone,
  deletionDeliveryKey,
  persistIncomingNote,
} from '@/lib/tombstones';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── In-memory DB per device instance ────────────────────────────────────────

interface MockDeviceDb {
  notesMap: Map<string, Note>;
  pairingsMap: Map<string, Pairing>;
  tombstonesMap: Map<string, Tombstone>;
  deletionDeliveriesMap: Map<string, DeletionDelivery>;
  failNextPutNoteId: string | null;
  failNextPutTombstone: boolean;
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
  tombstones: {
    get: (noteId: string) => Promise<Tombstone | undefined>;
    put: (tombstone: Tombstone) => Promise<string>;
    delete: (noteId: string) => Promise<void>;
  };
  deletionDeliveries: {
    get: (id: string) => Promise<DeletionDelivery | undefined>;
    put: (delivery: DeletionDelivery) => Promise<string>;
    delete: (id: string) => Promise<void>;
    toArray: () => Promise<DeletionDelivery[]>;
    where: (field: 'deletionId' | 'noteId') => {
      equals: (value: string) => {
        toArray: () => Promise<DeletionDelivery[]>;
        delete: () => Promise<number>;
      };
    };
  };
  transaction: (...args: unknown[]) => Promise<unknown>;
}

function createMockDb(initialNotes: Note[] = [], initialPairings: Pairing[] = []): MockDeviceDb {
  const notesMap = new Map(initialNotes.map((n) => [n.id, n]));
  const pairingsMap = new Map(initialPairings.map((p) => [p.id, p]));
  const tombstonesMap = new Map<string, Tombstone>();
  const deletionDeliveriesMap = new Map<string, DeletionDelivery>();
  let transactionTail: Promise<void> = Promise.resolve();
  const mock: MockDeviceDb = {
    notesMap,
    pairingsMap,
    tombstonesMap,
    deletionDeliveriesMap,
    failNextPutNoteId: null,
    failNextPutTombstone: false,
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
    tombstones: {
      get: async (noteId: string) => tombstonesMap.get(noteId),
      put: async (tombstone: Tombstone) => {
        if (mock.failNextPutTombstone) {
          mock.failNextPutTombstone = false;
          throw new Error('Simulated IndexedDB tombstone write error');
        }
        for (const existing of tombstonesMap.values()) {
          if (
            existing.deletionId === tombstone.deletionId &&
            existing.noteId !== tombstone.noteId
          ) {
            throw new Error('Duplicate tombstone deletion ID');
          }
        }
        tombstonesMap.set(tombstone.noteId, tombstone);
        return tombstone.noteId;
      },
      delete: async (noteId: string) => {
        tombstonesMap.delete(noteId);
      },
    },
    deletionDeliveries: {
      get: async (id: string) => deletionDeliveriesMap.get(id),
      put: async (delivery: DeletionDelivery) => {
        deletionDeliveriesMap.set(delivery.id, delivery);
        return delivery.id;
      },
      delete: async (id: string) => {
        deletionDeliveriesMap.delete(id);
      },
      toArray: async () => Array.from(deletionDeliveriesMap.values()),
      where: (field: 'deletionId' | 'noteId') => ({
        equals: (value: string) => ({
          toArray: async () =>
            Array.from(deletionDeliveriesMap.values()).filter((d) => d[field] === value),
          delete: async () => {
            let count = 0;
            for (const [k, d] of deletionDeliveriesMap) {
              if (d[field] === value) {
                deletionDeliveriesMap.delete(k);
                count++;
              }
            }
            return count;
          },
        }),
      }),
    },
    transaction: async (...args: unknown[]) => {
      const callback = args[args.length - 1] as () => Promise<unknown>;
      const run = transactionTail.then(callback);
      transactionTail = run.then(() => undefined, () => undefined);
      return run;
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
    tombstones: {
      get: (noteId: string) => getCurrentDb().tombstones.get(noteId),
      put: (tombstone: Tombstone) => getCurrentDb().tombstones.put(tombstone),
      delete: (noteId: string) => getCurrentDb().tombstones.delete(noteId),
    },
    deletionDeliveries: {
      get: (id: string) => getCurrentDb().deletionDeliveries.get(id),
      put: (delivery: DeletionDelivery) => getCurrentDb().deletionDeliveries.put(delivery),
      delete: (id: string) => getCurrentDb().deletionDeliveries.delete(id),
      toArray: () => getCurrentDb().deletionDeliveries.toArray(),
      where: (field: 'deletionId' | 'noteId') => getCurrentDb().deletionDeliveries.where(field),
    },
    transaction: (...args: unknown[]) => getCurrentDb().transaction(...args),
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

import { AUTO_SYNC_DEBOUNCE_MS, SYNC_TIMEOUT_MS, useSync } from '@/hooks/useSync';

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
      setAutoSyncEnabled: wrapAction(latestApi.setAutoSyncEnabled),
      notifyLocalNoteChange: wrapAction(latestApi.notifyLocalNoteChange),
      propagateDeletion: wrapAction(latestApi.propagateDeletion),
      requestPeerManifest: wrapAction(latestApi.requestPeerManifest),
      syncAllWithPeer: wrapAction(latestApi.syncAllWithPeer),
      syncSelectedWithPeer: wrapAction(latestApi.syncSelectedWithPeer),
      denyManualSync: wrapAction(latestApi.denyManualSync),
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

    const origJoin = r.onPeerJoin;
    if (origJoin && !(origJoin as { __routed?: boolean }).__routed) {
      const wrappedJoin = (peerId: string) => {
        const targetDb = dbByDevice[r.deviceId];
        dbContext.run(targetDb, () => {
          currentDeviceId = r.deviceId;
          origJoin(peerId);
        });
      };
      (wrappedJoin as { __routed?: boolean }).__routed = true;
      r.onPeerJoin = wrappedJoin;
    }

    const origLeave = r.onPeerLeave;
    if (origLeave && !(origLeave as { __routed?: boolean }).__routed) {
      const wrappedLeave = (peerId: string) => {
        const targetDb = dbByDevice[r.deviceId];
        dbContext.run(targetDb, () => {
          currentDeviceId = r.deviceId;
          origLeave(peerId);
        });
      };
      (wrappedLeave as { __routed?: boolean }).__routed = true;
      r.onPeerLeave = wrappedLeave;
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
    window.localStorage.clear();
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

describe('useSync Batch 3: auto-sync, manual preview & selective sync', () => {
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(() => {
    window.localStorage.clear();
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

  it('defaults Auto-sync to OFF and persists local preference in localStorage', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const dbA = createMockDb([], [pairing]);
    const mountA = await mountSyncHook('device-A', dbA);
    cleanups.push(mountA.unmount);

    expect(mountA.api().autoSyncEnabled).toBe(false);
    expect(window.localStorage.getItem('nb-auto-sync')).toBeNull();

    await act(async () => {
      mountA.api().setAutoSyncEnabled(true);
    });
    expect(mountA.api().autoSyncEnabled).toBe(true);
    expect(window.localStorage.getItem('nb-auto-sync')).toBe('true');

    // Remounting reads localStorage preference
    await mountA.unmount();
    cleanups.pop();
    const mountA2 = await mountSyncHook('device-A', dbA);
    cleanups.push(mountA2.unmount);
    expect(mountA2.api().autoSyncEnabled).toBe(true);
  });

  it('runs auto-sync only when BOTH devices enable it, propagates local edits, and stops when either disables', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA = await makeNote('a1', 'Note A', 'Body A', '2026-01-02T00:00:00.000Z');
    const noteB = await makeNote('b1', 'Note B', 'Body B', '2026-01-02T00:00:00.000Z');

    const dbA = createMockDb([noteA], [pairing]);
    const dbB = createMockDb([noteB], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    // Only Device A enables Auto-sync -> must NOT sync yet
    await act(async () => {
      mountA.api().setAutoSyncEnabled(true);
    });
    await flushAsyncTicks();

    expect(dbA.notesMap.has('b1')).toBe(false);
    expect(dbB.notesMap.has('a1')).toBe(false);
    expect(mountB.api().peerAutoSync[`${pairing.id}\x00device-A`]).toBe(true);
    expect(mountA.api().peerAutoSync[`${pairing.id}\x00device-B`]).toBeFalsy();

    // Device B also enables Auto-sync -> mutually enabled, syncs union without duplicates
    await act(async () => {
      mountB.api().setAutoSyncEnabled(true);
    });
    await flushAsyncTicks(20);

    expect(dbA.notesMap.has('b1')).toBe(true);
    expect(dbB.notesMap.has('a1')).toBe(true);

    const noteMsgsBeforeEdit = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    ).length;

    // Local note edit on A -> debounced auto-sync sends only the new note, no infinite loop
    const noteA2 = await makeNote('a2', 'Note A2', 'Edited locally', '2026-01-03T00:00:00.000Z');
    dbA.notesMap.set('a2', noteA2);

    await act(async () => {
      mountA.api().notifyLocalNoteChange();
    });
    await new Promise((r) => setTimeout(r, AUTO_SYNC_DEBOUNCE_MS + 80));
    await flushAsyncTicks(20);

    expect(dbB.notesMap.has('a2')).toBe(true);
    const noteMsgsAfterEdit = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    ).length;
    expect(noteMsgsAfterEdit - noteMsgsBeforeEdit).toBe(1);

    // Settling further must not cause any extra loop transfers
    await flushAsyncTicks(15);
    const noteMsgsSettled = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    ).length;
    expect(noteMsgsSettled).toBe(noteMsgsAfterEdit);

    // Device B disables Auto-sync -> further local edits on A must NOT auto-sync
    await act(async () => {
      mountB.api().setAutoSyncEnabled(false);
    });
    await flushAsyncTicks();

    const noteA3 = await makeNote('a3', 'Note A3', 'After disable', '2026-01-04T00:00:00.000Z');
    dbA.notesMap.set('a3', noteA3);
    await act(async () => {
      mountA.api().notifyLocalNoteChange();
    });
    await new Promise((r) => setTimeout(r, AUTO_SYNC_DEBOUNCE_MS + 80));
    await flushAsyncTicks(15);

    expect(dbB.notesMap.has('a3')).toBe(false);
  });

  it('triggers auto-sync on peer reconnection and isolates multiple paired devices', async () => {
    const pairingAB: Pairing = { id: 'roomAB123456', label: 'Device B', pairedAt: '2026-01-01T00:00:00.000Z' };
    const pairingAC: Pairing = { id: 'roomAC123456', label: 'Device C', pairedAt: '2026-01-01T00:00:00.000Z' };

    const noteA = await makeNote('a1', 'From A', 'Content A', '2026-01-02T00:00:00.000Z');
    const noteB = await makeNote('b1', 'From B', 'Content B', '2026-01-02T00:00:00.000Z');
    const noteC = await makeNote('c1', 'From C', 'Content C', '2026-01-02T00:00:00.000Z');

    const dbA = createMockDb([noteA], [pairingAB, pairingAC]);
    const dbB = createMockDb([noteB], [pairingAB]);
    const dbC = createMockDb([noteC], [pairingAC]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    const mountC = await mountSyncHook('device-C', dbC);
    cleanups.push(mountA.unmount, mountB.unmount, mountC.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB, 'device-C': dbC });

    // A and B enable auto-sync; C stays OFF
    await act(async () => {
      mountA.api().setAutoSyncEnabled(true);
      mountB.api().setAutoSyncEnabled(true);
    });
    await flushAsyncTicks(20);

    // B synced with A, C did not
    expect(dbA.notesMap.has('b1')).toBe(true);
    expect(dbB.notesMap.has('a1')).toBe(true);
    expect(dbA.notesMap.has('c1')).toBe(false);
    expect(dbC.notesMap.has('a1')).toBe(false);

    // Simulate B going offline, creating note b2, then reconnecting
    const roomAForB = network.rooms.find((r) => r.deviceId === 'device-A' && r.roomId === pairingAB.id)!;
    const roomB = network.rooms.find((r) => r.deviceId === 'device-B' && r.roomId === pairingAB.id)!;

    await act(async () => {
      roomAForB.onPeerLeave?.('device-B');
      roomB.onPeerLeave?.('device-A');
    });

    const noteB2 = await makeNote('b2', 'Offline B Note', 'Created offline', '2026-01-05T00:00:00.000Z');
    dbB.notesMap.set('b2', noteB2);

    await act(async () => {
      roomAForB.onPeerJoin?.('device-B');
      roomB.onPeerJoin?.('device-A');
    });
    await flushAsyncTicks(20);

    expect(dbA.notesMap.has('b2')).toBe(true);
    expect(dbC.notesMap.has('b2')).toBe(false);
  });

  it('manual sync requests fresh preview without transferring notes and respects Deny sync', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Laptop', pairedAt: '2026-01-01T00:00:00.000Z' };
    const localIdentical = await makeNote('same', 'Same Note', 'Identical body', '2026-01-02T00:00:00.000Z');
    const localOlder = await makeNote('upd', 'Old Local', 'Old body', '2026-01-01T00:00:00.000Z');
    const localNewer = await makeNote('loc', 'Newer Local', 'Keep local', '2026-01-10T00:00:00.000Z');

    const peerIdentical = { ...localIdentical };
    const peerNewer = await makeNote('upd', 'Updated Peer', 'Updated body', '2026-01-05T00:00:00.000Z');
    const peerOlder = await makeNote('loc', 'Older Peer', 'Stale peer body', '2026-01-01T00:00:00.000Z');
    const peerNew = await makeNote('pnew', 'Brand New Peer', 'New body', '2026-01-06T00:00:00.000Z');

    const dbA = createMockDb([localIdentical, localOlder, localNewer], [pairing]);
    const dbB = createMockDb([peerIdentical, peerNewer, peerOlder, peerNew], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    await act(async () => {
      void mountA.api().requestPeerManifest(pairing.id);
    });
    await flushAsyncTicks(15);

    const preview = mountA.api().manualPreview;
    expect(preview.stage).toBe('ready');
    if (preview.stage === 'ready') {
      const relations = new Map(preview.notes.map((e) => [e.noteId, e.relation]));
      expect(relations.get('pnew')).toBe('new');
      expect(relations.get('upd')).toBe('updated');
      expect(relations.get('same')).toBe('identical');
      expect(relations.get('loc')).toBe('local-newer');
    }

    // No note payloads should have been transferred during manifest preview
    expect(dbA.notesMap.has('pnew')).toBe(false);
    expect(network.sentMessages.some((m) => (m.data as { type?: string }).type === 'note')).toBe(false);

    // Deny closes preview without transferring anything
    await act(async () => {
      mountA.api().denyManualSync();
    });
    expect(mountA.api().manualPreview.stage).toBe('idle');
    expect(dbA.notesMap.has('pnew')).toBe(false);
    expect(dbB.notesMap.get('loc')?.content).toBe('Stale peer body');
  });

  it('syncSelectedWithPeer transfers only selected notes, rejects unselected pushes, and preserves LWW', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Laptop', pairedAt: '2026-01-01T00:00:00.000Z' };
    const localNewer = await makeNote('loc', 'Local Newer', 'Keep local', '2026-01-10T00:00:00.000Z');
    const localOnly = await makeNote('only-local', 'Only Local', 'Local only body', '2026-01-03T00:00:00.000Z');

    const peerOlder = await makeNote('loc', 'Peer Stale', 'Should not overwrite', '2026-01-01T00:00:00.000Z');
    const peerWanted = await makeNote('wanted', 'Wanted Peer', 'Wanted content', '2026-01-05T00:00:00.000Z');
    const peerSkipped = await makeNote('skipped', 'Skipped Peer', 'Skipped content', '2026-01-05T00:00:00.000Z');

    const dbA = createMockDb([localNewer, localOnly], [pairing]);
    const dbB = createMockDb([peerOlder, peerWanted, peerSkipped], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    // Empty selection is a no-op and transfers nothing
    const sentBeforeEmpty = network.sentMessages.length;
    await act(async () => {
      await mountA.api().syncSelectedWithPeer(pairing.id, []);
    });
    await flushAsyncTicks();
    expect(dbA.notesMap.has('wanted')).toBe(false);
    expect(network.sentMessages.length).toBe(sentBeforeEmpty);
    expect(mountA.api().syncStatus).toEqual({ stage: 'idle' });

    // Request preview first
    await act(async () => {
      void mountA.api().requestPeerManifest(pairing.id);
    });
    await flushAsyncTicks(15);

    const reqMessagesBefore = network.sentMessages.length;
    const previewReady = mountA.api().manualPreview;
    expect(previewReady.stage).toBe('ready');

    // Hold note messages briefly to verify mid-session unsolicited push rejection
    const heldWantedNotes: Array<() => void> = [];
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (wire.toPeerId === 'device-A' && msg.type === 'note') {
        const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
        heldWantedNotes.push(() => {
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
      void mountA.api().syncSelectedWithPeer(pairing.id, ['wanted', 'loc']);
    });
    await flushAsyncTicks(15);

    // Verify request only contained transferable selected ID ('wanted', skipping local-newer 'loc')
    const reqMsg = network.sentMessages
      .slice(reqMessagesBefore)
      .find((m) => (m.data as { type?: string }).type === 'request')
      ?.data as { noteIds: string[]; sessionId: string } | undefined;
    expect(reqMsg?.noteIds).toEqual(['wanted']);

    // While selective session is active, inject unsolicited note ('unsolicited') -> must be rejected
    const dbCNote = await makeNote('unsolicited', 'Malicious Push', 'Sneaky', '2026-01-09T00:00:00.000Z');
    const compressed = await compressNote(dbCNote);
    const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA.onMessage?.(
          {
            type: 'note',
            sessionId: reqMsg!.sessionId,
            transferId: 'unsolicited-xfer',
            payload: Array.from(compressed),
          },
          { peerId: 'device-B' }
        );
      });
    });
    await flushAsyncTicks();
    expect(dbA.notesMap.has('unsolicited')).toBe(false);

    // Deliver the legitimate 'wanted' note and finish
    network.dropMessagePredicate = null;
    await act(async () => {
      for (const deliver of heldWantedNotes) deliver();
    });
    await flushAsyncTicks(20);

    // Only 'wanted' is pulled; 'skipped' was not selected; 'loc' LWW preserved local newer
    expect(dbA.notesMap.get('wanted')?.content).toBe('Wanted content');
    expect(dbA.notesMap.has('skipped')).toBe(false);
    expect(dbA.notesMap.get('loc')?.content).toBe('Keep local');

    // Device B did NOT proactively pull 'only-local' during selective pull
    expect(dbB.notesMap.has('only-local')).toBe(false);
  });

  it('syncAllWithPeer transfers full union and preview transitions to disconnected when peer leaves', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Laptop', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA = await makeNote('a1', 'Note A', 'Body A', '2026-01-02T00:00:00.000Z');
    const noteB = await makeNote('b1', 'Note B', 'Body B', '2026-01-03T00:00:00.000Z');

    const dbA = createMockDb([noteA], [pairing]);
    const dbB = createMockDb([noteB], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    await act(async () => {
      void mountA.api().requestPeerManifest(pairing.id);
    });
    await flushAsyncTicks(15);
    expect(mountA.api().manualPreview.stage).toBe('ready');

    // Sync all transfers union
    await act(async () => {
      void mountA.api().syncAllWithPeer(pairing.id);
    });
    await flushAsyncTicks(20);
    expect(dbA.notesMap.has('b1')).toBe(true);
    expect(dbB.notesMap.has('a1')).toBe(true);

    // Open preview again, then peer disconnects -> stage becomes disconnected
    await act(async () => {
      void mountA.api().requestPeerManifest(pairing.id);
    });
    await flushAsyncTicks(15);
    const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
    await act(async () => {
      roomA.onPeerLeave?.('device-B');
    });
    expect(mountA.api().manualPreview.stage).toBe('disconnected');
  });
});

describe('useSync Batch 3.1: auto-sync race & incoming transfer authorization', () => {
  const cleanups: Array<() => Promise<void>> = [];

  async function flushAsyncWithFakeTimers(rounds = 15) {
    for (let i = 0; i < rounds; i++) {
      await act(async () => {
        await new Promise<void>((res) => setImmediate(res));
      });
    }
  }

  function enableSyncFakeTimers() {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
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

  it('transfers local edit made while auto-sync is active and debounce timer fires during the run', async () => {
    enableSyncFakeTimers();

    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA1 = await makeNote('a1', 'A1', 'Initial A1', '2026-01-02T00:00:00.000Z');
    const noteB1 = await makeNote('b1', 'B1', 'Initial B1', '2026-01-02T00:00:00.000Z');

    const dbA = createMockDb([noteA1], [pairing]);
    const dbB = createMockDb([noteB1], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    // Initial mutually enabled handshake
    await act(async () => {
      mountA.api().setAutoSyncEnabled(true);
      mountB.api().setAutoSyncEnabled(true);
    });
    await flushAsyncWithFakeTimers();
    expect(dbA.notesMap.has('b1')).toBe(true);
    expect(dbB.notesMap.has('a1')).toBe(true);

    // Trigger Run 1 via edit e1, but hold ACKs returning to A so Run 1 stays active
    const heldAcksToA: Array<() => void> = [];
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (wire.toPeerId === 'device-A' && msg.type === 'ack') {
        const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
        heldAcksToA.push(() => {
          dbContext.run(dbA, () => {
            currentDeviceId = 'device-A';
            roomA.onMessage?.(structuredClone(wire.data), { peerId: wire.fromDevice });
          });
        });
        return true;
      }
      return false;
    };

    const noteA2 = await makeNote('a2', 'A2', 'Run 1 note', '2026-01-03T00:00:00.000Z');
    dbA.notesMap.set('a2', noteA2);
    await act(async () => {
      mountA.api().notifyLocalNoteChange();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_DEBOUNCE_MS + 10);
    });
    await flushAsyncWithFakeTimers();

    // Run 1 is active waiting for ACK of a2
    expect(heldAcksToA).toHaveLength(1);
    expect(dbB.notesMap.has('a2')).toBe(true);

    // Edit a3 WHILE Run 1 is active, and advance past debounce so debounce fires during active Run 1
    const noteA3 = await makeNote('a3', 'A3', 'Edited while active', '2026-01-04T00:00:00.000Z');
    dbA.notesMap.set('a3', noteA3);
    await act(async () => {
      mountA.api().notifyLocalNoteChange();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_DEBOUNCE_MS + 10);
    });
    await flushAsyncWithFakeTimers();
    expect(dbB.notesMap.has('a3')).toBe(false);

    // Release Run 1 ACK -> Run 1 settles and MUST trigger follow-up Run 2 transferring a3
    network.dropMessagePredicate = null;
    await act(async () => {
      heldAcksToA.shift()!();
    });
    await flushAsyncWithFakeTimers(20);

    expect(dbB.notesMap.get('a3')?.content).toBe('Edited while active');

    // Verify no infinite loop or repeated transfers after settling
    const notesSentCount = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWithFakeTimers();
    // Calling notifyLocalNoteChange without actual changes must not trigger extra transfers
    await act(async () => {
      mountA.api().notifyLocalNoteChange();
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_DEBOUNCE_MS + 100);
    });
    await flushAsyncWithFakeTimers();

    const notesSentAfterSettle = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    ).length;
    expect(notesSentAfterSettle).toBe(notesSentCount);
  });

  it('transfers local edit made while auto-sync is active even when debounce timer is still pending at run completion', async () => {
    enableSyncFakeTimers();

    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA1 = await makeNote('a1', 'A1', 'Initial A1', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([noteA1], [pairing]);
    const dbB = createMockDb([], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    await act(async () => {
      mountA.api().setAutoSyncEnabled(true);
      mountB.api().setAutoSyncEnabled(true);
    });
    await flushAsyncWithFakeTimers();

    // Hold ACK for Run 1
    const heldAcksToA: Array<() => void> = [];
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (wire.toPeerId === 'device-A' && msg.type === 'ack') {
        const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
        heldAcksToA.push(() => {
          dbContext.run(dbA, () => {
            currentDeviceId = 'device-A';
            roomA.onMessage?.(structuredClone(wire.data), { peerId: wire.fromDevice });
          });
        });
        return true;
      }
      return false;
    };

    const noteA2 = await makeNote('a2', 'A2', 'Run 1 body', '2026-01-03T00:00:00.000Z');
    dbA.notesMap.set('a2', noteA2);
    await act(async () => {
      mountA.api().notifyLocalNoteChange();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_DEBOUNCE_MS + 10);
    });
    await flushAsyncWithFakeTimers();
    expect(heldAcksToA).toHaveLength(1);

    // Make edit a3 while Run 1 is active, and DO NOT let debounce expire before Run 1 finishes
    const noteA3 = await makeNote('a3', 'A3', 'Edited before debounce', '2026-01-04T00:00:00.000Z');
    dbA.notesMap.set('a3', noteA3);
    await act(async () => {
      mountA.api().notifyLocalNoteChange();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Complete Run 1 while debounce timer for a3 is still pending
    network.dropMessagePredicate = null;
    await act(async () => {
      heldAcksToA.shift()!();
    });
    await flushAsyncWithFakeTimers();
    expect(dbB.notesMap.has('a3')).toBe(false);

    // Advance past debounce -> follow-up run MUST NOT skip a3 and must transfer it
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SYNC_DEBOUNCE_MS + 50);
    });
    await flushAsyncWithFakeTimers(20);
    expect(dbB.notesMap.get('a3')?.content).toBe('Edited before debounce');

    // No repeated transfers or infinite loop
    const noteCountBefore = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    ).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await flushAsyncWithFakeTimers();
    const noteCountAfter = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'note'
    ).length;
    expect(noteCountAfter).toBe(noteCountBefore);
  });

  it('rejects unsolicited notes, unknown sessions, and wrong-peer/wrong-pairing sessions before DB write', async () => {
    const pairing1: Pairing = { id: 'room11111111', label: 'Pair 1', pairedAt: '2026-01-01T00:00:00.000Z' };
    const pairing2: Pairing = { id: 'room22222222', label: 'Pair 2', pairedAt: '2026-01-01T00:00:00.000Z' };
    const peerNote = await makeNote('legit-1', 'Legit', 'Legit content', '2026-01-02T00:00:00.000Z');

    const dbA = createMockDb([], [pairing1, pairing2]);
    const dbB = createMockDb([peerNote], [pairing1]);
    const dbC = createMockDb([], [pairing2]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    const mountC = await mountSyncHook('device-C', dbC);
    cleanups.push(mountA.unmount, mountB.unmount, mountC.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB, 'device-C': dbC });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const roomA1 = network.rooms.find((r) => r.deviceId === 'device-A' && r.roomId === pairing1.id)!;
    const roomA2 = network.rooms.find((r) => r.deviceId === 'device-A' && r.roomId === pairing2.id)!;

    // 1. Unsolicited note with no active session & unknown sessionId
    const rogue1 = await makeNote('rogue-1', 'Rogue 1', 'Sneaky', '2026-01-05T00:00:00.000Z');
    const compressedRogue1 = await compressNote(rogue1);
    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA1.onMessage?.(
          {
            type: 'note',
            sessionId: 'unknown-session-123',
            transferId: 'tx-rogue-1',
            noteId: 'rogue-1',
            payload: Array.from(compressedRogue1),
          },
          { peerId: 'device-B' }
        );
      });
    });
    await flushAsyncTicks();
    expect(dbA.notesMap.has('rogue-1')).toBe(false);

    // 2. Start an active manual selective sync session on pairing1 with device-B for 'legit-1',
    // holding the legitimate note so the session stays active.
    await act(async () => {
      void mountA.api().requestPeerManifest(pairing1.id);
    });
    await flushAsyncTicks(15);
    const preview = mountA.api().manualPreview;
    expect(preview.stage).toBe('ready');
    const activeSessionId = preview.stage === 'ready' ? preview.peerManifestSessionId : '';

    const heldLegit: Array<() => void> = [];
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (wire.toPeerId === 'device-A' && msg.type === 'note') {
        heldLegit.push(() => {
          dbContext.run(dbA, () => {
            currentDeviceId = 'device-A';
            roomA1.onMessage?.(structuredClone(wire.data), { peerId: wire.fromDevice });
          });
        });
        return true;
      }
      return false;
    };

    await act(async () => {
      void mountA.api().syncSelectedWithPeer(pairing1.id, ['legit-1']);
    });
    await flushAsyncTicks(15);

    // Wrong peerId in pairing1 trying to inject legit-1 using activeSessionId
    const forgedNote = await makeNote('legit-1', 'Forged', 'Evil overwrite', '2026-01-09T00:00:00.000Z');
    const compressedForged = await compressNote(forgedNote);
    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA1.onMessage?.(
          {
            type: 'note',
            sessionId: activeSessionId,
            transferId: 'tx-wrong-peer',
            noteId: 'legit-1',
            payload: Array.from(compressedForged),
          },
          { peerId: 'evil-peer' }
        );
      });
    });
    await flushAsyncTicks();
    expect(dbA.notesMap.has('legit-1')).toBe(false);

    // Wrong pairing (pairing2) trying to inject legit-1 using activeSessionId (even from device-C or spoofed device-B)
    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA2.onMessage?.(
          {
            type: 'note',
            sessionId: activeSessionId,
            transferId: 'tx-wrong-pairing',
            noteId: 'legit-1',
            payload: Array.from(compressedForged),
          },
          { peerId: 'device-B' }
        );
      });
    });
    await flushAsyncTicks();
    expect(dbA.notesMap.has('legit-1')).toBe(false);

    // Deliver the legitimate note -> accepted
    network.dropMessagePredicate = null;
    await act(async () => {
      for (const deliver of heldLegit) deliver();
    });
    await flushAsyncTicks(15);
    expect(dbA.notesMap.get('legit-1')?.content).toBe('Legit content');

    // Completed session: late note with a new transferId on the same sessionId must be rejected
    const lateNote = await makeNote('legit-1', 'Late', 'Late overwrite', '2026-01-10T00:00:00.000Z');
    const compressedLate = await compressNote(lateNote);
    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA1.onMessage?.(
          {
            type: 'note',
            sessionId: activeSessionId,
            transferId: 'tx-late-after-complete',
            noteId: 'legit-1',
            payload: Array.from(compressedLate),
          },
          { peerId: 'device-B' }
        );
      });
    });
    await flushAsyncTicks();
    expect(dbA.notesMap.get('legit-1')?.content).toBe('Legit content');

    // Duplicate-transfer ACK cache is preserved: re-delivering same (sessionId, transferId) re-sends cached ACK without modifying DB
    const legitWire = network.sentMessages.find(
      (m) => (m.data as { type?: string; noteId?: string }).type === 'note' &&
        (m.data as { noteId?: string }).noteId === 'legit-1'
    )!.data as { sessionId: string; transferId: string; noteId: string; payload: number[] };
    const acksBeforeDup = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'ack'
    ).length;

    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA1.onMessage?.(structuredClone(legitWire), { peerId: 'device-B' });
      });
    });
    await flushAsyncTicks();
    const acksAfterDup = network.sentMessages.filter(
      (m) => (m.data as { type?: string }).type === 'ack'
    ).length;
    expect(acksAfterDup).toBe(acksBeforeDup + 1);
    expect(dbA.notesMap.get('legit-1')?.content).toBe('Legit content');

    warnSpy.mockRestore();
  });

  it('rejects notes from expired or cancelled manual sessions', async () => {
    vi.useFakeTimers();

    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteB = await makeNote('b1', 'Note B', 'B body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([], [pairing]);
    const dbB = createMockDb([noteB], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Hold note messages to device-A
    const heldNotes: Array<() => void> = [];
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (wire.toPeerId === 'device-A' && msg.type === 'note') {
        const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
        heldNotes.push(() => {
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(heldNotes).toHaveLength(1);

    // Expire the session
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 10);
    });
    expect(mountA.api().syncStatus.stage).toBe('error');

    // Late note arrives after expiry -> must NOT write to IndexedDB
    network.dropMessagePredicate = null;
    await act(async () => {
      heldNotes.shift()!();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(dbA.notesMap.has('b1')).toBe(false);

    warnSpy.mockRestore();
  });

  it('passive responder accepts legitimately requested notes and rejects unrequested or expired ones', async () => {
    enableSyncFakeTimers();

    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteReq = await makeNote('req-1', 'Requested', 'Requested body', '2026-01-02T00:00:00.000Z');
    const noteExtra = await makeNote('extra-1', 'Unrequested', 'Unrequested body', '2026-01-02T00:00:00.000Z');
    const dbB = createMockDb([], [pairing]);

    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountB.unmount);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const roomB = network.rooms.find((r) => r.deviceId === 'device-B')!;
    await act(async () => {
      roomB.onPeerJoin?.('device-A');
    });

    // Device A initiates sync with Device B as passive responder, advertising only 'req-1'
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'manifest',
            sessionId: 'passive-sess-1',
            entries: [
              {
                noteId: noteReq.id,
                contentHash: noteReq.contentHash,
                updatedAt: noteReq.updatedAt,
                title: noteReq.title,
              },
            ],
            wantsManifest: false,
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncWithFakeTimers();

    // Device B should have requested 'req-1'
    const reqSent = network.sentMessages.find(
      (m) => (m.data as { type?: string; sessionId?: string }).type === 'request' &&
        (m.data as { sessionId?: string }).sessionId === 'passive-sess-1'
    );
    expect((reqSent?.data as { noteIds: string[] })?.noteIds).toEqual(['req-1']);

    // Unrequested 'extra-1' pushed on passive-sess-1 -> MUST be rejected
    const compressedExtra = await compressNote(noteExtra);
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'note',
            sessionId: 'passive-sess-1',
            transferId: 'tx-extra',
            noteId: 'extra-1',
            payload: Array.from(compressedExtra),
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncWithFakeTimers();
    expect(dbB.notesMap.has('extra-1')).toBe(false);

    // Legitimately requested 'req-1' arrives -> MUST be accepted
    const compressedReq = await compressNote(noteReq);
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'note',
            sessionId: 'passive-sess-1',
            transferId: 'tx-req-1',
            noteId: 'req-1',
            payload: Array.from(compressedReq),
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncWithFakeTimers();
    expect(dbB.notesMap.get('req-1')?.content).toBe('Requested body');

    // Session is now completed -> late rewrite on same sessionId with new transferId must be rejected
    const noteReqUpdated = await makeNote('req-1', 'Late', 'Late overwrite', '2026-01-05T00:00:00.000Z');
    const compressedReqUpdated = await compressNote(noteReqUpdated);
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'note',
            sessionId: 'passive-sess-1',
            transferId: 'tx-req-1-late',
            noteId: 'req-1',
            payload: Array.from(compressedReqUpdated),
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncWithFakeTimers();
    expect(dbB.notesMap.get('req-1')?.content).toBe('Requested body');

    // Expired passive responder session -> late note must be rejected
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'manifest',
            sessionId: 'passive-sess-expiring',
            entries: [
              {
                noteId: noteExtra.id,
                contentHash: noteExtra.contentHash,
                updatedAt: noteExtra.updatedAt,
                title: noteExtra.title,
              },
            ],
            wantsManifest: false,
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncWithFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 10);
    });
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'note',
            sessionId: 'passive-sess-expiring',
            transferId: 'tx-expired-passive',
            noteId: 'extra-1',
            payload: Array.from(compressedExtra),
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncWithFakeTimers();
    expect(dbB.notesMap.has('extra-1')).toBe(false);

    warnSpy.mockRestore();
  });

  it('disabling auto-sync cancels authorization for outstanding auto-sync passive responder transfers', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA = await makeNote('auto-resp-1', 'Auto Resp', 'Auto body', '2026-01-02T00:00:00.000Z');
    const dbB = createMockDb([], [pairing]);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountB.unmount);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const roomB = network.rooms.find((r) => r.deviceId === 'device-B')!;

    await act(async () => {
      roomB.onPeerJoin?.('device-A');
      mountB.api().setAutoSyncEnabled(true);
    });
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.({ type: 'auto-sync-pref', enabled: true }, { peerId: 'device-A' });
      });
    });
    await flushAsyncTicks();

    // Simulate peer A initiating auto-sync manifest to B as passive responder
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'manifest',
            sessionId: 'auto-passive-sess',
            entries: [
              {
                noteId: noteA.id,
                contentHash: noteA.contentHash,
                updatedAt: noteA.updatedAt,
                title: noteA.title,
              },
            ],
            wantsManifest: false,
            autoSync: true,
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncTicks();

    // Disable auto-sync on B before A delivers the note
    await act(async () => {
      mountB.api().setAutoSyncEnabled(false);
    });
    await flushAsyncTicks();

    const compressed = await compressNote(noteA);
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'note',
            sessionId: 'auto-passive-sess',
            transferId: 'tx-auto-passive-late',
            noteId: noteA.id,
            payload: Array.from(compressed),
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncTicks();

    expect(dbB.notesMap.has('auto-resp-1')).toBe(false);
    warnSpy.mockRestore();
  });

  it('disabling auto-sync cancels authorization for outstanding auto-sync transfers (initiator and responder)', async () => {
    const pairing: Pairing = { id: 'room12345678', label: 'Pair', pairedAt: '2026-01-01T00:00:00.000Z' };
    const noteA = await makeNote('a1', 'Note A', 'Body A', '2026-01-02T00:00:00.000Z');
    const noteB = await makeNote('b1', 'Note B', 'Body B', '2026-01-02T00:00:00.000Z');

    const dbA = createMockDb([noteA], [pairing]);
    const dbB = createMockDb([noteB], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Hold all note transfers in both directions during initial auto-sync handshake
    const heldNotes: Array<{ to: string; deliver: () => void }> = [];
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (msg.type === 'note' && wire.toPeerId) {
        const targetRoom = network.rooms.find((r) => r.deviceId === wire.toPeerId)!;
        const targetDb = wire.toPeerId === 'device-A' ? dbA : dbB;
        heldNotes.push({
          to: wire.toPeerId,
          deliver: () => {
            dbContext.run(targetDb, () => {
              currentDeviceId = wire.toPeerId!;
              targetRoom.onMessage?.(structuredClone(wire.data), { peerId: wire.fromDevice });
            });
          },
        });
        return true;
      }
      return false;
    };

    await act(async () => {
      mountA.api().setAutoSyncEnabled(true);
      mountB.api().setAutoSyncEnabled(true);
    });
    await flushAsyncTicks(20);
    expect(heldNotes.length).toBeGreaterThanOrEqual(2);

    // Disable auto-sync on Device A while note transfers are still in flight
    await act(async () => {
      mountA.api().setAutoSyncEnabled(false);
    });
    await flushAsyncTicks();

    // Deliver all held auto-sync note messages -> both A (disabled) and B (peer disabled) must reject late transfers
    network.dropMessagePredicate = null;
    await act(async () => {
      for (const item of heldNotes) item.deliver();
    });
    await flushAsyncTicks(15);

    expect(dbA.notesMap.has('b1')).toBe(false);
    expect(dbB.notesMap.has('a1')).toBe(false);

    // Manual sync must STILL work cleanly when auto-sync is disabled
    await act(async () => {
      void mountA.api().triggerSync();
    });
    await flushAsyncTicks(20);
    expect(dbA.notesMap.has('b1')).toBe(true);
    expect(dbB.notesMap.has('a1')).toBe(true);

    warnSpy.mockRestore();
  });
});

describe('useSync deletion tombstones', () => {
  const cleanups: Array<() => Promise<void>> = [];
  const pairing: Pairing = {
    id: 'room-deletion-01',
    label: 'Paired device',
    pairedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    window.localStorage.clear();
    resetNetwork();
    mockIceServersImpl = async () => [{ urls: 'stun:stun.l.google.com:19302' }];
    fallbackDb = createMockDb();
  });

  afterEach(async () => {
    vi.useRealTimers();
    while (cleanups.length > 0) {
      await cleanups.pop()!();
    }
    vi.restoreAllMocks();
  });

  it('deletes locally and atomically persists a local tombstone', async () => {
    const note = await makeNote('delete-local', 'Local', 'Body', '2026-01-02T00:00:00.000Z');
    const deviceDb = createMockDb([note]);
    const tombstone = await dbContext.run(deviceDb, () =>
      deleteNoteWithTombstone(note.id)
    );

    expect(tombstone).toMatchObject({
      noteId: note.id,
      scope: 'local',
      deliveryFailures: 0,
    });
    expect(tombstone?.deletionId).toBeTruthy();
    expect(Date.parse(tombstone!.deletedAt)).not.toBeNaN();
    expect(deviceDb.notesMap.has(note.id)).toBe(false);
    expect(deviceDb.tombstonesMap.get(note.id)).toEqual(tombstone);
  });

  it('propagates deletions to connected paired peers and leaves offline copies untouched', async () => {
    const note = await makeNote('delete-online', 'Online', 'Body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([note], [pairing]);
    const dbB = createMockDb([note], [pairing]);
    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    const tombstone = await dbContext.run(dbA, () => deleteNoteWithTombstone(note.id));
    await act(async () => {
      await dbContext.run(dbA, () => mountA.api().propagateDeletion(tombstone!));
    });
    await flushAsyncTicks();

    expect(dbA.tombstonesMap.get(note.id)?.scope).toBe('propagated');
    expect(dbB.tombstonesMap.get(note.id)?.scope).toBe('propagated');
    expect(dbB.notesMap.has(note.id)).toBe(false);
    expect(
      dbA.deletionDeliveriesMap.get(deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-B'))?.status
    ).toBe('accepted');
    expect(network.sentMessages.some((message) =>
      (message.data as { type?: string }).type === 'tombstone'
    )).toBe(true);

    const offlinePairing = { ...pairing, id: 'room-offline-01' };
    const offlineSenderDb = createMockDb([note], [offlinePairing]);
    const offlinePeerDb = createMockDb([note], [offlinePairing]);
    const offlineSender = await mountSyncHook('device-offline-sender', offlineSenderDb);
    cleanups.push(offlineSender.unmount);
    const offlineTombstone = await dbContext.run(offlineSenderDb, () =>
      deleteNoteWithTombstone(note.id)
    );
    await act(async () => {
      await dbContext.run(offlineSenderDb, () =>
        offlineSender.api().propagateDeletion(offlineTombstone!)
      );
    });
    expect(offlineSenderDb.notesMap.has(note.id)).toBe(false);
    expect(offlinePeerDb.notesMap.has(note.id)).toBe(true);
    expect(dbB.notesMap.has(note.id)).toBe(false);
    expect(network.sentMessages.filter((message) =>
      (message.data as { type?: string }).type === 'tombstone'
    )).toHaveLength(1);

    expect(offlinePeerDb.tombstonesMap.has(note.id)).toBe(false);
  });

  it('records delivery failures and never acknowledges an unpersisted remote deletion', async () => {
    const note = await makeNote(
      'failed-deletion-write',
      'Failed write',
      'Body',
      '2026-01-02T00:00:00.000Z'
    );
    const dbA = createMockDb([note], [pairing]);
    const dbB = createMockDb([note], [pairing]);
    dbB.failNextPutTombstone = true;
    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();

    const tombstone = await dbContext.run(dbA, () => deleteNoteWithTombstone(note.id));
    await act(async () => {
      await dbContext.run(dbA, () => mountA.api().propagateDeletion(tombstone!));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    expect(dbB.notesMap.has(note.id)).toBe(true);
    expect(dbB.tombstonesMap.has(note.id)).toBe(false);
    expect(network.sentMessages.some((message) =>
      (message.data as { type?: string }).type === 'tombstone-ack'
    )).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 1);
    });
    expect(dbA.tombstonesMap.get(note.id)).toMatchObject({
      scope: 'local',
      deliveryFailures: 1,
    });
    expect(
      dbA.deletionDeliveriesMap.get(deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-B'))?.status
    ).toBe('failed');
    warn.mockRestore();
  });

  it('handles duplicate and out-of-order tombstones without deleting newer notes or preserving stale tombstones', async () => {
    const oldNote = await makeNote(
      'old-by-delete',
      'Old',
      'Body',
      '2026-01-02T00:00:00.000Z'
    );
    const newerNote = await makeNote(
      'newer-than-delete',
      'Newer',
      'Body',
      '2026-05-01T00:00:00.000Z'
    );
    const deviceDb = createMockDb([oldNote, newerNote], [pairing]);
    const mount = await mountSyncHook('device-B', deviceDb);
    cleanups.push(mount.unmount);
    const room = network.rooms.find((entry) => entry.deviceId === 'device-B')!;

    await act(async () => {
      dbContext.run(deviceDb, () => {
        currentDeviceId = 'device-B';
        room.onPeerJoin?.('device-A');
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: oldNote.id,
            deletedAt: '2026-04-01T00:00:00.000Z',
            deletionId: 'delete-newer',
          },
          { peerId: 'device-A' }
        );
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: oldNote.id,
            deletedAt: '2026-04-01T00:00:00.000Z',
            deletionId: 'delete-newer',
          },
          { peerId: 'device-A' }
        );
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: oldNote.id,
            deletedAt: '2026-03-01T00:00:00.000Z',
            deletionId: 'delete-older',
          },
          { peerId: 'device-A' }
        );
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: newerNote.id,
            deletedAt: '2026-04-01T00:00:00.000Z',
            deletionId: 'delete-old-note',
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncTicks();

    expect(deviceDb.notesMap.has(oldNote.id)).toBe(false);
    expect(deviceDb.tombstonesMap.get(oldNote.id)).toMatchObject({
      deletionId: 'delete-newer',
      deletedAt: '2026-04-01T00:00:00.000Z',
      scope: 'propagated',
    });
    expect(deviceDb.notesMap.has(newerNote.id)).toBe(true);
    expect(deviceDb.tombstonesMap.get(newerNote.id)).toBeUndefined();
  });

  it('rejects malformed, unpaired, disconnected, and undesired-room deletion messages while allowing connected paired deletions outside active sync sessions', async () => {
    const note = await makeNote('deletion-auth', 'Auth', 'Body', '2026-01-02T00:00:00.000Z');
    const note2 = await makeNote('deletion-auth-2', 'Auth 2', 'Body 2', '2026-01-02T00:00:00.000Z');
    const note3 = await makeNote('deletion-auth-3', 'Auth 3', 'Body 3', '2026-01-02T00:00:00.000Z');
    const deviceDb = createMockDb([note, note2, note3], [pairing]);
    const mount = await mountSyncHook('device-B', deviceDb);
    cleanups.push(mount.unmount);
    const room = network.rooms.find((entry) => entry.deviceId === 'device-B')!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 1. Malformed from connected peer & valid format from unpaired intruder -> both rejected
    await act(async () => {
      dbContext.run(deviceDb, () => {
        currentDeviceId = 'device-B';
        room.onPeerJoin?.('authorized-peer');
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: note.id,
            deletedAt: 'not-a-timestamp',
            deletionId: 'malformed',
          },
          { peerId: 'authorized-peer' }
        );
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: note.id,
            deletedAt: '2026-02-01T00:00:00.000Z',
            deletionId: 'unauthorized',
          },
          { peerId: 'intruder' }
        );
      });
    });
    await flushAsyncTicks();

    expect(deviceDb.notesMap.has(note.id)).toBe(true);
    expect(deviceDb.tombstonesMap.has(note.id)).toBe(false);

    // 2. Connected peer in established pairing deletes note3 independently of any active note-sync session
    await act(async () => {
      dbContext.run(deviceDb, () => {
        currentDeviceId = 'device-B';
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: note3.id,
            deletedAt: '2026-02-01T00:00:00.000Z',
            deletionId: 'authorized-standalone',
          },
          { peerId: 'authorized-peer' }
        );
      });
    });
    await flushAsyncTicks();
    expect(deviceDb.notesMap.has(note3.id)).toBe(false);
    expect(deviceDb.tombstonesMap.get(note3.id)?.scope).toBe('propagated');

    // 3. Disconnected peer (after onPeerLeave) -> rejected
    await act(async () => {
      dbContext.run(deviceDb, () => {
        currentDeviceId = 'device-B';
        room.onPeerLeave?.('authorized-peer');
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: note.id,
            deletedAt: '2026-02-01T00:00:00.000Z',
            deletionId: 'after-disconnect',
          },
          { peerId: 'authorized-peer' }
        );
      });
    });
    await flushAsyncTicks();
    expect(deviceDb.notesMap.has(note.id)).toBe(true);
    expect(deviceDb.tombstonesMap.has(note.id)).toBe(false);

    // 4. Undesired room (after removePairing) -> rejected even if message arrives on stale room callback
    await act(async () => {
      dbContext.run(deviceDb, () => {
        currentDeviceId = 'device-B';
        room.onPeerJoin?.('authorized-peer');
      });
      await mount.api().removePairing(pairing.id);
      dbContext.run(deviceDb, () => {
        currentDeviceId = 'device-B';
        room.onMessage?.(
          {
            type: 'tombstone',
            noteId: note2.id,
            deletedAt: '2026-02-01T00:00:00.000Z',
            deletionId: 'undesired-room',
          },
          { peerId: 'authorized-peer' }
        );
      });
    });
    await flushAsyncTicks();
    expect(deviceDb.notesMap.has(note2.id)).toBe(true);
    expect(deviceDb.tombstonesMap.has(note2.id)).toBe(false);
    warn.mockRestore();
  });

  it('serializes concurrent note writes and deletions so a deleted note cannot reappear', async () => {
    const note = await makeNote('delete-race', 'Race', 'Body', '2026-01-02T00:00:00.000Z');
    const deviceDb = createMockDb();

    await dbContext.run(deviceDb, async () => {
      await Promise.all([
        persistIncomingNote(note, false),
        applyRemoteTombstone({
          noteId: note.id,
          deletedAt: '2026-02-01T00:00:00.000Z',
          deletionId: 'race-delete',
        }),
      ]);
    });

    expect(deviceDb.notesMap.has(note.id)).toBe(false);
    expect(deviceDb.tombstonesMap.get(note.id)?.scope).toBe('propagated');
    const staleWrite = await dbContext.run(deviceDb, () =>
      persistIncomingNote(note, false)
    );
    expect(staleWrite).toBe('blocked');
  });

  it('allows only selected manual sync to restore a local-only tombstone', async () => {
    const note = await makeNote('manual-restore', 'Restore', 'Body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([note], [pairing]);
    const dbB = createMockDb([note], [pairing]);
    const tombstone = await dbContext.run(dbA, () => deleteNoteWithTombstone(note.id));
    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    await act(async () => {
      await mountA.api().requestPeerManifest(pairing.id);
    });
    await flushAsyncTicks();
    expect(mountA.api().manualPreview.stage).toBe('ready');

    await act(async () => {
      await mountA.api().syncSelectedWithPeer(pairing.id, [note.id]);
    });
    await flushAsyncTicks();

    expect(dbA.notesMap.get(note.id)?.content).toBe(note.content);
    expect(dbA.tombstonesMap.has(note.id)).toBe(false);
    expect(tombstone?.scope).toBe('local');
  });

  it('blocks ordinary sync resurrection after a propagated deletion', async () => {
    const note = await makeNote('no-resurrection', 'Stale', 'Body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([], [pairing]);
    const dbB = createMockDb([note], [pairing]);
    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    await dbContext.run(dbA, () =>
      applyRemoteTombstone({
        noteId: note.id,
        deletedAt: '2026-02-01T00:00:00.000Z',
        deletionId: 'already-propagated',
      })
    );
    await act(async () => {
      void mountB.api().triggerSync();
    });
    await flushAsyncTicks();

    expect(dbA.notesMap.has(note.id)).toBe(false);
    expect(dbA.tombstonesMap.get(note.id)?.scope).toBe('propagated');
    expect(mountB.api().syncStatus.stage).toBe('error');
  });

  // ── Batch 4A.1: Stale tombstone conflict resolution ────────────────────────

  it('preserves a newer existing note against an older incoming deletion and allows subsequent newer updates to sync', async () => {
    const noteMay = await makeNote('note-newer', 'Newer', 'May edit', '2026-05-01T00:00:00.000Z');
    const noteJune = await makeNote('note-newer', 'Newer', 'June edit', '2026-06-01T00:00:00.000Z');

    const dbA = createMockDb([noteJune], [pairing]);
    const dbB = createMockDb([noteMay], [pairing]);
    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });

    // Stale deletion from April arrives on Device B which already has May update
    const roomB = network.rooms.find((r) => r.deviceId === 'device-B')!;
    await act(async () => {
      dbContext.run(dbB, () => {
        currentDeviceId = 'device-B';
        roomB.onMessage?.(
          {
            type: 'tombstone',
            noteId: noteMay.id,
            deletedAt: '2026-04-01T00:00:00.000Z',
            deletionId: 'stale-april-delete',
          },
          { peerId: 'device-A' }
        );
      });
    });
    await flushAsyncTicks();

    // Newer note survives AND stale tombstone is not kept
    expect(dbB.notesMap.get(noteMay.id)?.content).toBe('May edit');
    expect(dbB.tombstonesMap.has(noteMay.id)).toBe(false);

    // Subsequent newer update (June) syncs cleanly to Device B
    await act(async () => {
      void mountB.api().triggerSync();
    });
    await flushAsyncTicks();
    expect(dbB.notesMap.get(noteMay.id)?.content).toBe('June edit');
    expect(mountB.api().syncStatus).toMatchObject({ stage: 'done' });
  });

  it('allows a genuinely newer incoming note to supersede an existing propagated tombstone while blocking older and equal-timestamp notes', async () => {
    const deviceDb = createMockDb();
    await dbContext.run(deviceDb, async () => {
      await applyRemoteTombstone({
        noteId: 'n-conflict',
        deletedAt: '2026-04-01T12:00:00.000Z',
        deletionId: 'del-april',
      });

      const olderNote = await makeNote('n-conflict', 'Older', 'Old', '2026-04-01T11:59:59.000Z');
      const equalNote = await makeNote('n-conflict', 'Equal', 'Equal', '2026-04-01T12:00:00.000Z');
      const newerNote = await makeNote('n-conflict', 'Newer', 'New', '2026-04-01T12:00:01.000Z');

      expect(await persistIncomingNote(olderNote, false)).toBe('blocked');
      expect(await persistIncomingNote(equalNote, false)).toBe('blocked');
      expect(await persistIncomingNote(equalNote, true)).toBe('blocked');
      expect(deviceDb.tombstonesMap.get('n-conflict')?.deletionId).toBe('del-april');

      expect(await persistIncomingNote(newerNote, false)).toBe('stored');
      expect(deviceDb.notesMap.get('n-conflict')?.content).toBe('New');
      expect(deviceDb.tombstonesMap.has('n-conflict')).toBe(false);

      // A newer deletion after that note still wins
      const result = await applyRemoteTombstone({
        noteId: 'n-conflict',
        deletedAt: '2026-05-01T00:00:00.000Z',
        deletionId: 'del-may',
      });
      expect(result).toEqual({ outcome: 'applied', removedNote: true });
      expect(deviceDb.notesMap.has('n-conflict')).toBe(false);
      expect(deviceDb.tombstonesMap.get('n-conflict')).toMatchObject({
        deletionId: 'del-may',
        scope: 'propagated',
      });
    });
  });

  it('resolves multiple out-of-order tombstones consistently regardless of arrival order', async () => {
    const dbOrder1 = createMockDb();
    const dbOrder2 = createMockDb();

    const t1 = { noteId: 'n-ooo', deletedAt: '2026-02-01T00:00:00.000Z', deletionId: 'd-1' };
    const t2 = { noteId: 'n-ooo', deletedAt: '2026-04-01T00:00:00.000Z', deletionId: 'd-2' };
    const t3 = { noteId: 'n-ooo', deletedAt: '2026-03-01T00:00:00.000Z', deletionId: 'd-3' };

    await dbContext.run(dbOrder1, async () => {
      await applyRemoteTombstone(t1);
      await applyRemoteTombstone(t2);
      await applyRemoteTombstone(t3);
    });
    await dbContext.run(dbOrder2, async () => {
      await applyRemoteTombstone(t2);
      await applyRemoteTombstone(t3);
      await applyRemoteTombstone(t1);
    });

    expect(dbOrder1.tombstonesMap.get('n-ooo')).toEqual(dbOrder2.tombstonesMap.get('n-ooo'));
    expect(dbOrder1.tombstonesMap.get('n-ooo')).toMatchObject({
      deletionId: 'd-2',
      deletedAt: '2026-04-01T00:00:00.000Z',
      scope: 'propagated',
    });

    // Existing older note is deleted by newer tombstone even after an older tombstone was rejected
    const note = await makeNote('n-ooo-note', 'Title', 'Body', '2026-03-15T00:00:00.000Z');
    const dbWithNote = createMockDb([note]);
    await dbContext.run(dbWithNote, async () => {
      expect(
        await applyRemoteTombstone({
          noteId: note.id,
          deletedAt: '2026-03-01T00:00:00.000Z',
          deletionId: 'd-older',
        })
      ).toEqual({ outcome: 'superseded', removedNote: false });
      expect(dbWithNote.notesMap.has(note.id)).toBe(true);
      expect(dbWithNote.tombstonesMap.has(note.id)).toBe(false);

      expect(
        await applyRemoteTombstone({
          noteId: note.id,
          deletedAt: '2026-04-01T00:00:00.000Z',
          deletionId: 'd-newer',
        })
      ).toEqual({ outcome: 'applied', removedNote: true });
      expect(dbWithNote.notesMap.has(note.id)).toBe(false);
      expect(dbWithNote.tombstonesMap.get(note.id)?.deletionId).toBe('d-newer');
    });
  });

  // ── Batch 4A.1: Multi-peer deletion delivery tracking ──────────────────────

  it('tracks accepted delivery separately for two connected peers when both acknowledge', async () => {
    const pairing2: Pairing = { id: 'room-deletion-02', label: 'Tablet', pairedAt: '2026-01-01T00:00:00.000Z' };
    const note = await makeNote('multi-ack', 'Multi', 'Body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([note], [pairing, pairing2]);
    const dbB = createMockDb([note], [pairing]);
    const dbC = createMockDb([note], [pairing2]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    const mountC = await mountSyncHook('device-C', dbC);
    cleanups.push(mountA.unmount, mountB.unmount, mountC.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB, 'device-C': dbC });

    const tombstone = await dbContext.run(dbA, () => deleteNoteWithTombstone(note.id));
    await act(async () => {
      await dbContext.run(dbA, () => mountA.api().propagateDeletion(tombstone!));
    });
    await flushAsyncTicks();

    expect(dbA.tombstonesMap.get(note.id)).toMatchObject({
      scope: 'propagated',
      deliveryFailures: 0,
    });
    expect(
      dbA.deletionDeliveriesMap.get(deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-B'))?.status
    ).toBe('accepted');
    expect(
      dbA.deletionDeliveriesMap.get(deletionDeliveryKey(tombstone!.deletionId, pairing2.id, 'device-C'))?.status
    ).toBe('accepted');
    expect(dbB.notesMap.has(note.id)).toBe(false);
    expect(dbC.notesMap.has(note.id)).toBe(false);
  });

  it('preserves individual accepted and failed results when one peer acknowledges and another fails', async () => {
    const note = await makeNote('partial-ack', 'Partial', 'Body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([note], [pairing]);
    const dbB = createMockDb([note], [pairing]);
    const dbC = createMockDb([note], [pairing]);
    dbC.failNextPutTombstone = true;

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    const mountC = await mountSyncHook('device-C', dbC);
    cleanups.push(mountA.unmount, mountB.unmount, mountC.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB, 'device-C': dbC });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();

    const tombstone = await dbContext.run(dbA, () => deleteNoteWithTombstone(note.id));
    await act(async () => {
      await dbContext.run(dbA, () => mountA.api().propagateDeletion(tombstone!));
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    // Peer B acknowledged -> scope is propagated, while Peer C is still pending until timeout
    expect(dbA.tombstonesMap.get(note.id)?.scope).toBe('propagated');
    expect(
      dbA.deletionDeliveriesMap.get(deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-B'))?.status
    ).toBe('accepted');
    expect(
      dbA.deletionDeliveriesMap.get(deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-C'))?.status
    ).toBe('pending');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 1);
    });

    // Both individual peer results are preserved and propagated scope is not downgraded
    expect(
      dbA.deletionDeliveriesMap.get(deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-B'))?.status
    ).toBe('accepted');
    expect(
      dbA.deletionDeliveriesMap.get(deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-C'))?.status
    ).toBe('failed');
    expect(dbA.tombstonesMap.get(note.id)).toMatchObject({
      scope: 'propagated',
      deliveryFailures: 1,
    });
    warn.mockRestore();
  });

  it('records failure on disconnect for one peer without affecting another peer pending delivery', async () => {
    const note = await makeNote('disconnect-isolated', 'Isolate', 'Body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([note], [pairing]);
    const dbB = createMockDb([note], [pairing]);
    const dbC = createMockDb([note], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    const mountC = await mountSyncHook('device-C', dbC);
    cleanups.push(mountA.unmount, mountB.unmount, mountC.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB, 'device-C': dbC });

    // Hold tombstone-ack from device-B and device-C
    const heldAcks: Record<string, () => void> = {};
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (wire.toPeerId === 'device-A' && msg.type === 'tombstone-ack') {
        const roomA = network.rooms.find((r) => r.deviceId === 'device-A')!;
        heldAcks[wire.fromDevice] = () => {
          dbContext.run(dbA, () => {
            currentDeviceId = 'device-A';
            roomA.onMessage?.(structuredClone(wire.data), { peerId: wire.fromDevice });
          });
        };
        return true;
      }
      return false;
    };

    const tombstone = await dbContext.run(dbA, () => deleteNoteWithTombstone(note.id));
    await act(async () => {
      await dbContext.run(dbA, () => mountA.api().propagateDeletion(tombstone!));
    });
    await flushAsyncTicks();

    const keyB = deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-B');
    const keyC = deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-C');
    expect(dbA.deletionDeliveriesMap.get(keyB)?.status).toBe('pending');
    expect(dbA.deletionDeliveriesMap.get(keyC)?.status).toBe('pending');
    expect(dbA.tombstonesMap.get(note.id)?.scope).toBe('local');

    // Device B disconnects before acknowledging
    await act(async () => {
      await mountB.unmount();
    });
    await flushAsyncTicks();

    expect(dbA.deletionDeliveriesMap.get(keyB)?.status).toBe('failed');
    expect(dbA.deletionDeliveriesMap.get(keyC)?.status).toBe('pending');
    expect(dbA.tombstonesMap.get(note.id)).toMatchObject({
      scope: 'local',
      deliveryFailures: 1,
    });

    // Device C now acknowledges -> accepted for C, failed preserved for B, scope becomes propagated
    network.dropMessagePredicate = null;
    await act(async () => {
      heldAcks['device-C']?.();
    });
    await flushAsyncTicks();

    expect(dbA.deletionDeliveriesMap.get(keyB)?.status).toBe('failed');
    expect(dbA.deletionDeliveriesMap.get(keyC)?.status).toBe('accepted');
    expect(dbA.tombstonesMap.get(note.id)).toMatchObject({
      scope: 'propagated',
      deliveryFailures: 1,
    });
  });

  it('creates no delivery records or queued messages when no peers are connected at deletion time', async () => {
    const note = await makeNote('no-peers-delete', 'Alone', 'Body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([note], [pairing]);
    const dbB = createMockDb([note], [pairing]);

    const mountA = await mountSyncHook('device-A', dbA);
    cleanups.push(mountA.unmount);
    setupPerDeviceRouting({ 'device-A': dbA });

    const tombstone = await dbContext.run(dbA, () => deleteNoteWithTombstone(note.id));
    await act(async () => {
      await dbContext.run(dbA, () => mountA.api().propagateDeletion(tombstone!));
    });
    await flushAsyncTicks();

    expect(dbA.deletionDeliveriesMap.size).toBe(0);
    expect(
      network.sentMessages.filter((m) => (m.data as { type?: string }).type === 'tombstone')
    ).toHaveLength(0);
    expect(dbA.tombstonesMap.get(note.id)).toMatchObject({
      scope: 'local',
      deliveryFailures: 0,
    });

    // Offline peer connects later -> must NOT receive queued deletion messages
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });
    await flushAsyncTicks();

    expect(
      network.sentMessages.filter((m) => (m.data as { type?: string }).type === 'tombstone')
    ).toHaveLength(0);
    expect(dbB.notesMap.has(note.id)).toBe(true);
    expect(dbA.deletionDeliveriesMap.size).toBe(0);
  });

  it('ignores duplicate, late, and mismatched tombstone-acks without corrupting delivery state', async () => {
    const pairing2: Pairing = { id: 'room-deletion-02', label: 'Other', pairedAt: '2026-01-01T00:00:00.000Z' };
    const note = await makeNote('ack-safety', 'Ack Safety', 'Body', '2026-01-02T00:00:00.000Z');
    const dbA = createMockDb([note], [pairing, pairing2]);
    const dbB = createMockDb([note], [pairing]);
    const dbC = createMockDb([note], [pairing2]);

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    const mountC = await mountSyncHook('device-C', dbC);
    cleanups.push(mountA.unmount, mountB.unmount, mountC.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB, 'device-C': dbC });

    const heldAcks: Record<string, unknown> = {};
    network.dropMessagePredicate = (wire) => {
      const msg = wire.data as { type?: string };
      if (wire.toPeerId === 'device-A' && msg.type === 'tombstone-ack') {
        heldAcks[wire.fromDevice] = structuredClone(wire.data);
        return true;
      }
      return false;
    };

    vi.useFakeTimers();
    const tombstone = await dbContext.run(dbA, () => deleteNoteWithTombstone(note.id));
    await act(async () => {
      await dbContext.run(dbA, () => mountA.api().propagateDeletion(tombstone!));
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    const keyB = deletionDeliveryKey(tombstone!.deletionId, pairing.id, 'device-B');
    const keyC = deletionDeliveryKey(tombstone!.deletionId, pairing2.id, 'device-C');
    const roomA1 = network.rooms.find((r) => r.deviceId === 'device-A' && r.roomId === pairing.id)!;
    const roomA2 = network.rooms.find((r) => r.deviceId === 'device-A' && r.roomId === pairing2.id)!;

    // Mismatched ACKs (wrong noteId, wrong deletionId, wrong peerId, wrong pairingId) must be ignored
    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA1.onMessage?.(
          { type: 'tombstone-ack', noteId: 'wrong-note', deletionId: tombstone!.deletionId },
          { peerId: 'device-B' }
        );
        roomA1.onMessage?.(
          { type: 'tombstone-ack', noteId: note.id, deletionId: 'wrong-deletion' },
          { peerId: 'device-B' }
        );
        roomA1.onMessage?.(
          { type: 'tombstone-ack', noteId: note.id, deletionId: tombstone!.deletionId },
          { peerId: 'device-C' }
        );
        roomA2.onMessage?.(
          { type: 'tombstone-ack', noteId: note.id, deletionId: tombstone!.deletionId },
          { peerId: 'device-B' }
        );
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(dbA.deletionDeliveriesMap.get(keyB)?.status).toBe('pending');
    expect(dbA.deletionDeliveriesMap.get(keyC)?.status).toBe('pending');
    expect(dbA.tombstonesMap.get(note.id)?.scope).toBe('local');

    // Deliver B's ACK twice (duplicate ACK) -> accepted once, state remains clean
    network.dropMessagePredicate = null;
    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA1.onMessage?.(structuredClone(heldAcks['device-B']), { peerId: 'device-B' });
        roomA1.onMessage?.(structuredClone(heldAcks['device-B']), { peerId: 'device-B' });
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(dbA.deletionDeliveriesMap.get(keyB)?.status).toBe('accepted');
    expect(dbA.deletionDeliveriesMap.get(keyC)?.status).toBe('pending');
    expect(dbA.tombstonesMap.get(note.id)?.scope).toBe('propagated');

    // Timeout C so C becomes failed, then deliver C's late ACK -> must stay failed!
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_TIMEOUT_MS + 1);
    });
    expect(dbA.deletionDeliveriesMap.get(keyC)?.status).toBe('failed');

    await act(async () => {
      dbContext.run(dbA, () => {
        currentDeviceId = 'device-A';
        roomA2.onMessage?.(structuredClone(heldAcks['device-C']), { peerId: 'device-C' });
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(dbA.deletionDeliveriesMap.get(keyB)?.status).toBe('accepted');
    expect(dbA.deletionDeliveriesMap.get(keyC)?.status).toBe('failed');
    expect(dbA.tombstonesMap.get(note.id)).toMatchObject({
      scope: 'propagated',
      deliveryFailures: 1,
    });
  });

  // ── Batch 4A.2: Tombstone ACK outcome semantics ────────────────────────────

  it('distinguishes applied tombstone ACKs from stale deletions superseded by a newer note', async () => {
    const noteOnA = await makeNote('ack-outcome-1', 'Note', 'Older A', '2026-03-01T00:00:00.000Z');
    const newerNoteOnB = await makeNote('ack-outcome-1', 'Note', 'Newer B', '2026-06-01T00:00:00.000Z');
    const olderNoteOnC = await makeNote('ack-outcome-1', 'Note', 'Older C', '2026-02-01T00:00:00.000Z');

    // Case 1: Single peer has a newer note -> receiver replies outcome: 'superseded',
    // sender records status: 'superseded', deliveryFailures: 0, and keeps scope: 'local'.
    const dbA1 = createMockDb([noteOnA], [pairing]);
    const dbB1 = createMockDb([newerNoteOnB], [pairing]);
    const mountA1 = await mountSyncHook('device-A', dbA1);
    const mountB1 = await mountSyncHook('device-B', dbB1);
    cleanups.push(mountA1.unmount, mountB1.unmount);
    setupPerDeviceRouting({ 'device-A': dbA1, 'device-B': dbB1 });

    // Create a local tombstone with deletedAt strictly before newerNoteOnB (2026-04-01 < 2026-06-01)
    const staleTombstone: Tombstone = {
      noteId: noteOnA.id,
      deletedAt: '2026-04-01T00:00:00.000Z',
      deletionId: 'del-stale-vs-b',
      scope: 'local',
      deliveryFailures: 0,
    };
    dbA1.notesMap.delete(noteOnA.id);
    dbA1.tombstonesMap.set(noteOnA.id, staleTombstone);

    await act(async () => {
      await dbContext.run(dbA1, () => mountA1.api().propagateDeletion(staleTombstone));
    });
    await flushAsyncTicks();

    const ackFromB = network.sentMessages.find(
      (m) => (m.data as { type?: string }).type === 'tombstone-ack'
    )?.data as { type: string; outcome?: string } | undefined;
    expect(ackFromB?.outcome).toBe('superseded');
    expect(dbB1.notesMap.get(noteOnA.id)?.content).toBe('Newer B');
    expect(dbB1.tombstonesMap.has(noteOnA.id)).toBe(false);
    expect(
      dbA1.deletionDeliveriesMap.get(
        deletionDeliveryKey(staleTombstone.deletionId, pairing.id, 'device-B')
      )?.status
    ).toBe('superseded');
    expect(dbA1.tombstonesMap.get(noteOnA.id)).toMatchObject({
      scope: 'local',
      deliveryFailures: 0,
    });

    // Case 2: Multi-peer where B supersedes and C applies -> preserves both outcomes
    resetNetwork();
    const pairing2: Pairing = { id: 'room-deletion-02', label: 'Peer C', pairedAt: '2026-01-01T00:00:00.000Z' };
    const dbA2 = createMockDb([], [pairing, pairing2]);
    const dbB2 = createMockDb([newerNoteOnB], [pairing]);
    const dbC2 = createMockDb([olderNoteOnC], [pairing2]);
    const mixedTombstone: Tombstone = {
      noteId: noteOnA.id,
      deletedAt: '2026-04-01T00:00:00.000Z',
      deletionId: 'del-mixed-outcomes',
      scope: 'local',
      deliveryFailures: 0,
    };
    dbA2.tombstonesMap.set(noteOnA.id, mixedTombstone);

    const mountA2 = await mountSyncHook('device-A', dbA2);
    const mountB2 = await mountSyncHook('device-B', dbB2);
    const mountC2 = await mountSyncHook('device-C', dbC2);
    cleanups.push(mountA2.unmount, mountB2.unmount, mountC2.unmount);
    setupPerDeviceRouting({ 'device-A': dbA2, 'device-B': dbB2, 'device-C': dbC2 });

    await act(async () => {
      await dbContext.run(dbA2, () => mountA2.api().propagateDeletion(mixedTombstone));
    });
    await flushAsyncTicks();

    const ackB2 = network.sentMessages.find(
      (m) =>
        m.fromDevice === 'device-B' &&
        (m.data as { type?: string }).type === 'tombstone-ack'
    )?.data as { outcome?: string } | undefined;
    const ackC2 = network.sentMessages.find(
      (m) =>
        m.fromDevice === 'device-C' &&
        (m.data as { type?: string }).type === 'tombstone-ack'
    )?.data as { outcome?: string } | undefined;

    expect(ackB2?.outcome).toBe('superseded');
    expect(ackC2?.outcome).toBe('applied');
    expect(
      dbA2.deletionDeliveriesMap.get(
        deletionDeliveryKey(mixedTombstone.deletionId, pairing.id, 'device-B')
      )?.status
    ).toBe('superseded');
    expect(
      dbA2.deletionDeliveriesMap.get(
        deletionDeliveryKey(mixedTombstone.deletionId, pairing2.id, 'device-C')
      )?.status
    ).toBe('accepted');
    expect(dbA2.tombstonesMap.get(noteOnA.id)).toMatchObject({
      scope: 'propagated',
      deliveryFailures: 0,
    });
    expect(dbB2.notesMap.get(noteOnA.id)?.content).toBe('Newer B');
    expect(dbC2.notesMap.has(noteOnA.id)).toBe(false);
    expect(dbC2.tombstonesMap.get(noteOnA.id)?.scope).toBe('propagated');
  });

  it('reconciles interrupted pending deletion deliveries on sync mount without queuing or retrying on reconnect', async () => {
    const dbA = createMockDb([], [pairing]);
    const dbB = createMockDb([], [pairing]);
    const priorIso = new Date(Date.now() - 1000).toISOString();
    const interruptedTombstone: Tombstone = {
      noteId: 'interrupted-note',
      noteTitle: 'Interrupted',
      deletedAt: priorIso,
      deletionId: 'del-interrupted',
      scope: 'local',
      deliveryFailures: 0,
    };
    const deliveryKey = deletionDeliveryKey('del-interrupted', pairing.id, 'device-B');
    dbA.tombstonesMap.set('interrupted-note', interruptedTombstone);
    dbA.deletionDeliveriesMap.set(deliveryKey, {
      id: deliveryKey,
      noteId: 'interrupted-note',
      deletionId: 'del-interrupted',
      pairingId: pairing.id,
      peerId: 'device-B',
      status: 'pending',
      updatedAt: priorIso,
    });

    const mountA = await mountSyncHook('device-A', dbA);
    const mountB = await mountSyncHook('device-B', dbB);
    cleanups.push(mountA.unmount, mountB.unmount);
    setupPerDeviceRouting({ 'device-A': dbA, 'device-B': dbB });
    await flushAsyncTicks();

    expect(dbA.deletionDeliveriesMap.get(deliveryKey)?.status).toBe('failed');
    expect(dbA.tombstonesMap.get('interrupted-note')).toMatchObject({
      scope: 'local',
      deliveryFailures: 1,
    });
    expect(
      network.sentMessages.filter((m) => (m.data as { type?: string }).type === 'tombstone')
    ).toHaveLength(0);
  });
});
