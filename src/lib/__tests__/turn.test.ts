import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IceServer } from '../turn';

const EXPECTED_FALLBACK: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

function collectConsoleMessages(
  warnSpy: ReturnType<typeof vi.spyOn>,
  errorSpy: ReturnType<typeof vi.spyOn>,
): string {
  return [...warnSpy.mock.calls, ...errorSpy.mock.calls]
    .flat()
    .map((entry) => String(entry))
    .join('\n');
}

describe('/api/ice-servers route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('exports only valid Next.js Route Handler symbols', async () => {
    const routeModule = await import('../../app/api/ice-servers/route');
    expect(Object.keys(routeModule).sort()).toEqual(['GET', 'dynamic']);
    expect(routeModule.dynamic).toBe('force-dynamic');
    expect(typeof routeModule.GET).toBe('function');
  });

  it('returns STUN fallback without calling fetch when env vars are missing', async () => {
    vi.stubEnv('METERED_APP_NAME', '');
    vi.stubEnv('METERED_API_KEY', '');

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();
    const body = (await response.json()) as IceServer[];

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual(EXPECTED_FALLBACK);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain('METERED_API_KEY');
  });

  it('never leaks API key or calls fetch when METERED_APP_NAME is missing or invalid', async () => {
    const secretKey = 'secret-metered-key-xyz';
    vi.stubEnv('METERED_APP_NAME', 'evil.example.com/path#');
    vi.stubEnv('METERED_API_KEY', secretKey);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();
    const rawText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(rawText)).toEqual(EXPECTED_FALLBACK);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rawText).not.toContain(secretKey);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(secretKey);
  });

  it('returns STUN fallback and never logs API key on provider HTTP failure', async () => {
    const secretKey = 'super-secret-http-failure-key';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`Unauthorized apiKey=${secretKey}`, { status: 401 }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();
    const rawText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(rawText)).toEqual(EXPECTED_FALLBACK);
    expect(rawText).not.toContain(secretKey);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(secretKey);
  });

  it('returns STUN fallback and never logs API key on provider network error', async () => {
    const secretKey = 'super-secret-network-failure-key';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError(
        `fetch failed for https://notebook-app.metered.live/api/v1/turn/credentials?apiKey=${secretKey}`,
      ),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();
    const rawText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(rawText)).toEqual(EXPECTED_FALLBACK);
    expect(rawText).not.toContain(secretKey);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(secretKey);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('TypeError'));
  });

  it('returns STUN fallback when upstream request times out', async () => {
    vi.useFakeTimers();
    const secretKey = 'super-secret-timeout-key';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          const abortError = new Error(`Timed out for apiKey=${secretKey}`);
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const pendingResponse = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pendingResponse;
    const body = (await response.json()) as IceServer[];

    expect(response.status).toBe(200);
    expect(body).toEqual(EXPECTED_FALLBACK);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(secretKey);
  });

  it.each([
    { label: 'non-array object', payload: { error: 'invalid' } },
    { label: 'null', payload: null },
    { label: 'invalid schemes', payload: [{ urls: 'https://evil.example.com' }] },
    { label: 'mixed array with invalid scheme', payload: [{ urls: ['turn:ok.example.com:80', 'javascript:alert(1)'] }] },
    { label: 'empty scheme', payload: [{ urls: 'stun:' }] },
    { label: 'missing urls', payload: [{ username: 'u', credential: 'p' }] },
    { label: 'empty urls array', payload: [{ urls: [] }] },
    { label: 'non-string username', payload: [{ urls: 'turn:ok.example.com:80', username: 42 }] },
  ])('returns STUN fallback on invalid provider response ($label)', async ({ payload }) => {
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', 'valid-secret-key');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();
    const body = (await response.json()) as IceServer[];

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual(EXPECTED_FALLBACK);
  });

  it('sanitizes valid ICE server responses, appends STUN fallback, and caches for 10 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const secretKey = 'my+secret/key';
    vi.stubEnv('METERED_APP_NAME', 'my-app-1');
    vi.stubEnv('METERED_API_KEY', secretKey);

    const providerPayload = [
      { urls: 'stun:stun.relay.metered.ca:80', unexpected: 'strip-me' },
      {
        urls: ['turn:global.relay.metered.ca:80', 'turns:global.relay.metered.ca:443?transport=tcp'],
        username: 'user-1',
        credential: 'pass-1',
        ttl: 3600,
      },
      { urls: 'http://malicious.example.com' },
    ];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(providerPayload), { status: 200 });
    });

    const { GET } = await import('../../app/api/ice-servers/route');

    const firstRes = await GET();
    const firstBody = (await firstRes.json()) as IceServer[];

    const expectedSanitized: IceServer[] = [
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: ['turn:global.relay.metered.ca:80', 'turns:global.relay.metered.ca:443?transport=tcp'],
        username: 'user-1',
        credential: 'pass-1',
      },
      ...EXPECTED_FALLBACK,
    ];

    expect(firstRes.status).toBe(200);
    expect(firstRes.headers.get('cache-control')).toBe('no-store');
    expect(firstBody).toEqual(expectedSanitized);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://my-app-1.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(secretKey)}`,
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );

    // Second call within 10 minutes uses server memory cache
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    const secondRes = await GET();
    const secondBody = (await secondRes.json()) as IceServer[];

    expect(secondBody).toEqual(expectedSanitized);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Call after 10 minute TTL expires fetches fresh credentials
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    const thirdRes = await GET();
    const thirdBody = (await thirdRes.json()) as IceServer[];

    expect(thirdBody).toEqual(expectedSanitized);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('client getIceServers() in src/lib/turn.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('contains no METERED_API_KEY, METERED_APP_NAME, or NEXT_PUBLIC_METERED_ references', () => {
    const turnSource = fs.readFileSync(new URL('../turn.ts', import.meta.url), 'utf8');
    expect(turnSource).not.toContain('METERED_API_KEY');
    expect(turnSource).not.toContain('METERED_APP_NAME');
    expect(turnSource).not.toContain('NEXT_PUBLIC_METERED_');
  });

  it('fetches /api/ice-servers, validates response, and caches for 10 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const serverResponse = [
      {
        urls: 'turn:global.relay.metered.ca:80',
        username: 'client-user',
        credential: 'client-pass',
        extra: 'ignore',
      },
      ...EXPECTED_FALLBACK,
    ];

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(serverResponse), { status: 200 });
    });

    const { getIceServers } = await import('../turn');

    const first = await getIceServers();
    expect(first).toEqual([
      {
        urls: 'turn:global.relay.metered.ca:80',
        username: 'client-user',
        credential: 'client-pass',
      },
      ...EXPECTED_FALLBACK,
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/ice-servers',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    const second = await getIceServers();
    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await getIceServers();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to FALLBACK_ICE_SERVERS on HTTP error, relative fetch failure, or invalid payload without caching failures', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Server error', { status: 500 }))
      .mockRejectedValueOnce(new TypeError('Failed to parse URL from /api/ice-servers'))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ urls: 'http://invalid' }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ urls: 'turn:recovered.example.com:3478', username: 'u', credential: 'c' }]), {
          status: 200,
        }),
      );

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { FALLBACK_ICE_SERVERS, getIceServers } = await import('../turn');

    expect(await getIceServers()).toEqual(FALLBACK_ICE_SERVERS);
    expect(await getIceServers()).toEqual(FALLBACK_ICE_SERVERS);
    expect(await getIceServers()).toEqual(FALLBACK_ICE_SERVERS);

    // Failures must not have been cached, so a subsequent healthy response succeeds
    expect(await getIceServers()).toEqual([
      { urls: 'turn:recovered.example.com:3478', username: 'u', credential: 'c' },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
