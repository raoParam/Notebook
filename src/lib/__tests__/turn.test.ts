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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exports only valid Next.js Route Handler symbols', async () => {
    const routeModule = await import('../../app/api/ice-servers/route');
    expect(Object.keys(routeModule).sort()).toEqual(['GET', 'dynamic']);
    expect(routeModule.dynamic).toBe('force-dynamic');
    expect(typeof routeModule.GET).toBe('function');
  }, 15_000);

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

  it('rejects cross-site browser requests via Sec-Fetch-Site without calling Metered', async () => {
    const secretKey = 'secret-cross-site-key';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { GET } = await import('../../app/api/ice-servers/route');

    const crossSiteReq = new Request('https://notebook.example.com/api/ice-servers', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    const blockedRes = await GET(crossSiteReq);
    const blockedText = await blockedRes.text();

    expect(blockedRes.status).toBe(403);
    expect(blockedRes.headers.get('cache-control')).toBe('no-store');
    expect(blockedRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(blockedRes.headers.get('vary')).toBe('Sec-Fetch-Site');
    expect(blockedText).not.toContain(secretKey);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{ urls: 'turn:ok.example.com:3478', username: 'u', credential: 'c' }]), {
        status: 200,
      }),
    );
    const sameOriginReq = new Request('https://notebook.example.com/api/ice-servers', {
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    const allowedRes = await GET(sameOriginReq);
    expect(allowedRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: 'leading hyphen', appName: '-notebook', apiKey: 'valid-key' },
    { label: 'trailing hyphen', appName: 'notebook-', apiKey: 'valid-key' },
    { label: 'over 63 chars', appName: 'a'.repeat(64), apiKey: 'valid-key' },
    { label: 'control char in apiKey', appName: 'notebook-app', apiKey: 'key\ninjected' },
  ])('falls back without calling fetch on invalid config ($label)', async ({ appName, apiKey }) => {
    vi.stubEnv('METERED_APP_NAME', appName);
    vi.stubEnv('METERED_API_KEY', apiKey);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();
    const rawText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(rawText)).toEqual(EXPECTED_FALLBACK);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rawText).not.toContain(apiKey);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(apiKey);
  });

  it('does not cache upstream HTTP 5xx failures and never leaks secrets', async () => {
    const secretKey = 'secret-5xx-key';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(`Upstream error apiKey=${secretKey}`, { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ urls: 'turn:recovered.example.com:3478', username: 'u', credential: 'c' }]), {
          status: 200,
        }),
      );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');

    const firstRes = await GET();
    expect(await firstRes.json()).toEqual(EXPECTED_FALLBACK);

    const secondRes = await GET();
    expect(await secondRes.json()).toEqual([
      { urls: 'turn:recovered.example.com:3478', username: 'u', credential: 'c' },
      ...EXPECTED_FALLBACK,
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(secretKey);
  });

  it('sanitizes error names so secrets embedded in error objects never reach logs', async () => {
    const secretKey = 'secret-in-error-name';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    const weirdError = new Error('boom');
    weirdError.name = `FetchError https://notebook-app.metered.live?apiKey=${secretKey}`;
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(weirdError);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EXPECTED_FALLBACK);
    const logs = collectConsoleMessages(warnSpy, errorSpy);
    expect(logs).not.toContain(secretKey);
    expect(logs).not.toContain('metered.live');
  });

  it('falls back on non-JSON upstream body and does not cache the failure', async () => {
    const secretKey = 'secret-non-json-key';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(`<html>bad gateway apiKey=${secretKey}</html>`, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ urls: 'turn:ok.example.com:3478', username: 'u', credential: 'c' }]), {
          status: 200,
        }),
      );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const first = await GET();
    expect(await first.json()).toEqual(EXPECTED_FALLBACK);

    const second = await GET();
    expect(await second.json()).toEqual([
      { urls: 'turn:ok.example.com:3478', username: 'u', credential: 'c' },
      ...EXPECTED_FALLBACK,
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(secretKey);
  });

  it('rejects oversized upstream response bodies (> 64 KB) via Content-Length or stream', async () => {
    const secretKey = 'secret-oversized-body';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    const hugePayload = JSON.stringify([{ urls: 'stun:stun.example.com:3478', pad: 'x'.repeat(70_000) }]);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('[]', {
          status: 200,
          headers: { 'content-length': '100000' },
        }),
      )
      .mockResolvedValueOnce(new Response(hugePayload, { status: 200 }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');

    const res1 = await GET();
    expect(await res1.json()).toEqual(EXPECTED_FALLBACK);

    const res2 = await GET();
    expect(await res2.json()).toEqual(EXPECTED_FALLBACK);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(secretKey);
  });

  it('falls back when upstream times out during response body read', async () => {
    vi.useFakeTimers();
    const secretKey = 'secret-body-timeout';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    const stalledStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('[{"urls":"stun:'));
        // Never closes or finishes until aborted
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(stalledStream, { status: 200 }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pending;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EXPECTED_FALLBACK);
    expect(collectConsoleMessages(warnSpy, errorSpy)).not.toContain(secretKey);
  });

  it.each([
    {
      label: 'excessive entry count',
      payload: Array.from({ length: 33 }, (_, i) => ({ urls: `stun:s${i}.example.com:3478` })),
    },
    {
      label: 'excessive urls array length',
      payload: [{ urls: Array.from({ length: 17 }, (_, i) => `stun:s${i}.example.com:3478`) }],
    },
    {
      label: 'oversized URI',
      payload: [{ urls: `stun:${'a'.repeat(520)}.example.com:3478` }],
    },
    {
      label: 'oversized credential',
      payload: [{ urls: 'turn:ok.example.com:3478', username: 'u', credential: 'c'.repeat(520) }],
    },
    {
      label: 'whitespace in URI',
      payload: [{ urls: 'turn:ok.example.com:3478 extra' }],
    },
    {
      label: 'control character in URI',
      payload: [{ urls: 'turn:ok.example.com:3478\u0000' }],
    },
    {
      label: 'whitespace in username',
      payload: [{ urls: 'turn:ok.example.com:3478', username: 'bad user', credential: 'pass' }],
    },
    {
      label: 'control character in credential',
      payload: [{ urls: 'turn:ok.example.com:3478', username: 'user', credential: 'pass\nline' }],
    },
    {
      label: 'empty credential',
      payload: [{ urls: 'turn:ok.example.com:3478', username: 'user', credential: '' }],
    },
    {
      label: 'authority slashes in ICE URI',
      payload: [{ urls: 'turn://evil.example.com:3478' }],
    },
    {
      label: 'out-of-range port',
      payload: [{ urls: 'turn:ok.example.com:70000' }],
    },
    {
      label: 'zero port',
      payload: [{ urls: 'turn:ok.example.com:0' }],
    },
    {
      label: 'double dots in host',
      payload: [{ urls: 'stun:bad..example.com:3478' }],
    },
    {
      label: 'non-plain Date object',
      payload: [new Date()],
    },
    {
      label: 'object with inherited prototype urls',
      payload: [Object.create({ urls: 'stun:inherited.example.com:3478' })],
    },
  ])('returns STUN fallback on invalid or unsafe provider response ($label)', async ({ payload }) => {
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', 'valid-secret-key');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EXPECTED_FALLBACK);
  });

  it('respects short upstream ttl so cached credentials never outlive provider expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', 'valid-secret-key');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ urls: 'turn:ttl.example.com:3478', username: 'u1', credential: 'c1', ttl: 120 }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ urls: 'turn:ttl.example.com:3478', username: 'u2', credential: 'c2', ttl: 120 }]),
          { status: 200 },
        ),
      );

    const { GET } = await import('../../app/api/ice-servers/route');

    const first = (await (await GET()).json()) as IceServer[];
    expect(first[0]?.username).toBe('u1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Within 90s buffered TTL (120s - 30s buffer) -> served from cache
    await vi.advanceTimersByTimeAsync(60 * 1000);
    const second = (await (await GET()).json()) as IceServer[];
    expect(second[0]?.username).toBe('u1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past 90s buffered TTL -> refreshes before 120s upstream expiry
    await vi.advanceTimersByTimeAsync(35 * 1000);
    const third = (await (await GET()).json()) as IceServer[];
    expect(third[0]?.username).toBe('u2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent in-flight requests within an instance to prevent cache stampede', async () => {
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', 'valid-secret-key');

    let resolveUpstream!: (res: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveUpstream = resolve;
        }),
    );

    const { GET } = await import('../../app/api/ice-servers/route');

    const pendingA = GET();
    const pendingB = GET();
    const pendingC = GET();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveUpstream(
      new Response(JSON.stringify([{ urls: 'turn:coalesced.example.com:3478', username: 'u', credential: 'c' }]), {
        status: 200,
      }),
    );

    const [resA, resB, resC] = await Promise.all([pendingA, pendingB, pendingC]);
    const [bodyA, bodyB, bodyC] = await Promise.all([resA.json(), resB.json(), resC.json()]);

    const expected = [
      { urls: 'turn:coalesced.example.com:3478', username: 'u', credential: 'c' },
      ...EXPECTED_FALLBACK,
    ];
    expect(bodyA).toEqual(expected);
    expect(bodyB).toEqual(expected);
    expect(bodyC).toEqual(expected);
    expect(resA.headers.get('cache-control')).toBe('no-store');
    expect(resB.headers.get('cache-control')).toBe('no-store');
  });

  it('falls back gracefully when global fetch is unavailable', async () => {
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', 'valid-secret-key');
    vi.stubGlobal('fetch', undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { GET } = await import('../../app/api/ice-servers/route');
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(EXPECTED_FALLBACK);
  });
});

describe('sanitizeIceServers() hardening in src/lib/turn.ts', () => {
  it('strips dangerous keys without prototype pollution and deduplicates entries', async () => {
    const { sanitizeIceServers } = await import('../turn');

    const craftedJson =
      '[{"urls":["stun:a.example.com:3478","stun:a.example.com:3478"],"__proto__":{"polluted":true},"constructor":{"bad":true}},' +
      '{"urls":["stun:a.example.com:3478"]},' +
      '{"__proto__":{"urls":"stun:proto.example.com:3478"}},' +
      '{"urls":"turns:[2001:db8::1]:443?transport=tcp","username":"u1","credential":"c1"}]';

    const parsed: unknown = JSON.parse(craftedJson);
    const result = sanitizeIceServers(parsed);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result).toEqual([
      { urls: ['stun:a.example.com:3478'] },
      { urls: 'turns:[2001:db8::1]:443?transport=tcp', username: 'u1', credential: 'c1' },
    ]);
    expect(Object.hasOwn(result[0] as object, '__proto__')).toBe(false);
    expect(Object.hasOwn(result[0] as object, 'constructor')).toBe(false);
  });
});

describe('client getIceServers() in src/lib/turn.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('contains no METERED_API_KEY, METERED_APP_NAME, NEXT_PUBLIC_METERED_, or metered.live references', () => {
    const turnSource = fs.readFileSync(new URL('../turn.ts', import.meta.url), 'utf8');
    expect(turnSource).not.toContain('METERED_API_KEY');
    expect(turnSource).not.toContain('METERED_APP_NAME');
    expect(turnSource).not.toContain('NEXT_PUBLIC_METERED_');
    expect(turnSource).not.toContain('metered.live');
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

  it('coalesces concurrent getIceServers() calls into a single /api/ice-servers fetch', async () => {
    let resolveFetch!: (res: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { getIceServers } = await import('../turn');

    const p1 = getIceServers();
    const p2 = getIceServers();
    const p3 = getIceServers();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(JSON.stringify([{ urls: 'turn:shared.example.com:3478', username: 'u', credential: 'c' }]), {
        status: 200,
      }),
    );

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual([{ urls: 'turn:shared.example.com:3478', username: 'u', credential: 'c' }]);
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it('falls back to FALLBACK_ICE_SERVERS on non-JSON body, oversized body, body timeout, or missing fetch', async () => {
    vi.useFakeTimers();

    const stalledStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('[{"urls":'));
      },
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200, headers: { 'content-length': '99999' } }))
      .mockResolvedValueOnce(new Response(stalledStream, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ urls: 'turn:healthy.example.com:3478', username: 'u', credential: 'c' }]), {
          status: 200,
        }),
      );

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { FALLBACK_ICE_SERVERS, getIceServers } = await import('../turn');

    expect(await getIceServers()).toEqual(FALLBACK_ICE_SERVERS);
    expect(await getIceServers()).toEqual(FALLBACK_ICE_SERVERS);

    const pendingTimeout = getIceServers();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await pendingTimeout).toEqual(FALLBACK_ICE_SERVERS);

    // None of the failures were cached
    expect(await getIceServers()).toEqual([
      { urls: 'turn:healthy.example.com:3478', username: 'u', credential: 'c' },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    vi.resetModules();
    vi.stubGlobal('fetch', undefined);
    const { FALLBACK_ICE_SERVERS: ssrFallback, getIceServers: getIceServersSsr } = await import('../turn');
    expect(await getIceServersSsr()).toEqual(ssrFallback);
  });

  it('respects 5-minute upstream credential TTL end-to-end and propagates remaining lifetime on warm cache hits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const secretKey = 'secret-5m-ttl-key';
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', secretKey);

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    const routeModule = await import('../../app/api/ice-servers/route');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (input === '/api/ice-servers') {
        return routeModule.GET(new Request('https://notebook.example.com/api/ice-servers', init));
      }
      callCount++;
      return new Response(
        JSON.stringify([
          {
            urls: 'turn:5m.example.com:3478',
            username: `u-${callCount}`,
            credential: `c-${callCount}`,
            ttl: 300,
          },
        ]),
        { status: 200 },
      );
    });

    expect(typeof originalFetch).toBe('function');

    // Direct route response exposes remaining buffered TTL (300s - 30s = 270s) with Cache-Control: no-store
    const routeRes = await routeModule.GET();
    expect(routeRes.headers.get('cache-control')).toBe('no-store');
    expect(routeRes.headers.get('x-ice-servers-ttl')).toBe('270');

    // Advance 200s -> warm server cache has 70s remaining; fresh client only caches for 70s
    await vi.advanceTimersByTimeAsync(200 * 1000);
    const { getIceServers } = await import('../turn');

    const first = await getIceServers();
    expect(first[0]?.username).toBe('u-1');
    const clientFetchesAfterFirst = fetchSpy.mock.calls.filter(([url]) => url === '/api/ice-servers').length;
    expect(clientFetchesAfterFirst).toBe(1);

    // At +60s (260s elapsed total), client cache (70s) is still valid
    await vi.advanceTimersByTimeAsync(60 * 1000);
    const second = await getIceServers();
    expect(second[0]?.username).toBe('u-1');
    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/ice-servers').length).toBe(1);

    // At +15s more (275s elapsed total), both client and server caches expired -> refreshes cleanly
    await vi.advanceTimersByTimeAsync(15 * 1000);
    const third = await getIceServers();
    expect(third[0]?.username).toBe('u-2');
    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/ice-servers').length).toBe(2);
    expect(JSON.stringify(third)).not.toContain(secretKey);

    // Advance 265s into the 270s cache -> warm server has 5s remaining (< 10s threshold),
    // so a fresh client gets live servers with X-Ice-Servers-TTL: 5 and does not cache them.
    await vi.advanceTimersByTimeAsync(265 * 1000);
    vi.resetModules();
    const { getIceServers: getFreshClientIceServers } = await import('../turn');
    const nearExpiryRes = await getFreshClientIceServers();
    expect(nearExpiryRes[0]?.username).toBe('u-2');

    // 6s later (271s total) -> server cache expired and fresh client did not cache the 5s response
    await vi.advanceTimersByTimeAsync(6 * 1000);
    const refreshedAfterNearExpiry = await getFreshClientIceServers();
    expect(refreshedAfterNearExpiry[0]?.username).toBe('u-3');
  });

  it('caps 15-minute upstream credential TTL at 10 minutes on server and client', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', 'valid-secret-key');

    let callCount = 0;
    const routeModule = await import('../../app/api/ice-servers/route');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (input === '/api/ice-servers') {
        return routeModule.GET(new Request('https://notebook.example.com/api/ice-servers', init));
      }
      callCount++;
      return new Response(
        JSON.stringify([
          {
            urls: 'turn:15m.example.com:3478',
            username: `u-${callCount}`,
            credential: `c-${callCount}`,
            ttl: 900,
          },
        ]),
        { status: 200 },
      );
    });

    const { getIceServers } = await import('../turn');

    const first = await getIceServers();
    expect(first[0]?.username).toBe('u-1');
    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/ice-servers').length).toBe(1);

    // 9 minutes later -> still within 10-minute cap
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    const second = await getIceServers();
    expect(second[0]?.username).toBe('u-1');
    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/ice-servers').length).toBe(1);

    // 2 minutes later (11 minutes total) -> 10-minute client + server cache expired
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    const third = await getIceServers();
    expect(third[0]?.username).toBe('u-2');
    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/ice-servers').length).toBe(2);
  });

  it('does not cache very short TTL credentials or degraded STUN fallback responses on the client', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', 'valid-secret-key');

    let upstreamIndex = 0;
    const upstreamPayloads = [
      // 1) ttl: 25s -> buffered <= 0 -> X-Ice-Servers-TTL: 0 (not cached)
      [{ urls: 'turn:short25.example.com:3478', username: 'u-25', credential: 'c-25', ttl: 25 }],
      // 2) ttl: 35s -> buffered 5s -> X-Ice-Servers-TTL: 5 (< 10s client minimum, not cached)
      [{ urls: 'turn:short35.example.com:3478', username: 'u-35', credential: 'c-35', ttl: 35 }],
      // 3) invalid upstream payload -> STUN fallback with X-Ice-Servers-TTL: 0 (not cached)
      [{ urls: 'https://invalid.example.com' }],
      // 4) healthy recovery with 5m TTL
      [{ urls: 'turn:recovered.example.com:3478', username: 'u-ok', credential: 'c-ok', ttl: 300 }],
    ];

    const routeModule = await import('../../app/api/ice-servers/route');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (input === '/api/ice-servers') {
        return routeModule.GET(new Request('https://notebook.example.com/api/ice-servers', init));
      }
      const payload = upstreamPayloads[upstreamIndex++] ?? upstreamPayloads[3];
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { FALLBACK_ICE_SERVERS, getIceServers } = await import('../turn');

    const res25 = await getIceServers();
    expect(res25[0]?.username).toBe('u-25');

    const res35 = await getIceServers();
    expect(res35[0]?.username).toBe('u-35');

    const resFallback = await getIceServers();
    expect(resFallback).toEqual(FALLBACK_ICE_SERVERS);

    const resRecovered = await getIceServers();
    expect(resRecovered[0]?.username).toBe('u-ok');

    expect(fetchSpy.mock.calls.filter(([url]) => url === '/api/ice-servers').length).toBe(4);
  });

  it('handles missing, zero, negative, and malformed TTLs safely on both server and client', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    // Server behavior: invalid string ttl falls back to 10m; explicit ttl <= 0 disables caching
    vi.stubEnv('METERED_APP_NAME', 'notebook-app');
    vi.stubEnv('METERED_API_KEY', 'valid-secret-key');

    const routeModule = await import('../../app/api/ice-servers/route');
    const upstreamMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ urls: 'turn:zero.example.com:3478', username: 'u0', credential: 'c0', ttl: 0 }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ urls: 'turn:neg.example.com:3478', username: 'uneg', credential: 'cneg', ttl: -10 }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ urls: 'turn:badttl.example.com:3478', username: 'ubad', credential: 'cbad', ttl: 'invalid' }]),
          { status: 200 },
        ),
      );

    const zeroRes = await routeModule.GET();
    expect(zeroRes.headers.get('cache-control')).toBe('no-store');
    expect(zeroRes.headers.get('x-ice-servers-ttl')).toBe('0');

    const negRes = await routeModule.GET();
    expect(negRes.headers.get('x-ice-servers-ttl')).toBe('0');

    const invalidTtlRes = await routeModule.GET();
    expect(invalidTtlRes.headers.get('x-ice-servers-ttl')).toBe('600');
    expect(upstreamMock).toHaveBeenCalledTimes(3);

    // Client behavior: malformed X-Ice-Servers-TTL headers never cache
    vi.resetModules();
    vi.restoreAllMocks();
    const clientFetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ urls: 'turn:a.example.com:3478', username: 'u1', credential: 'c1' }]), {
          status: 200,
          headers: { 'x-ice-servers-ttl': 'not-a-number' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ urls: 'turn:b.example.com:3478', username: 'u2', credential: 'c2' }]), {
          status: 200,
          headers: { 'x-ice-servers-ttl': '-30' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ urls: 'turn:c.example.com:3478', username: 'u3', credential: 'c3' }]), {
          status: 200,
          headers: { 'x-ice-servers-ttl': '120' },
        }),
      );

    const { getIceServers } = await import('../turn');

    expect((await getIceServers())[0]?.username).toBe('u1');
    expect((await getIceServers())[0]?.username).toBe('u2');
    expect((await getIceServers())[0]?.username).toBe('u3');
    // Cached for 120s now
    expect((await getIceServers())[0]?.username).toBe('u3');
    expect(clientFetchSpy).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(121 * 1000);
    clientFetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{ urls: 'turn:d.example.com:3478', username: 'u4', credential: 'c4' }]), {
        status: 200,
        headers: { 'x-ice-servers-ttl': '120' },
      }),
    );
    expect((await getIceServers())[0]?.username).toBe('u4');
    expect(clientFetchSpy).toHaveBeenCalledTimes(4);
  });
});
