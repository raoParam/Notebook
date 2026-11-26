import type { AttachmentEntry, Note } from './db';

/** Maximum number of entries accepted in an incoming sync manifest */
export const MAX_MANIFEST_ENTRIES = 10000;
/** Maximum number of note IDs accepted in an incoming request message */
export const MAX_REQUEST_NOTE_IDS = 1000;
/** Maximum compressed payload byte length for a single note */
export const MAX_COMPRESSED_NOTE_BYTES = 4 * 1024 * 1024;
/** Maximum decompressed byte length for a single note */
export const MAX_DECOMPRESSED_NOTE_BYTES = 10 * 1024 * 1024;
/** Maximum character length for a note title */
export const MAX_NOTE_TITLE_LENGTH = 500;
/** Maximum character length for note markdown content */
export const MAX_NOTE_CONTENT_LENGTH = 2 * 1024 * 1024;
/** Maximum number of attachments allowed on a single note */
export const MAX_ATTACHMENTS_PER_NOTE = 50;
/** Maximum string length for a single attachment data URL */
export const MAX_ATTACHMENT_DATA_LENGTH = 5 * 1024 * 1024;

const MAX_ID_LENGTH = 128;
const MAX_HASH_LENGTH = 128;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_ATTACHMENT_NAME_LENGTH = 256;
const MAX_ERROR_MESSAGE_LENGTH = 256;
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_ATTACHMENT_DATA_URL_RE =
  /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;

/** Validated incoming/outgoing sync protocol message */
export type SyncMessage =
  | {
      type: 'manifest';
      entries: ManifestEntry[];
      sessionId?: string;
      wantsManifest?: boolean;
      inReplyTo?: string;
    }
  | { type: 'request'; noteIds: string[]; sessionId?: string }
  | {
      type: 'note';
      payload: Uint8Array;
      sessionId?: string;
      transferId?: string;
      noteId?: string;
    }
  | {
      type: 'ack';
      sessionId: string;
      transferId: string;
      noteId: string;
      ok: boolean;
      error?: string;
    }
  | {
      type: 'note-error';
      sessionId: string;
      noteId: string;
      reason?: string;
    }
  | { type: 'done' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasControlChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function isValidNoteId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value.trim().length > 0 &&
    !hasControlChars(value)
  );
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TIMESTAMP_LENGTH &&
    Number.isFinite(Date.parse(value))
  );
}

function isValidHash(value: unknown, allowEmpty: boolean): value is string {
  if (typeof value !== 'string') return false;
  if (!allowEmpty && value.length === 0) return false;
  return value.length <= MAX_HASH_LENGTH && !hasControlChars(value);
}

function isValidAttachmentKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= MAX_ID_LENGTH &&
    !key.includes(']') &&
    !hasControlChars(key) &&
    !DANGEROUS_OBJECT_KEYS.has(key)
  );
}

/** Check whether a string is a safe base64 raster image data URL within size limits */
export function isSafeAttachmentDataUrl(data: string): boolean {
  return (
    typeof data === 'string' &&
    data.length <= MAX_ATTACHMENT_DATA_LENGTH &&
    SAFE_ATTACHMENT_DATA_URL_RE.test(data)
  );
}

/** Validate and sanitize an untrusted Note object, stripping unexpected properties */
export function validateNote(raw: unknown): Note {
  if (!isPlainObject(raw)) {
    throw new Error('Note must be a plain object');
  }
  if (!isValidNoteId(raw.id)) {
    throw new Error('Invalid note id');
  }
  if (typeof raw.title !== 'string' || raw.title.length > MAX_NOTE_TITLE_LENGTH) {
    throw new Error('Invalid note title');
  }
  if (typeof raw.content !== 'string' || raw.content.length > MAX_NOTE_CONTENT_LENGTH) {
    throw new Error('Invalid note content');
  }
  if (!isValidTimestamp(raw.createdAt)) {
    throw new Error('Invalid note createdAt timestamp');
  }
  if (!isValidTimestamp(raw.updatedAt)) {
    throw new Error('Invalid note updatedAt timestamp');
  }
  if (!isValidHash(raw.contentHash, true)) {
    throw new Error('Invalid note contentHash');
  }
  if (!isPlainObject(raw.attachments)) {
    throw new Error('Invalid note attachments');
  }

  const attachmentKeys = Object.keys(raw.attachments);
  if (attachmentKeys.length > MAX_ATTACHMENTS_PER_NOTE) {
    throw new Error(`Note exceeds maximum attachment count of ${MAX_ATTACHMENTS_PER_NOTE}`);
  }

  const cleanAttachments: Record<string, AttachmentEntry> = {};
  for (const key of attachmentKeys) {
    if (!isValidAttachmentKey(key)) {
      throw new Error('Invalid attachment key');
    }
    const entry = raw.attachments[key];
    if (!isPlainObject(entry)) {
      throw new Error('Attachment entry must be a plain object');
    }
    if (
      typeof entry.name !== 'string' ||
      entry.name.length > MAX_ATTACHMENT_NAME_LENGTH ||
      hasControlChars(entry.name)
    ) {
      throw new Error('Invalid attachment name');
    }
    if (!isValidTimestamp(entry.createdAt)) {
      throw new Error('Invalid attachment createdAt timestamp');
    }
    if (typeof entry.data !== 'string' || !isSafeAttachmentDataUrl(entry.data)) {
      throw new Error('Invalid attachment data URL');
    }
    cleanAttachments[key] = {
      name: entry.name,
      data: entry.data,
      createdAt: entry.createdAt,
    };
  }

  return {
    id: raw.id,
    title: raw.title,
    content: raw.content,
    attachments: cleanAttachments,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    contentHash: raw.contentHash,
  };
}

/** Parse and validate an untrusted incoming sync message */
export function parseSyncMessage(data: unknown): SyncMessage | null {
  if (!isPlainObject(data)) {
    return null;
  }

  switch (data.type) {
    case 'manifest': {
      if (!Array.isArray(data.entries) || data.entries.length > MAX_MANIFEST_ENTRIES) {
        return null;
      }
      if (data.sessionId !== undefined && !isValidNoteId(data.sessionId)) {
        return null;
      }
      if (data.wantsManifest !== undefined && typeof data.wantsManifest !== 'boolean') {
        return null;
      }
      if (data.inReplyTo !== undefined && !isValidNoteId(data.inReplyTo)) {
        return null;
      }
      const entries: ManifestEntry[] = [];
      for (const item of data.entries) {
        if (!isPlainObject(item)) return null;
        if (!isValidNoteId(item.noteId)) return null;
        if (!isValidHash(item.contentHash, false)) return null;
        if (!isValidTimestamp(item.updatedAt)) return null;
        entries.push({
          noteId: item.noteId,
          contentHash: item.contentHash,
          updatedAt: item.updatedAt,
        });
      }
      return {
        type: 'manifest',
        entries,
        ...(data.sessionId !== undefined ? { sessionId: data.sessionId } : {}),
        ...(data.wantsManifest !== undefined ? { wantsManifest: data.wantsManifest } : {}),
        ...(data.inReplyTo !== undefined ? { inReplyTo: data.inReplyTo } : {}),
      };
    }

    case 'request': {
      if (!Array.isArray(data.noteIds) || data.noteIds.length > MAX_REQUEST_NOTE_IDS) {
        return null;
      }
      if (data.sessionId !== undefined && !isValidNoteId(data.sessionId)) {
        return null;
      }
      const noteIds: string[] = [];
      for (const noteId of data.noteIds) {
        if (!isValidNoteId(noteId)) return null;
        noteIds.push(noteId);
      }
      return {
        type: 'request',
        noteIds,
        ...(data.sessionId !== undefined ? { sessionId: data.sessionId } : {}),
      };
    }

    case 'note': {
      if (data.sessionId !== undefined && !isValidNoteId(data.sessionId)) {
        return null;
      }
      if (data.transferId !== undefined && !isValidNoteId(data.transferId)) {
        return null;
      }
      if (data.noteId !== undefined && !isValidNoteId(data.noteId)) {
        return null;
      }
      const extraMeta = {
        ...(data.sessionId !== undefined ? { sessionId: data.sessionId } : {}),
        ...(data.transferId !== undefined ? { transferId: data.transferId } : {}),
        ...(data.noteId !== undefined ? { noteId: data.noteId } : {}),
      };
      const rawPayload = data.payload;
      if (rawPayload instanceof Uint8Array) {
        if (
          rawPayload.byteLength === 0 ||
          rawPayload.byteLength > MAX_COMPRESSED_NOTE_BYTES
        ) {
          return null;
        }
        return { type: 'note', payload: rawPayload, ...extraMeta };
      }

      if (Array.isArray(rawPayload)) {
        if (
          rawPayload.length === 0 ||
          rawPayload.length > MAX_COMPRESSED_NOTE_BYTES
        ) {
          return null;
        }
        const bytes = new Uint8Array(rawPayload.length);
        for (let i = 0; i < rawPayload.length; i++) {
          const byte = rawPayload[i];
          if (
            typeof byte !== 'number' ||
            !Number.isInteger(byte) ||
            byte < 0 ||
            byte > 255
          ) {
            return null;
          }
          bytes[i] = byte;
        }
        return { type: 'note', payload: bytes, ...extraMeta };
      }

      return null;
    }

    case 'ack': {
      if (!isValidNoteId(data.sessionId)) return null;
      if (!isValidNoteId(data.transferId)) return null;
      if (!isValidNoteId(data.noteId)) return null;
      if (typeof data.ok !== 'boolean') return null;
      if (
        data.error !== undefined &&
        (typeof data.error !== 'string' ||
          data.error.length > MAX_ERROR_MESSAGE_LENGTH ||
          hasControlChars(data.error))
      ) {
        return null;
      }
      return {
        type: 'ack',
        sessionId: data.sessionId,
        transferId: data.transferId,
        noteId: data.noteId,
        ok: data.ok,
        ...(data.error !== undefined ? { error: data.error } : {}),
      };
    }

    case 'note-error': {
      if (!isValidNoteId(data.sessionId)) return null;
      if (!isValidNoteId(data.noteId)) return null;
      if (
        data.reason !== undefined &&
        (typeof data.reason !== 'string' ||
          data.reason.length > MAX_ERROR_MESSAGE_LENGTH ||
          hasControlChars(data.reason))
      ) {
        return null;
      }
      return {
        type: 'note-error',
        sessionId: data.sessionId,
        noteId: data.noteId,
        ...(data.reason !== undefined ? { reason: data.reason } : {}),
      };
    }

    case 'done':
      return { type: 'done' };

    default:
      return null;
  }
}

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

/**
 * Count notes across local and peer manifests that are identical or require no transfer.
 */
export function countUnchangedNotes(
  localManifest: ManifestEntry[],
  peerManifest: ManifestEntry[],
  toRequestFromPeer: string[],
  peerRequestsFromLocal: string[]
): number {
  const transferred = new Set([...toRequestFromPeer, ...peerRequestsFromLocal]);
  const allIds = new Set([
    ...localManifest.map((e) => e.noteId),
    ...peerManifest.map((e) => e.noteId),
  ]);
  let unchanged = 0;
  for (const id of allIds) {
    if (!transferred.has(id)) {
      unchanged++;
    }
  }
  return unchanged;
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

/** Decompress and validate a Uint8Array to a Note object */
export async function decompressNote(data: Uint8Array): Promise<Note> {
  if (!(data instanceof Uint8Array)) {
    throw new Error('Compressed note payload must be a Uint8Array');
  }
  if (data.byteLength === 0) {
    throw new Error('Compressed note payload must not be empty');
  }
  if (data.byteLength > MAX_COMPRESSED_NOTE_BYTES) {
    throw new Error(
      `Compressed note payload exceeds maximum size of ${MAX_COMPRESSED_NOTE_BYTES} bytes`
    );
  }

  const stream = new DecompressionStream('gzip' as CompressionFormat);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  let writeError: unknown = null;
  // Write concurrently so backpressure cannot deadlock; capture rejections to avoid unhandled errors.
  const writePromise = (async () => {
    try {
      await writer.write(data as unknown as Uint8Array<ArrayBuffer>);
      await writer.close();
    } catch (err) {
      writeError = err;
    }
  })();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_DECOMPRESSED_NOTE_BYTES) {
        throw new Error(
          `Decompressed note exceeds maximum size of ${MAX_DECOMPRESSED_NOTE_BYTES} bytes`
        );
      }
      chunks.push(value);
    }

    await writePromise;
    if (writeError !== null) {
      throw writeError;
    }
  } catch (err) {
    chunks.length = 0;
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    await writePromise;
    throw err;
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const json = new TextDecoder('utf-8', { fatal: true }).decode(combined);
  const parsed: unknown = JSON.parse(json);
  return validateNote(parsed);
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
