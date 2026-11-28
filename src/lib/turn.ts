/**
 * Client-side ICE (STUN/TURN) server loader and shared ICE validation helpers.
 *
 * Fetches sanitized TURN/STUN server configuration from the app's server-side
 * `/api/ice-servers` endpoint, coalesces concurrent in-flight requests, and
 * caches valid responses in memory for up to 10 minutes (bounded by the server's
 * `X-Ice-Servers-TTL` remaining credential lifetime header).
 * Falls back to public Google STUN servers if the endpoint is unavailable, times out,
 * returns invalid data, or cannot be reached via relative URL (e.g. during SSR).
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

const MAX_ICE_SERVERS = 32;
const MAX_URLS_PER_SERVER = 16;
const MAX_ICE_URI_LENGTH = 512;
const MAX_CREDENTIAL_LENGTH = 512;
const MAX_RESPONSE_BYTES = 64 * 1024; // 64 KB
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;
const WHITESPACE_OR_CONTROL_PATTERN = /[\s\u0000-\u001F\u007F]/;
const ICE_URI_PATTERN =
  /^(?:stuns?|turns?):(?:\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?(?:\?transport=(?:udp|tcp))?$/i;

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MIN_CLIENT_CACHE_TTL_MS = 10 * 1000; // Do not cache credentials with < 10s remaining lifetime
const CLIENT_FETCH_TIMEOUT_MS = 8_000;

/**
 * Response header used by `/api/ice-servers` to communicate remaining credential
 * validity in integer seconds while preserving `Cache-Control: no-store`.
 */
export const ICE_SERVERS_TTL_HEADER = 'X-Ice-Servers-TTL';

let cachedServers: IceServer[] | null = null;
let cacheExpiry = 0;
let inFlightRequest: Promise<IceServer[]> | null = null;

function resolveClientCacheTtlMs(res: Response): number {
  const rawHeader = res.headers?.get?.(ICE_SERVERS_TTL_HEADER);
  if (rawHeader === null || rawHeader === undefined) {
    return CACHE_TTL_MS;
  }

  const trimmed = rawHeader.trim();
  if (!/^\d+$/.test(trimmed)) {
    return 0;
  }

  const ttlSeconds = Number(trimmed);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return 0;
  }

  const ttlMs = Math.min(CACHE_TTL_MS, ttlSeconds * 1000);
  return ttlMs >= MIN_CLIENT_CACHE_TTL_MS ? ttlMs : 0;
}

function isValidIceUri(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ICE_URI_LENGTH ||
    CONTROL_CHARS_PATTERN.test(value)
  ) {
    return false;
  }

  const match = ICE_URI_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  // Reject consecutive dots in hostnames (e.g., stun:bad..example.com)
  const colonIdx = value.indexOf(':');
  const afterScheme = value.slice(colonIdx + 1);
  if (afterScheme.includes('..')) {
    return false;
  }

  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return false;
    }
  }

  return true;
}

function isValidCredentialField(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CREDENTIAL_LENGTH &&
    !WHITESPACE_OR_CONTROL_PATTERN.test(value)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function createAbortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

/**
 * Reads and parses a JSON Response while enforcing a strict byte limit and
 * respecting AbortSignal throughout body streaming.
 */
export async function readBoundedJson(
  res: Response,
  signal?: AbortSignal,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<unknown> {
  if (signal?.aborted) {
    void res.body?.cancel?.().catch(() => {});
    throw createAbortError();
  }

  const contentLengthHeader = res.headers?.get?.('content-length');
  if (contentLengthHeader !== null && contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      void res.body?.cancel?.().catch(() => {});
      throw new RangeError('Response body exceeds maximum allowed size');
    }
  }

  const body = res.body;
  let text: string;

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let totalBytes = 0;

    let onAbort: (() => void) | undefined;
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          onAbort = () => {
            void reader.cancel().catch(() => {});
            reject(createAbortError());
          };
          signal.addEventListener('abort', onAbort, { once: true });
        })
      : null;

    try {
      while (true) {
        const readPromise = reader.read();
        const { done, value } = abortPromise
          ? await Promise.race([readPromise, abortPromise])
          : await readPromise;

        if (done) {
          break;
        }

        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            void reader.cancel().catch(() => {});
            throw new RangeError('Response body exceeds maximum allowed size');
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
      }
      chunks.push(decoder.decode());
      text = chunks.join('');
    } finally {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      try {
        reader.releaseLock();
      } catch {
        // Ignore if already released/cancelled
      }
    }
  } else {
    let onAbort: (() => void) | undefined;
    const textPromise = res.text();
    try {
      text = signal
        ? await Promise.race([
            textPromise,
            new Promise<never>((_, reject) => {
              onAbort = () => reject(createAbortError());
              signal.addEventListener('abort', onAbort, { once: true });
            }),
          ])
        : await textPromise;
    } finally {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }

    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new RangeError('Response body exceeds maximum allowed size');
    }
  }

  return JSON.parse(text) as unknown;
}

/**
 * Validates and sanitizes an untrusted ICE server list.
 * Drops malformed entries, strips non-IceServer properties, and deduplicates entries.
 */
export function sanitizeIceServers(data: unknown): IceServer[] {
  if (!Array.isArray(data) || data.length > MAX_ICE_SERVERS) {
    return [];
  }

  const sanitized: IceServer[] = [];
  const seenEntries = new Set<string>();

  for (const item of data) {
    if (!isPlainRecord(item) || !Object.hasOwn(item, 'urls')) {
      continue;
    }

    const urls = item.urls;
    let normalizedUrls: string | string[];

    if (isValidIceUri(urls)) {
      normalizedUrls = urls;
    } else if (
      Array.isArray(urls) &&
      urls.length > 0 &&
      urls.length <= MAX_URLS_PER_SERVER &&
      urls.every(isValidIceUri)
    ) {
      normalizedUrls = Array.from(new Set(urls));
    } else {
      continue;
    }

    const rawUsername = Object.hasOwn(item, 'username') ? item.username : undefined;
    const rawCredential = Object.hasOwn(item, 'credential') ? item.credential : undefined;

    if (rawUsername !== undefined && !isValidCredentialField(rawUsername)) {
      continue;
    }
    if (rawCredential !== undefined && !isValidCredentialField(rawCredential)) {
      continue;
    }

    const entry: IceServer = { urls: normalizedUrls };
    if (rawUsername !== undefined) {
      entry.username = rawUsername;
    }
    if (rawCredential !== undefined) {
      entry.credential = rawCredential;
    }

    const dedupeKey = JSON.stringify([
      Array.isArray(entry.urls) ? entry.urls : [entry.urls],
      entry.username ?? null,
      entry.credential ?? null,
    ]);

    if (seenEntries.has(dedupeKey)) {
      continue;
    }
    seenEntries.add(dedupeKey);

    sanitized.push(entry);
  }

  return sanitized;
}

export async function getIceServers(): Promise<IceServer[]> {
  if (cachedServers && Date.now() < cacheExpiry) {
    return cachedServers;
  }

  if (typeof fetch !== 'function') {
    return FALLBACK_ICE_SERVERS;
  }

  if (inFlightRequest) {
    return inFlightRequest;
  }

  inFlightRequest = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch('/api/ice-servers', {
        signal: controller.signal,
      });

      if (!res.ok) {
        void res.body?.cancel?.().catch(() => {});
        console.warn(`[turn] ICE server endpoint responded with status ${res.status}`);
        return FALLBACK_ICE_SERVERS;
      }

      const payload = await readBoundedJson(res, controller.signal);
      const servers = sanitizeIceServers(payload);

      if (servers.length === 0) {
        console.warn('[turn] ICE server endpoint returned no valid entries, falling back to STUN-only');
        return FALLBACK_ICE_SERVERS;
      }

      const ttlMs = resolveClientCacheTtlMs(res);
      if (ttlMs > 0) {
        cachedServers = servers;
        cacheExpiry = Date.now() + ttlMs;
      } else {
        cachedServers = null;
        cacheExpiry = 0;
      }

      return servers;
    } catch (err) {
      const rawName = err instanceof Error ? err.name : 'UnknownError';
      const safeName = /^[A-Za-z0-9_.-]{1,64}$/.test(rawName) ? rawName : 'Error';
      console.warn(`[turn] Failed to load ICE servers (${safeName}), falling back to STUN-only`);
      return FALLBACK_ICE_SERVERS;
    } finally {
      clearTimeout(timeoutId);
    }
  })().finally(() => {
    inFlightRequest = null;
  });

  return inFlightRequest;
}
