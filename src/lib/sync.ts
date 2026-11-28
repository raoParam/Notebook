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

/**
 * Maximum allowed clock skew in the future (5 minutes) for incoming sync
 * timestamps across notes, attachments, manifests, and deletion tombstones.
 *
 * Tolerates typical NTP/RTC clock drift between consumer devices while blocking
 * malicious or misconfigured peers from pinning last-write-wins decisions
 * with far-future timestamps.
 */
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Minimum accepted epoch timestamp (1970-01-01T00:00:00.000Z). */
export const MIN_VALID_TIMESTAMP_MS = 0;

const STRICT_ISO_TIMESTAMP_RE =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

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
      previewOnly?: boolean;
      autoSync?: boolean;
    }
  | {
      type: 'manifest-request';
      sessionId: string;
    }
  | {
      type: 'auto-sync-pref';
      enabled: boolean;
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
  | {
      type: 'tombstone';
      noteId: string;
      deletedAt: string;
      deletionId: string;
    }
  | {
      type: 'tombstone-ack';
      noteId: string;
      deletionId: string;
      outcome?: 'applied' | 'superseded';
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

function resolveNowMs(now: number): number {
  return Number.isFinite(now) ? now : Date.now();
}

/**
 * Parse a strict ISO-8601 date-time string with an explicit timezone (`Z` or `±HH:MM`)
 * into Unix epoch milliseconds. Rejects loose `Date.parse` formats (such as date-only
 * strings, missing timezones, non-ISO words, calendar rollovers, or pre-epoch dates).
 */
export function parseStrictIsoTimestampMs(value: unknown): number | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_TIMESTAMP_LENGTH
  ) {
    return null;
  }
  const match = STRICT_ISO_TIMESTAMP_RE.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < MIN_VALID_TIMESTAMP_MS) {
    return null;
  }
  return ms;
}

/**
 * Parse an untrusted sync timestamp and enforce the timestamp trust policy:
 * strict ISO-8601 with explicit timezone, `>= MIN_VALID_TIMESTAMP_MS`, and
 * `<= now + MAX_FUTURE_CLOCK_SKEW_MS`.
 */
export function parseTrustedTimestampMs(
  value: unknown,
  now: number = Date.now()
): number | null {
  const ms = parseStrictIsoTimestampMs(value);
  if (ms === null) {
    return null;
  }
  const maxAllowedMs = resolveNowMs(now) + MAX_FUTURE_CLOCK_SKEW_MS;
  if (ms > maxAllowedMs) {
    return null;
  }
  return ms;
}

/** Check whether a value is a valid, trusted ISO-8601 timestamp within allowed future skew. */
export function isTrustedTimestamp(
  value: unknown,
  now: number = Date.now()
): value is string {
  return parseTrustedTimestampMs(value, now) !== null;
}

/** Check whether all timestamps on a Note (createdAt, updatedAt, and attachments) satisfy the trust policy. */
export function hasTrustedNoteTimestamps(
  note: Note,
  now: number = Date.now()
): boolean {
  const nowMs = resolveNowMs(now);
  if (
    !isTrustedTimestamp(note.createdAt, nowMs) ||
    !isTrustedTimestamp(note.updatedAt, nowMs)
  ) {
    return false;
  }
  if (!isPlainObject(note.attachments)) {
    return false;
  }
  for (const entry of Object.values(note.attachments)) {
    if (!isPlainObject(entry) || !isTrustedTimestamp(entry.createdAt, nowMs)) {
      return false;
    }
  }
  return true;
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
export function validateNote(raw: unknown, now: number = Date.now()): Note {
  const nowMs = resolveNowMs(now);
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
  if (!isTrustedTimestamp(raw.createdAt, nowMs)) {
    throw new Error('Invalid note createdAt timestamp');
  }
  if (!isTrustedTimestamp(raw.updatedAt, nowMs)) {
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
    if (!isTrustedTimestamp(entry.createdAt, nowMs)) {
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
export function parseSyncMessage(
  data: unknown,
  now: number = Date.now()
): SyncMessage | null {
  const nowMs = resolveNowMs(now);
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
      if (data.previewOnly !== undefined && typeof data.previewOnly !== 'boolean') {
        return null;
      }
      if (data.autoSync !== undefined && typeof data.autoSync !== 'boolean') {
        return null;
      }
      const entries: ManifestEntry[] = [];
      for (const item of data.entries) {
        if (!isPlainObject(item)) return null;
        if (!isValidNoteId(item.noteId)) return null;
        if (!isValidHash(item.contentHash, false)) return null;
        if (
          item.title !== undefined &&
          (typeof item.title !== 'string' ||
            item.title.length > MAX_NOTE_TITLE_LENGTH ||
            hasControlChars(item.title))
        ) {
          return null;
        }
        // Skip individual entries with invalid or far-future timestamps so one
        // problematic note never blocks unrelated valid notes from syncing.
        if (!isTrustedTimestamp(item.updatedAt, nowMs)) {
          continue;
        }
        entries.push({
          noteId: item.noteId,
          contentHash: item.contentHash,
          updatedAt: item.updatedAt,
          ...(item.title !== undefined ? { title: item.title } : {}),
        });
      }
      if (data.entries.length > 0 && entries.length === 0) {
        return null;
      }
      return {
        type: 'manifest',
        entries,
        ...(data.sessionId !== undefined ? { sessionId: data.sessionId } : {}),
        ...(data.wantsManifest !== undefined ? { wantsManifest: data.wantsManifest } : {}),
        ...(data.inReplyTo !== undefined ? { inReplyTo: data.inReplyTo } : {}),
        ...(data.previewOnly !== undefined ? { previewOnly: data.previewOnly } : {}),
        ...(data.autoSync !== undefined ? { autoSync: data.autoSync } : {}),
      };
    }

    case 'manifest-request': {
      if (!isValidNoteId(data.sessionId)) {
        return null;
      }
      return {
        type: 'manifest-request',
        sessionId: data.sessionId,
      };
    }

    case 'auto-sync-pref': {
      if (typeof data.enabled !== 'boolean') {
        return null;
      }
      return {
        type: 'auto-sync-pref',
        enabled: data.enabled,
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

    case 'tombstone': {
      if (!isValidNoteId(data.noteId)) return null;
      if (!isValidNoteId(data.deletionId)) return null;
      if (!isTrustedTimestamp(data.deletedAt, nowMs)) return null;
      return {
        type: 'tombstone',
        noteId: data.noteId,
        deletedAt: data.deletedAt,
        deletionId: data.deletionId,
      };
    }

    case 'tombstone-ack': {
      if (!isValidNoteId(data.noteId)) return null;
      if (!isValidNoteId(data.deletionId)) return null;
      if (
        data.outcome !== undefined &&
        data.outcome !== 'applied' &&
        data.outcome !== 'superseded'
      ) {
        return null;
      }
      return {
        type: 'tombstone-ack',
        noteId: data.noteId,
        deletionId: data.deletionId,
        ...(data.outcome !== undefined ? { outcome: data.outcome } : {}),
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
  title?: string;
}

export type PeerNoteRelation = 'new' | 'updated' | 'identical' | 'local-newer' | 'conflict';

export interface PeerNotePreview {
  noteId: string;
  title: string;
  updatedAt: string;
  contentHash: string;
  relation: PeerNoteRelation;
}

/**
 * Classify notes from a peer manifest relative to the local manifest for manual/selective sync UI.
 * Untrusted or far-future peer timestamps never classify as 'new' or 'updated'.
 */
export function classifyPeerNotes(
  localManifest: ManifestEntry[],
  peerManifest: ManifestEntry[],
  now: number = Date.now()
): PeerNotePreview[] {
  const nowMs = resolveNowMs(now);
  const localMap = new Map(localManifest.map((e) => [e.noteId, e]));
  return peerManifest.map((peer) => {
    const local = localMap.get(peer.noteId);
    const peerTime = parseTrustedTimestampMs(peer.updatedAt, nowMs);
    let relation: PeerNoteRelation;
    if (!local) {
      relation = peerTime === null ? 'conflict' : 'new';
    } else if (local.contentHash === peer.contentHash) {
      relation = 'identical';
    } else if (peerTime === null) {
      relation = 'conflict';
    } else {
      const localTime = parseStrictIsoTimestampMs(local.updatedAt);
      if (localTime === null) {
        relation = 'conflict';
      } else if (peerTime > localTime) {
        relation = 'updated';
      } else if (peerTime < localTime) {
        relation = 'local-newer';
      } else {
        relation = 'conflict';
      }
    }
    return {
      noteId: peer.noteId,
      title: peer.title?.trim() || 'Untitled',
      updatedAt: peer.updatedAt,
      contentHash: peer.contentHash,
      relation,
    };
  });
}

/**
 * Compute a deterministic digest string of a manifest for change-detection in auto-sync.
 */
export function computeManifestDigest(manifest: ManifestEntry[]): string {
  return [...manifest]
    .sort((a, b) => a.noteId.localeCompare(b.noteId))
    .map((e) => `${e.noteId}:${e.contentHash}`)
    .join('|');
}

/**
 * Compare local manifest against peer's manifest.
 * Returns the IDs we need to request from the peer.
 * Peer entries with invalid or far-future timestamps are never requested.
 */
export function computeDiff(
  localManifest: ManifestEntry[],
  peerManifest: ManifestEntry[],
  now: number = Date.now()
): string[] {
  const nowMs = resolveNowMs(now);
  const localMap = new Map(localManifest.map((e) => [e.noteId, e]));
  const toRequest: string[] = [];

  for (const peerEntry of peerManifest) {
    const peerTime = parseTrustedTimestampMs(peerEntry.updatedAt, nowMs);
    if (peerTime === null) {
      // Untrusted, malformed, or far-future peer timestamp must never win LWW or be requested
      continue;
    }

    const local = localMap.get(peerEntry.noteId);
    if (!local) {
      // Missing locally — request it
      toRequest.push(peerEntry.noteId);
    } else if (local.contentHash !== peerEntry.contentHash) {
      // Conflict: last-write-wins by updatedAt
      const localTime = parseStrictIsoTimestampMs(local.updatedAt);
      if (localTime !== null && peerTime > localTime) {
        toRequest.push(peerEntry.noteId);
      }
    }
    // else: identical hash → skip
  }

  return toRequest;
}

/**
 * Count notes present on both devices with identical content hashes (and not transferred).
 * Notes present on only one device or with differing hashes (including equal-timestamp
 * unresolved conflicts) are never counted as unchanged.
 */
export function countUnchangedNotes(
  localManifest: ManifestEntry[],
  peerManifest: ManifestEntry[],
  toRequestFromPeer: string[],
  peerRequestsFromLocal: string[]
): number {
  const transferred = new Set([...toRequestFromPeer, ...peerRequestsFromLocal]);
  const peerMap = new Map(peerManifest.map((e) => [e.noteId, e]));
  let unchanged = 0;
  for (const localEntry of localManifest) {
    if (transferred.has(localEntry.noteId)) continue;
    const peerEntry = peerMap.get(localEntry.noteId);
    if (peerEntry && localEntry.contentHash === peerEntry.contentHash) {
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
export async function decompressNote(
  data: Uint8Array,
  now: number = Date.now()
): Promise<Note> {
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
  return validateNote(parsed, now);
}

/** Build the local manifest from the DB */
export async function buildLocalManifest(db: import('./db').NotebookDB): Promise<ManifestEntry[]> {
  const notes = await db.notes.toArray();
  return notes.map((n) => {
    const sanitizedTitle = n.title.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_NOTE_TITLE_LENGTH);
    return {
      noteId: n.id,
      contentHash: n.contentHash,
      updatedAt: n.updatedAt,
      title: sanitizedTitle,
    };
  });
}
