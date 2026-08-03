import type { Note } from './db';

/** Manifest entry sent during sync handshake */
export interface ManifestEntry {
  noteId: string;
  contentHash: string;
  updatedAt: string;
}

/** Diff result describing what to request from the peer */
export interface SyncDiff {
  /** Note IDs to request full data for (missing locally or peer is newer) */
  toRequest: string[];
  /** Notes to send to peer (we are newer or peer is missing them) — determined by peer's diff */
  toSend: string[];
}

/** Result of a completed sync operation */
export interface SyncResult {
  received: number;
  sent: number;
  unchanged: number;
}

/**
 * Compare local manifest against peer's manifest.
 * Returns the IDs we need to request from the peer.
 */
export function computeDiff(
  localManifest: ManifestEntry[],
  peerManifest: ManifestEntry[]
): string[] {
  const localMap = new Map(localManifest.map((e) => [e.noteId, e]));
  const toRequest: string[] = [];

  for (const peerEntry of peerManifest) {
    const local = localMap.get(peerEntry.noteId);
    if (!local) {
      // Missing locally — request it
      toRequest.push(peerEntry.noteId);
    } else if (local.contentHash !== peerEntry.contentHash) {
      // Conflict: last-write-wins by updatedAt
      const localTime = new Date(local.updatedAt).getTime();
      const peerTime = new Date(peerEntry.updatedAt).getTime();
      if (peerTime > localTime) {
        toRequest.push(peerEntry.noteId);
      }
    }
    // else: identical hash → skip
  }

  return toRequest;
}

/** Compress a Note object to a Uint8Array using CompressionStream (gzip) */
export async function compressNote(note: Note): Promise<Uint8Array> {
  const json = JSON.stringify(note);
  const stream = new CompressionStream('gzip' as CompressionFormat);
  const writer = stream.writable.getWriter();
  const encoded = new TextEncoder().encode(json);
  writer.write(encoded as unknown as Uint8Array<ArrayBuffer>);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Decompress a Uint8Array to a Note object */
export async function decompressNote(data: Uint8Array): Promise<Note> {
  const stream = new DecompressionStream('gzip' as CompressionFormat);
  const writer = stream.writable.getWriter();
  writer.write(data as unknown as Uint8Array<ArrayBuffer>);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const json = new TextDecoder().decode(combined);
  return JSON.parse(json) as Note;
}

/** Build the local manifest from the DB */
export async function buildLocalManifest(db: import('./db').NotebookDB): Promise<ManifestEntry[]> {
  const notes = await db.notes.toArray();
  return notes.map((n) => ({
    noteId: n.id,
    contentHash: n.contentHash,
    updatedAt: n.updatedAt,
  }));
}
