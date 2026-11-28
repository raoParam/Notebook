/**
 * Server-side Metered.ca TURN credential proxy (`GET /api/ice-servers`).
 *
 * Architecture & Security Model:
 * - Notebook has no user accounts or server-side sessions, so this endpoint is
 *   intentionally unauthenticated for same-origin P2P WebRTC clients.
 * - `METERED_APP_NAME` and `METERED_API_KEY` are read exclusively on the server
 *   and never exposed to client bundles, HTTP responses, or error logs.
 *
 * Lightweight Server-Side Protections (Vercel / Serverless):
 * - Exports only `GET` and `dynamic = 'force-dynamic'` (rejects other methods;
 *   never statically prerendered at build time).
 * - Responds with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
 *   and `Vary: Sec-Fetch-Site` so CDN/shared caches never persist TURN credentials.
 * - Blocks obvious cross-site browser requests (`Sec-Fetch-Site: cross-site`)
 *   with HTTP 403 while permitting same-origin fetches, direct requests, and SSR/tests.
 * - Validates `METERED_APP_NAME` as a strict DNS label, disables HTTP redirects
 *   (`redirect: 'error'`), bounds response parsing to 64 KB under a 5s timeout,
 *   and sanitizes/deduplicates ICE server entries.
 * - Uses per-instance single-flight request coalescing and bounded memory caching
 *   (<= 10 minutes, clamped to upstream `ttl` minus a 30s safety buffer) solely
 *   to reduce redundant upstream bursts on warm instances.
 *   NOTE: Serverless memory is NOT shared across instances or cold starts and does
 *   not provide global rate limiting.
 *
 * Required External Safeguards (cannot be enforced in serverless module memory):
 * 1. Metered.ca Provider Dashboard:
 *    - Configure a short TURN credential expiry / TTL (e.g. 5-15 minutes).
 *    - Restrict allowed domains / Origin / Referer where supported.
 *    - Enable API request rate limits on the credential endpoint.
 *    - Configure bandwidth/relay quotas and hard monthly usage/billing caps.
 *    - Rotate `METERED_API_KEY` immediately if abuse is suspected.
 * 2. Vercel Edge / WAF & Environment Configuration:
 *    - Apply Vercel Firewall / Edge Rate Limiting per IP on `/api/ice-servers`.
 *    - Enable Bot Protection / Attack Challenge Mode if automated scraping occurs.
 *    - Store `METERED_APP_NAME` and `METERED_API_KEY` as server-only encrypted
 *      environment variables (never `NEXT_PUBLIC_*`).
 */

import { NextResponse } from 'next/server';
import {
  FALLBACK_ICE_SERVERS,
  readBoundedJson,
  sanitizeIceServers,
  type IceServer,
} from '../../../lib/turn';

export const dynamic = 'force-dynamic';

const METERED_APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_EXPIRY_BUFFER_MS = 30 * 1000; // Refresh before upstream credential TTL expires
const UPSTREAM_TIMEOUT_MS = 5_000;

let cachedServers: IceServer[] | null = null;
let cachedAppName: string | null = null;
let cacheExpiry = 0;
let inFlightFetch: { appName: string; promise: Promise<IceServer[]> } | null = null;

function jsonNoStore(servers: IceServer[]): NextResponse<IceServer[]> {
  return NextResponse.json(servers, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Sec-Fetch-Site',
    },
  });
}

function resolveCacheTtlMs(payload: unknown): number {
  if (!Array.isArray(payload)) {
    return DEFAULT_CACHE_TTL_MS;
  }

  let minUpstreamTtlSeconds: number | null = null;
  for (const item of payload) {
    if (
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      Object.hasOwn(item, 'ttl')
    ) {
      const rawTtl = (item as Record<string, unknown>).ttl;
      if (typeof rawTtl === 'number' && Number.isFinite(rawTtl) && rawTtl > 0) {
        minUpstreamTtlSeconds =
          minUpstreamTtlSeconds === null ? rawTtl : Math.min(minUpstreamTtlSeconds, rawTtl);
      }
    }
  }

  if (minUpstreamTtlSeconds === null) {
    return DEFAULT_CACHE_TTL_MS;
  }

  const bufferedMs = minUpstreamTtlSeconds * 1000 - CACHE_EXPIRY_BUFFER_MS;
  if (bufferedMs <= 0) {
    return 0;
  }

  return Math.min(DEFAULT_CACHE_TTL_MS, bufferedMs);
}

function appendUniqueFallbacks(validServers: IceServer[]): IceServer[] {
  const existingSingleUrls = new Set<string>();
  for (const server of validServers) {
    if (typeof server.urls === 'string') {
      existingSingleUrls.add(server.urls);
    } else {
      for (const uri of server.urls) {
        existingSingleUrls.add(uri);
      }
    }
  }

  const extraFallbacks = FALLBACK_ICE_SERVERS.filter(
    (fallback) => typeof fallback.urls === 'string' && !existingSingleUrls.has(fallback.urls),
  );

  return [...validServers, ...extraFallbacks];
}

async function fetchUpstreamIceServers(appName: string, apiKey: string): Promise<IceServer[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    });

    if (!res.ok) {
      void res.body?.cancel?.().catch(() => {});
      console.error(`[ice-servers] TURN provider responded with status ${res.status}`);
      return FALLBACK_ICE_SERVERS;
    }

    const payload = await readBoundedJson(res, controller.signal);
    const validServers = sanitizeIceServers(payload);

    if (validServers.length === 0) {
      console.warn('[ice-servers] Invalid TURN provider response, falling back to STUN-only');
      return FALLBACK_ICE_SERVERS;
    }

    const servers = appendUniqueFallbacks(validServers);
    const ttlMs = resolveCacheTtlMs(payload);

    if (ttlMs > 0) {
      cachedServers = servers;
      cachedAppName = appName;
      cacheExpiry = Date.now() + ttlMs;
    }

    return servers;
  } catch (err) {
    // Log only a sanitized error name so upstream URLs containing apiKey are never emitted to logs.
    const rawName = err instanceof Error ? err.name : 'UnknownError';
    const safeName = /^[A-Za-z0-9_.-]{1,64}$/.test(rawName) ? rawName : 'Error';
    console.error(`[ice-servers] Failed to fetch TURN credentials (${safeName})`);
    return FALLBACK_ICE_SERVERS;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request?: Request): Promise<NextResponse<IceServer[] | { error: string }>> {
  const secFetchSite = request?.headers?.get?.('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return NextResponse.json(
      { error: 'Cross-site requests are not allowed' },
      {
        status: 403,
        headers: {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          Vary: 'Sec-Fetch-Site',
        },
      },
    );
  }

  const appName = process.env.METERED_APP_NAME?.trim();
  const apiKey = process.env.METERED_API_KEY?.trim();

  if (!appName || !apiKey) {
    console.warn('[ice-servers] TURN credentials not configured, falling back to STUN-only');
    return jsonNoStore(FALLBACK_ICE_SERVERS);
  }

  if (!METERED_APP_NAME_PATTERN.test(appName) || CONTROL_CHARS_PATTERN.test(apiKey)) {
    console.warn('[ice-servers] Invalid Metered configuration format, falling back to STUN-only');
    return jsonNoStore(FALLBACK_ICE_SERVERS);
  }

  if (cachedServers && cachedAppName === appName && Date.now() < cacheExpiry) {
    return jsonNoStore(cachedServers);
  }

  if (typeof fetch !== 'function') {
    console.warn('[ice-servers] Global fetch unavailable, falling back to STUN-only');
    return jsonNoStore(FALLBACK_ICE_SERVERS);
  }

  if (inFlightFetch && inFlightFetch.appName === appName) {
    const servers = await inFlightFetch.promise;
    return jsonNoStore(servers);
  }

  const promise = fetchUpstreamIceServers(appName, apiKey).finally(() => {
    if (inFlightFetch?.promise === promise) {
      inFlightFetch = null;
    }
  });
  inFlightFetch = { appName, promise };

  const servers = await promise;
  return jsonNoStore(servers);
}
