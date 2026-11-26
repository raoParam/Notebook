import { describe, expect, it } from 'vitest';
import { computeContentHash, generateRoomCode } from '@/lib/hash';
import type { AttachmentEntry } from '@/lib/db';

describe('computeContentHash', () => {
  it('produces deterministic SHA-256 hex output for identical content and attachments', async () => {
    const attachments: Record<string, AttachmentEntry> = {
      diagram: {
        name: 'diagram.png',
        data: 'data:image/png;base64,AAAA',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const hash1 = await computeContentHash('# Hello World\n\nBody text', attachments);
    const hash2 = await computeContentHash('# Hello World\n\nBody text', attachments);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes when content or attachment data changes', async () => {
    const baseAtt: Record<string, AttachmentEntry> = {
      img: {
        name: 'img.png',
        data: 'data:image/png;base64,AAAA',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const changedAtt: Record<string, AttachmentEntry> = {
      img: {
        name: 'img.png',
        data: 'data:image/png;base64,BBBB',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const h1 = await computeContentHash('Note A', baseAtt);
    const h2 = await computeContentHash('Note B', baseAtt);
    const h3 = await computeContentHash('Note A', changedAtt);

    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('is independent of attachment key insertion order', async () => {
    const entryA: AttachmentEntry = {
      name: 'a.png',
      data: 'data:image/png;base64,AAA',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const entryB: AttachmentEntry = {
      name: 'b.png',
      data: 'data:image/png;base64,BBB',
      createdAt: '2026-01-02T00:00:00.000Z',
    };

    const orderAB: Record<string, AttachmentEntry> = { alpha: entryA, beta: entryB };
    const orderBA: Record<string, AttachmentEntry> = { beta: entryB, alpha: entryA };

    const hashAB = await computeContentHash('Same content', orderAB);
    const hashBA = await computeContentHash('Same content', orderBA);

    expect(hashAB).toBe(hashBA);
  });
});

describe('generateRoomCode', () => {
  it('generates a 12-character lowercase alphanumeric code', () => {
    // Note: hash.ts currently uses `b % 36` on random bytes (known modulo bias);
    // this test verifies only the contract (length and allowed charset).
    for (let i = 0; i < 20; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(12);
      expect(code).toMatch(/^[a-z0-9]{12}$/);
    }
  });

  it('generates distinct codes across consecutive calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()));
    expect(codes.size).toBe(20);
  });
});
