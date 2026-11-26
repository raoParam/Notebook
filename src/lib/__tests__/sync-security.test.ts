import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_ATTACHMENT_DATA_LENGTH,
  MAX_COMPRESSED_NOTE_BYTES,
  MAX_DECOMPRESSED_NOTE_BYTES,
  MAX_MANIFEST_ENTRIES,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  MAX_REQUEST_NOTE_IDS,
  compressNote,
  countUnchangedNotes,
  decompressNote,
  isSafeAttachmentDataUrl,
  parseSyncMessage,
  validateNote,
} from '@/lib/sync';
import type { Note } from '@/lib/db';

function makeValidNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Sample Note',
    content: '# Hello\n\nBody text.',
    attachments: {
      att1: {
        name: 'image.png',
        data: 'data:image/png;base64,iVBORw0KGgo=',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    contentHash: 'abc123def456',
    ...overrides,
  };
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('gzip' as CompressionFormat);
  const writer = stream.writable.getWriter();
  const writePromise = (async () => {
    await writer.write(input as unknown as Uint8Array<ArrayBuffer>);
    await writer.close();
  })();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  await writePromise;

  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

describe('parseSyncMessage', () => {
  it('rejects non-object payloads and unknown message types', () => {
    expect(parseSyncMessage(null)).toBeNull();
    expect(parseSyncMessage(undefined)).toBeNull();
    expect(parseSyncMessage('done')).toBeNull();
    expect(parseSyncMessage(42)).toBeNull();
    expect(parseSyncMessage(true)).toBeNull();
    expect(parseSyncMessage([])).toBeNull();
    expect(parseSyncMessage(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseSyncMessage(new Date())).toBeNull();
    expect(parseSyncMessage(Object.create({ type: 'done' }))).toBeNull();
    expect(parseSyncMessage({})).toBeNull();
    expect(parseSyncMessage({ type: 'unknown' })).toBeNull();
    expect(parseSyncMessage({ type: 123 })).toBeNull();
  });

  it('parses valid sync messages and strips unexpected manifest entry fields', () => {
    const manifestMsg = parseSyncMessage({
      type: 'manifest',
      entries: [
        {
          noteId: 'n1',
          contentHash: 'hash1',
          updatedAt: '2026-01-01T00:00:00.000Z',
          extra: 'ignored',
        },
      ],
    });
    expect(manifestMsg).toEqual({
      type: 'manifest',
      entries: [
        {
          noteId: 'n1',
          contentHash: 'hash1',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(parseSyncMessage({ type: 'manifest', entries: [] })).toEqual({
      type: 'manifest',
      entries: [],
    });

    expect(parseSyncMessage({ type: 'request', noteIds: ['n1', 'n2'] })).toEqual({
      type: 'request',
      noteIds: ['n1', 'n2'],
    });
    expect(parseSyncMessage({ type: 'request', noteIds: [] })).toEqual({
      type: 'request',
      noteIds: [],
    });

    const rawBytes = new Uint8Array([31, 139, 8, 0]);
    const fromUint8 = parseSyncMessage({ type: 'note', payload: rawBytes });
    expect(fromUint8).toEqual({ type: 'note', payload: rawBytes });

    const fromArray = parseSyncMessage({ type: 'note', payload: [31, 139, 8, 0] });
    expect(fromArray).toEqual({ type: 'note', payload: new Uint8Array([31, 139, 8, 0]) });
    if (fromArray?.type === 'note') {
      expect(fromArray.payload).toBeInstanceOf(Uint8Array);
    }

    expect(parseSyncMessage({ type: 'done' })).toEqual({ type: 'done' });

    expect(
      parseSyncMessage({
        type: 'ack',
        sessionId: 'sess-1',
        transferId: 'tx-1',
        noteId: 'n1',
        ok: true,
      })
    ).toEqual({
      type: 'ack',
      sessionId: 'sess-1',
      transferId: 'tx-1',
      noteId: 'n1',
      ok: true,
    });

    expect(
      parseSyncMessage({
        type: 'note-error',
        sessionId: 'sess-1',
        noteId: 'n1',
        reason: 'Note not found',
      })
    ).toEqual({
      type: 'note-error',
      sessionId: 'sess-1',
      noteId: 'n1',
      reason: 'Note not found',
    });
  });

  it('rejects invalid ack, note-error, and invalid session/transfer metadata fields', () => {
    expect(parseSyncMessage({ type: 'ack' })).toBeNull();
    expect(
      parseSyncMessage({ type: 'ack', sessionId: '', transferId: 'tx', noteId: 'n1', ok: true })
    ).toBeNull();
    expect(
      parseSyncMessage({ type: 'ack', sessionId: 's1', transferId: 'tx', noteId: 'n1', ok: 'yes' })
    ).toBeNull();
    expect(
      parseSyncMessage({
        type: 'ack',
        sessionId: 's1',
        transferId: 'tx',
        noteId: 'n1',
        ok: false,
        error: 'bad\nerror',
      })
    ).toBeNull();
    expect(parseSyncMessage({ type: 'note-error', sessionId: 's1', noteId: '' })).toBeNull();
    expect(
      parseSyncMessage({ type: 'manifest', entries: [], sessionId: 123 })
    ).toBeNull();
    expect(
      parseSyncMessage({ type: 'manifest', entries: [], wantsManifest: 'true' })
    ).toBeNull();
    expect(
      parseSyncMessage({ type: 'note', payload: [1, 2], transferId: 'bad\nid' })
    ).toBeNull();
  });

  it('counts unchanged notes accurately for identical, differing, equal-timestamp conflict, and single-device notes', () => {
    const local = [
      // Identical hashes -> unchanged
      { noteId: 'identical', contentHash: 'h-same', updatedAt: '2026-01-01T00:00:00.000Z' },
      // Identical hashes even with different timestamps -> unchanged
      { noteId: 'identical-diff-ts', contentHash: 'h-same-2', updatedAt: '2026-01-01T00:00:00.000Z' },
      // Different hashes with newer timestamp (will be transferred) -> not unchanged
      { noteId: 'diff-newer', contentHash: 'h-old', updatedAt: '2026-01-01T00:00:00.000Z' },
      // Different hashes with equal timestamps (unresolved LWW conflict) -> NOT unchanged
      { noteId: 'conflict-equal-ts', contentHash: 'h-local', updatedAt: '2026-01-02T00:00:00.000Z' },
      // Present only on local device (even if omitted from peer request list) -> NOT unchanged
      { noteId: 'only-local', contentHash: 'h-local-only', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const peer = [
      { noteId: 'identical', contentHash: 'h-same', updatedAt: '2026-01-01T00:00:00.000Z' },
      { noteId: 'identical-diff-ts', contentHash: 'h-same-2', updatedAt: '2026-01-03T00:00:00.000Z' },
      { noteId: 'diff-newer', contentHash: 'h-new', updatedAt: '2026-01-04T00:00:00.000Z' },
      { noteId: 'conflict-equal-ts', contentHash: 'h-peer', updatedAt: '2026-01-02T00:00:00.000Z' },
      // Present only on peer device -> NOT unchanged
      { noteId: 'only-peer', contentHash: 'h-peer-only', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];

    expect(countUnchangedNotes(local, peer, ['diff-newer', 'only-peer'], [])).toBe(2);
    expect(countUnchangedNotes(local, peer, ['diff-newer', 'only-peer'], ['only-local'])).toBe(2);
  });

  it('rejects malformed and oversized manifests', () => {
    expect(parseSyncMessage({ type: 'manifest' })).toBeNull();
    expect(parseSyncMessage({ type: 'manifest', entries: 'not-an-array' })).toBeNull();
    expect(parseSyncMessage({ type: 'manifest', entries: [null] })).toBeNull();
    expect(parseSyncMessage({ type: 'manifest', entries: [[]] })).toBeNull();

    // Missing fields
    expect(
      parseSyncMessage({
        type: 'manifest',
        entries: [{ noteId: 'n1', contentHash: 'h1' }],
      })
    ).toBeNull();
    expect(
      parseSyncMessage({
        type: 'manifest',
        entries: [{ noteId: 'n1', updatedAt: '2026-01-01T00:00:00.000Z' }],
      })
    ).toBeNull();

    // Invalid contentHash
    expect(
      parseSyncMessage({
        type: 'manifest',
        entries: [{ noteId: 'n1', contentHash: '', updatedAt: '2026-01-01T00:00:00.000Z' }],
      })
    ).toBeNull();
    expect(
      parseSyncMessage({
        type: 'manifest',
        entries: [
          {
            noteId: 'n1',
            contentHash: 'a'.repeat(129),
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    ).toBeNull();

    // Invalid timestamps
    expect(
      parseSyncMessage({
        type: 'manifest',
        entries: [{ noteId: 'n1', contentHash: 'h1', updatedAt: 'not-a-date' }],
      })
    ).toBeNull();
    expect(
      parseSyncMessage({
        type: 'manifest',
        entries: [{ noteId: 'n1', contentHash: 'h1', updatedAt: '' }],
      })
    ).toBeNull();
    expect(
      parseSyncMessage({
        type: 'manifest',
        entries: [{ noteId: 'n1', contentHash: 'h1', updatedAt: 1700000000000 }],
      })
    ).toBeNull();

    // Oversized manifest
    const oversized = Array.from({ length: MAX_MANIFEST_ENTRIES + 1 }, (_, i) => ({
      noteId: `n-${i}`,
      contentHash: 'h1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    expect(parseSyncMessage({ type: 'manifest', entries: oversized })).toBeNull();
  });

  it('rejects invalid noteIds in request messages', () => {
    expect(parseSyncMessage({ type: 'request' })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: 'n1' })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: [''] })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: ['   '] })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: [123] })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: ['a'.repeat(129)] })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: ['bad\nid'] })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: ['bad\rid'] })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: ['bad\x00id'] })).toBeNull();
    expect(parseSyncMessage({ type: 'request', noteIds: ['bad\x7fid'] })).toBeNull();

    const oversized = Array.from({ length: MAX_REQUEST_NOTE_IDS + 1 }, (_, i) => `id-${i}`);
    expect(parseSyncMessage({ type: 'request', noteIds: oversized })).toBeNull();
  });

  it('rejects invalid or oversized compressed note payloads in msg.payload', () => {
    expect(parseSyncMessage({ type: 'note' })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: null })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: 'gzip' })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: new Uint8Array(0) })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: [] })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: [-1] })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: [256] })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: [1.5] })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: [Number.NaN] })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: [Number.POSITIVE_INFINITY] })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: ['1'] })).toBeNull();
    expect(parseSyncMessage({ type: 'note', payload: new Array(3) })).toBeNull();

    expect(
      parseSyncMessage({
        type: 'note',
        payload: new Uint8Array(MAX_COMPRESSED_NOTE_BYTES + 1),
      })
    ).toBeNull();

    const oversizedArray = new Array<number>(MAX_COMPRESSED_NOTE_BYTES + 1).fill(0);
    expect(parseSyncMessage({ type: 'note', payload: oversizedArray })).toBeNull();
  });
});

describe('decompressNote security', () => {
  it('round-trips a valid note via compressNote, parseSyncMessage, and decompressNote', async () => {
    const note = makeValidNote();
    const compressed = await compressNote(note);
    const parsed = parseSyncMessage({ type: 'note', payload: Array.from(compressed) });
    expect(parsed?.type).toBe('note');
    if (!parsed || parsed.type !== 'note') return;

    const restored = await decompressNote(parsed.payload);
    expect(restored).toEqual(note);
  });

  it('rejects empty, non-Uint8Array, oversized, and corrupted gzip payloads cleanly', async () => {
    await expect(decompressNote('not-uint8array' as unknown as Uint8Array)).rejects.toThrow();
    await expect(decompressNote(new Uint8Array(0))).rejects.toThrow();
    await expect(
      decompressNote(new Uint8Array(MAX_COMPRESSED_NOTE_BYTES + 1))
    ).rejects.toThrow();

    // Non-gzip garbage bytes
    await expect(decompressNote(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow();

    // Truncated valid gzip payload
    const validCompressed = await compressNote(makeValidNote());
    await expect(
      decompressNote(validCompressed.subarray(0, Math.max(1, validCompressed.byteLength - 4)))
    ).rejects.toThrow();

    // Valid gzip containing non-JSON content
    const nonJsonGzip = await gzipBytes(new TextEncoder().encode('not json at all'));
    await expect(decompressNote(nonJsonGzip)).rejects.toThrow();
  });

  it('rejects a real gzip bomb exceeding MAX_DECOMPRESSED_NOTE_BYTES during streaming', async () => {
    const bombSize = MAX_DECOMPRESSED_NOTE_BYTES + 64 * 1024;
    const zeroes = new Uint8Array(bombSize);
    const compressedBomb = await gzipBytes(zeroes);

    // Confirm this is genuinely a compressed bomb: tiny compressed size, huge decompressed size
    expect(compressedBomb.byteLength).toBeGreaterThan(0);
    expect(compressedBomb.byteLength).toBeLessThan(100 * 1024);

    await expect(decompressNote(compressedBomb)).rejects.toThrow(/exceeds maximum size/i);
  });
});

describe('validateNote and isSafeAttachmentDataUrl', () => {
  it('accepts valid notes and strips unexpected extra properties', () => {
    const rawWithExtras = {
      ...makeValidNote(),
      isAdmin: true,
      extraNested: { evil: 1 },
      attachments: {
        pic: {
          name: 'photo.webp',
          data: 'data:IMAGE/WEBP;base64,UklGRg==',
          createdAt: '2026-01-01T00:00:00.000Z',
          extraField: 'should-be-stripped',
        },
      },
    };

    const validated = validateNote(rawWithExtras);
    expect(validated).toEqual({
      id: 'note-1',
      title: 'Sample Note',
      content: '# Hello\n\nBody text.',
      attachments: {
        pic: {
          name: 'photo.webp',
          data: 'data:IMAGE/WEBP;base64,UklGRg==',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      contentHash: 'abc123def456',
    });
    expect('isAdmin' in validated).toBe(false);
    expect('extraNested' in validated).toBe(false);
    expect('extraField' in validated.attachments.pic).toBe(false);
  });

  it('rejects invalid Note schemas, IDs, sizes, and timestamps', () => {
    expect(() => validateNote(null)).toThrow();
    expect(() => validateNote([])).toThrow();
    expect(() => validateNote('note')).toThrow();
    expect(() => validateNote(new Date())).toThrow();

    // Missing or invalid fields
    expect(() => validateNote({ ...makeValidNote(), id: '' })).toThrow();
    expect(() => validateNote({ ...makeValidNote(), id: '   ' })).toThrow();
    expect(() => validateNote({ ...makeValidNote(), id: 'a'.repeat(129) })).toThrow();
    expect(() => validateNote({ ...makeValidNote(), id: 'bad\nid' })).toThrow();
    expect(() => validateNote({ ...makeValidNote(), id: 'bad\x00id' })).toThrow();

    expect(() => validateNote({ ...makeValidNote(), title: 123 })).toThrow();
    expect(() =>
      validateNote({ ...makeValidNote(), title: 't'.repeat(MAX_NOTE_TITLE_LENGTH + 1) })
    ).toThrow();

    expect(() => validateNote({ ...makeValidNote(), content: null })).toThrow();
    expect(() =>
      validateNote({ ...makeValidNote(), content: 'c'.repeat(MAX_NOTE_CONTENT_LENGTH + 1) })
    ).toThrow();

    expect(() => validateNote({ ...makeValidNote(), createdAt: 'invalid' })).toThrow();
    expect(() => validateNote({ ...makeValidNote(), updatedAt: 'invalid' })).toThrow();
    expect(() =>
      validateNote({ ...makeValidNote(), updatedAt: '2026-01-01T00:00:00.000Z'.padEnd(65, ' ') })
    ).toThrow();

    expect(() => validateNote({ ...makeValidNote(), contentHash: 123 })).toThrow();
    expect(() => validateNote({ ...makeValidNote(), contentHash: 'h'.repeat(129) })).toThrow();
    expect(() => validateNote({ ...makeValidNote(), attachments: [] })).toThrow();
    expect(() => validateNote({ ...makeValidNote(), attachments: null })).toThrow();
  });

  it('rejects invalid attachment counts, keys, entries, and dangerous data URLs', () => {
    // Too many attachments
    const tooManyAttachments: Record<string, Note['attachments'][string]> = {};
    for (let i = 0; i <= MAX_ATTACHMENTS_PER_NOTE; i++) {
      tooManyAttachments[`att-${i}`] = {
        name: 'img.png',
        data: 'data:image/png;base64,AAAA',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
    }
    expect(() =>
      validateNote(makeValidNote({ attachments: tooManyAttachments }))
    ).toThrow();

    // Bad attachment keys (including markdown injection characters and prototype pollution)
    for (const badKey of ['', 'key]inj', 'key\ninj', 'key\rinj', 'key\x00', 'k'.repeat(129)]) {
      expect(() =>
        validateNote(
          makeValidNote({
            attachments: {
              [badKey]: {
                name: 'img.png',
                data: 'data:image/png;base64,AAAA',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            },
          })
        )
      ).toThrow();
    }

    const protoObj = JSON.parse(
      '{"__proto__":{"name":"img.png","data":"data:image/png;base64,AAAA","createdAt":"2026-01-01T00:00:00.000Z"}}'
    ) as Record<string, Note['attachments'][string]>;
    expect(() => validateNote(makeValidNote({ attachments: protoObj }))).toThrow();
    expect(() =>
      validateNote(
        makeValidNote({
          attachments: {
            constructor: {
              name: 'img.png',
              data: 'data:image/png;base64,AAAA',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          },
        })
      )
    ).toThrow();

    // Non-object entry and bad entry fields
    expect(() =>
      validateNote({
        ...makeValidNote(),
        attachments: { bad: 'not-an-object' },
      })
    ).toThrow();
    expect(() =>
      validateNote({
        ...makeValidNote(),
        attachments: { bad: null },
      })
    ).toThrow();
    expect(() =>
      validateNote({
        ...makeValidNote(),
        attachments: {
          bad: {
            name: 'n'.repeat(257),
            data: 'data:image/png;base64,AAAA',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
      })
    ).toThrow();
    expect(() =>
      validateNote({
        ...makeValidNote(),
        attachments: {
          bad: {
            name: 'img.png',
            data: 'data:image/png;base64,AAAA',
            createdAt: 'not-a-date',
          },
        },
      })
    ).toThrow();

    // Dangerous or malformed attachment URLs
    const badUrls = [
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'javascript:alert(1)',
      'https://evil.example/img.png',
      'http://evil.example/img.png',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png;base64,',
      'data:image/png;base64,abc def',
      'data:image/png;base64,abc\ndef',
      'data:image/png;base64,AAAA)',
      'data:image/png;base64,AA===',
      'data:image/png;base64,AA=AA',
      `data:image/png;base64,${'A'.repeat(MAX_ATTACHMENT_DATA_LENGTH)}`,
    ];

    for (const url of badUrls) {
      expect(isSafeAttachmentDataUrl(url)).toBe(false);
      expect(() =>
        validateNote(
          makeValidNote({
            attachments: {
              bad: {
                name: 'bad',
                data: url,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            },
          })
        )
      ).toThrow();
    }

    // Valid MIME types
    for (const goodUrl of [
      'data:image/png;base64,iVBORw0KGgo=',
      'data:IMAGE/JPEG;base64,/9j/4AAQ',
      'data:image/jpg;base64,AAAA==',
      'data:image/gif;base64,R0lGODlh',
      'data:image/webp;base64,UklGRg==',
    ]) {
      expect(isSafeAttachmentDataUrl(goodUrl)).toBe(true);
    }
  });
});
