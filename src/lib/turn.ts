/**
 * Client-side ICE (STUN/TURN) server loader.
 *
 * Fetches sanitized TURN/STUN server configuration from the app's server-side
 * `/api/ice-servers` endpoint and caches valid responses in memory for 10 minutes.
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

const ICE_URI_PATTERN = /^(?:stun|turns?):[^/\s]\S*$/i;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLIENT_FETCH_TIMEOUT_MS = 8_000;

let cachedServers: IceServer[] | null = null;
let cacheExpiry = 0;

function isValidIceUri(value: unknown): value is string {
  return typeof value === 'string' && ICE_URI_PATTERN.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates and sanitizes an untrusted ICE server list.
 * Drops malformed entries and strips any non-IceServer properties.
 */
export function sanitizeIceServers(data: unknown): IceServer[] {
  if (!Array.isArray(data)) {
    return [];
  }

  const sanitized: IceServer[] = [];

  for (const item of data) {
    if (!isPlainRecord(item)) {
      continue;
    }

    const { urls, username, credential } = item;

    let normalizedUrls: string | string[];
    if (isValidIceUri(urls)) {
      normalizedUrls = urls;
    } else if (Array.isArray(urls) && urls.length > 0 && urls.every(isValidIceUri)) {
      normalizedUrls = [...urls];
    } else {
      continue;
    }

    if (username !== undefined && typeof username !== 'string') {
      continue;
    }
    if (credential !== undefined && typeof credential !== 'string') {
      continue;
    }

    const entry: IceServer = { urls: normalizedUrls };
    if (username !== undefined) {
      entry.username = username;
    }
    if (credential !== undefined) {
      entry.credential = credential;
    }

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch('/api/ice-servers', {
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[turn] ICE server endpoint responded with status ${res.status}`);
      return FALLBACK_ICE_SERVERS;
    }

    const payload: unknown = await res.json();
    const servers = sanitizeIceServers(payload);

    if (servers.length === 0) {
      console.warn('[turn] ICE server endpoint returned no valid entries, falling back to STUN-only');
      return FALLBACK_ICE_SERVERS;
    }

    cachedServers = servers;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return cachedServers;
  } catch (err) {
    const errorName = err instanceof Error ? err.name : 'UnknownError';
    console.warn(`[turn] Failed to load ICE servers (${errorName}), falling back to STUN-only`);
    return FALLBACK_ICE_SERVERS;
  } finally {
    clearTimeout(timeoutId);
  }
}
