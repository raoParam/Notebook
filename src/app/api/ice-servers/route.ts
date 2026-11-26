import { NextResponse } from 'next/server';
import {
  FALLBACK_ICE_SERVERS,
  sanitizeIceServers,
  type IceServer,
} from '../../../lib/turn';

export const dynamic = 'force-dynamic';

const METERED_APP_NAME_PATTERN = /^[a-z0-9-]+$/i;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const UPSTREAM_TIMEOUT_MS = 5_000;

let cachedServers: IceServer[] | null = null;
let cacheExpiry = 0;

function jsonNoStore(servers: IceServer[]): NextResponse<IceServer[]> {
  return NextResponse.json(servers, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(): Promise<NextResponse<IceServer[]>> {
  const appName = process.env.METERED_APP_NAME?.trim();
  const apiKey = process.env.METERED_API_KEY?.trim();

  if (!appName || !apiKey) {
    console.warn('[ice-servers] TURN credentials not configured, falling back to STUN-only');
    return jsonNoStore(FALLBACK_ICE_SERVERS);
  }

  if (!METERED_APP_NAME_PATTERN.test(appName)) {
    console.warn('[ice-servers] Invalid METERED_APP_NAME format, falling back to STUN-only');
    return jsonNoStore(FALLBACK_ICE_SERVERS);
  }

  if (cachedServers && Date.now() < cacheExpiry) {
    return jsonNoStore(cachedServers);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[ice-servers] TURN provider responded with status ${res.status}`);
      return jsonNoStore(FALLBACK_ICE_SERVERS);
    }

    const payload: unknown = await res.json();
    const validServers = sanitizeIceServers(payload);

    if (validServers.length === 0) {
      console.warn('[ice-servers] Invalid TURN provider response, falling back to STUN-only');
      return jsonNoStore(FALLBACK_ICE_SERVERS);
    }

    const servers = [...validServers, ...FALLBACK_ICE_SERVERS];
    cachedServers = servers;
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return jsonNoStore(servers);
  } catch (err) {
    // Log only the error name so upstream URLs containing apiKey are never emitted to logs.
    const errorName = err instanceof Error ? err.name : 'UnknownError';
    console.error(`[ice-servers] Failed to fetch TURN credentials (${errorName})`);
    return jsonNoStore(FALLBACK_ICE_SERVERS);
  } finally {
    clearTimeout(timeoutId);
  }
}
