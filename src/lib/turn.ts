/**
 * Fetches TURN/STUN ICE server credentials from Metered.ca's API.
 *
 * Provides TURN relay servers so WebRTC connections work across
 * mobile data (4G/5G), symmetric NATs, and corporate firewalls.
 *
 * Credentials are read exclusively from environment variables:
 *   NEXT_PUBLIC_METERED_APP_NAME
 *   NEXT_PUBLIC_METERED_API_KEY
 * If either is unset, the app logs a warning and falls back to STUN-only.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

let cachedServers: IceServer[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function getIceServers(): Promise<IceServer[]> {
  if (cachedServers && Date.now() < cacheExpiry) {
    return cachedServers;
  }

  const appName = process.env.NEXT_PUBLIC_METERED_APP_NAME;
  const apiKey = process.env.NEXT_PUBLIC_METERED_API_KEY;

  if (!appName || !apiKey) {
    console.warn('TURN credentials not configured, falling back to STUN-only');
    return FALLBACK_ICE_SERVERS;
  }

  try {
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Metered API responded with ${res.status}`);
    }

    const servers: IceServer[] = await res.json();
    cachedServers = [...servers, ...FALLBACK_ICE_SERVERS];
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return cachedServers;
  } catch (err) {
    console.error('[turn] Failed to fetch TURN credentials:', err);
    return FALLBACK_ICE_SERVERS;
  }
}
