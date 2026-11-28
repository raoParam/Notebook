import { describe, expect, it } from 'vitest';
import {
  MAX_FUTURE_CLOCK_SKEW_MS,
  compressNote,
  computeDiff,
  decompressNote,
  type ManifestEntry,
} from '@/lib/sync';
import type { Note } from '@/lib/db';

describe('computeDiff', () => {
  // Note: computeDiff currently does not handle deletion tombstones;
  // missing-note behavior here reflects additive sync only.
  it('requests notes present in peerManifest but missing locally', () => {
    const local: ManifestEntry[] = [
      { noteId: 'note-1', contentHash: 'h1', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const peer: ManifestEntry[] = [
      { noteId: 'note-1', contentHash: 'h1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { noteId: 'note-2', contentHash: 'h2', updatedAt: '2026-01-02T00:00:00.000Z' },
    ];

    expect(computeDiff(local, peer)).toEqual(['note-2']);
  });

  it('skips notes with identical contentHash even if updatedAt differs', () => {
    const local: ManifestEntry[] = [
      { noteId: 'note-1', contentHash: 'same-hash', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const peer: ManifestEntry[] = [
      { noteId: 'note-1', contentHash: 'same-hash', updatedAt: '2026-01-05T00:00:00.000Z' },
    ];

    expect(computeDiff(local, peer)).toEqual([]);
  });

  it('requests peer note when contentHash differs and peer timestamp is newer', () => {
    const local: ManifestEntry[] = [
      { noteId: 'note-1', contentHash: 'hash-old', updatedAt: '2026-01-01T10:00:00.000Z' },
    ];
    const peer: ManifestEntry[] = [
      { noteId: 'note-1', contentHash: 'hash-new', updatedAt: '2026-01-01T12:00:00.000Z' },
    ];

    expect(computeDiff(local, peer)).toEqual(['note-1']);
  });

  it('does not request peer note when contentHash differs and peer timestamp is older or equal', () => {
    const local: ManifestEntry[] = [
      { noteId: 'note-older', contentHash: 'hash-a', updatedAt: '2026-01-02T12:00:00.000Z' },
      { noteId: 'note-equal', contentHash: 'hash-b', updatedAt: '2026-01-02T12:00:00.000Z' },
    ];
    const peer: ManifestEntry[] = [
      { noteId: 'note-older', contentHash: 'hash-x', updatedAt: '2026-01-02T10:00:00.000Z' },
      { noteId: 'note-equal', contentHash: 'hash-y', updatedAt: '2026-01-02T12:00:00.000Z' },
    ];

    expect(computeDiff(local, peer)).toEqual([]);
  });

  it('never requests missing or conflicting peer notes with far-future or invalid timestamps, while honoring allowed skew', () => {
    const now = Date.UTC(2026, 10, 28, 12, 0, 0);
    const local: ManifestEntry[] = [
      { noteId: 'existing-valid', contentHash: 'h-local', updatedAt: new Date(now - 60_000).toISOString() },
      { noteId: 'existing-skew', contentHash: 'h-local-2', updatedAt: new Date(now - 10_000).toISOString() },
    ];
    const peer: ManifestEntry[] = [
      {
        noteId: 'existing-valid',
        contentHash: 'h-far-future',
        updatedAt: new Date(now + MAX_FUTURE_CLOCK_SKEW_MS + 1).toISOString(),
      },
      {
        noteId: 'missing-far-future',
        contentHash: 'h-9999',
        updatedAt: '9999-12-31T23:59:59.999Z',
      },
      {
        noteId: 'missing-malformed',
        contentHash: 'h-bad',
        updatedAt: '2026-01-01',
      },
      {
        noteId: 'existing-skew',
        contentHash: 'h-skew-new',
        updatedAt: new Date(now + MAX_FUTURE_CLOCK_SKEW_MS).toISOString(),
      },
      {
        noteId: 'missing-skew',
        contentHash: 'h-missing-skew',
        updatedAt: new Date(now + 60_000).toISOString(),
      },
    ];

    expect(computeDiff(local, peer, now)).toEqual(['existing-skew', 'missing-skew']);
  });
});

describe('compressNote / decompressNote', () => {
  // Note: decompressNote currently lacks payload size limits and runtime schema
  // validation (tracked for security hardening in a later batch).
  it('round-trips a Note with attachments and Unicode content', async () => {
    const note: Note = {
      id: 'note-123',
      title: 'Test Note ✨',
      content: '# Heading\n\nSome **markdown** with math $E=mc^2$ and ![sketch]',
      attachments: {
        sketch: {
          name: 'drawing',
          data: 'data:image/png;base64,iVBORw0KGgo=',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T01:00:00.000Z',
      contentHash: 'abc123',
    };

    const compressed = await compressNote(note);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.byteLength).toBeGreaterThan(0);

    const restored = await decompressNote(compressed);
    expect(restored).toEqual(note);
  });
});
