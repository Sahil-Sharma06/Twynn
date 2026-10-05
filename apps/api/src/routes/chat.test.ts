import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  fakeFetch,
  gatewayPost,
  json,
  MemoryCache,
  UPSTREAM_URL,
  type TestAppOptions,
} from '../test/helpers';

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const body = {
  model: 'gpt-test',
  messages: [{ role: 'user', content: 'Say hi' }],
  temperature: 0,
};

/** A fresh tenant with a connected provider and a gateway key. */
async function setup(options: Omit<TestAppOptions, 'db'> = {}) {
  const app = buildApp({ db, ...options });
  const { gatewayKey } = await new Browser(app).onboard(`${randomUUID()}@example.com`, 'sk-prov');
  return { app, key: gatewayKey };
}

describe('POST /v1/chat/completions', () => {
  it('misses, forwards upstream, then serves an exact hit without calling upstream', async () => {
    const f = fakeFetch(() => json(completion('hi')));
    const { app, key } = await setup({ fetch: f.impl });

    const first = await gatewayPost(app, key, body);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-twynn-cache')).toBe('MISS');
    expect(first.headers.get('x-twynn-cache-layer')).toBe('upstream');

    const second = await gatewayPost(app, key, { ...body, user: 'someone' });
    expect(second.headers.get('x-twynn-cache')).toBe('HIT');
    expect(second.headers.get('x-twynn-cache-layer')).toBe('exact');
    expect(await second.json()).toEqual(await first.json());
    expect(f.calls).toHaveLength(1);
  });

  it('calls the tenant provider with the provider key, never the gateway key', async () => {
    const f = fakeFetch(() => json(completion('hi')));
    const { app, key } = await setup({ fetch: f.impl });
    await gatewayPost(app, key, { ...body, custom_field: 1 });

    const call = f.calls[0];
    expect(call?.url).toBe(`${UPSTREAM_URL}/chat/completions`);
    expect((call?.init.headers as Record<string, string>).authorization).toBe('Bearer sk-prov');
    expect(JSON.stringify(call?.init.headers)).not.toContain(key);
    expect(call?.body).toEqual({ ...body, custom_field: 1 });
  });

  it('caches with the configured TTL', async () => {
    const cache = new MemoryCache();
    const { app, key } = await setup({
      fetch: fakeFetch(() => json(completion('hi'))).impl,
      cache,
    });
    await gatewayPost(app, key, body);
    expect([...cache.store.values()][0]?.ttlSeconds).toBe(60);
  });

  it('does not cache upstream errors and passes them through in OpenAI shape', async () => {
    const cache = new MemoryCache();
    const error = {
      message: 'Rate limit reached',
      type: 'requests',
      code: 'rate_limit_exceeded',
      param: null,
    };
    const { app, key } = await setup({ fetch: fakeFetch(() => json({ error }, 429)).impl, cache });
    const res = await gatewayPost(app, key, body);
    expect(res.status).toBe(429);
    expect(res.headers.get('x-twynn-cache')).toBe('MISS');
    expect(await res.json()).toEqual({ error });
    expect(cache.store.size).toBe(0);
  });

  it('wraps a non-JSON upstream error as a 502 without echoing it', async () => {
    const f = fakeFetch(() => new Response('<html>bad gateway</html>', { status: 500 }));
    const { app, key } = await setup({ fetch: f.impl });
    const res = await gatewayPost(app, key, body);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('<html>');
    expect(JSON.parse(text)).toMatchObject({
      error: { type: 'upstream_error', code: 'upstream_bad_response' },
    });
  });

  it('does not cache a 200 that is not a valid completion', async () => {
    const cache = new MemoryCache();
    const { app, key } = await setup({ fetch: fakeFetch(() => json({ choices: [] })).impl, cache });
    await gatewayPost(app, key, body);
    expect(cache.store.size).toBe(0);
  });

  it('streams through uncached with a BYPASS header', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const cache = new MemoryCache();
    const f = fakeFetch(
      () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }),
    );
    const { app, key } = await setup({ fetch: f.impl, cache });
    const res = await gatewayPost(app, key, { ...body, stream: true });
    expect(res.headers.get('x-twynn-cache')).toBe('BYPASS');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toBe(sse);
    expect(cache.store.size).toBe(0);
  });

  describe('authentication and validation', () => {
    it('rejects a missing key with 401', async () => {
      const res = await gatewayPost(buildApp({ db }), undefined, body);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        error: { type: 'authentication_error', code: 'missing_api_key' },
      });
    });

    it.each(['sk-not-a-twynn-key', 'twynn_sk_doesnotexist'])(
      'rejects unknown key %s',
      async (k) => {
        const res = await gatewayPost(buildApp({ db }), k, body);
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ error: { code: 'invalid_api_key' } });
      },
    );

    it('explains when no provider is connected', async () => {
      const app = buildApp({ db });
      const browser = new Browser(app);
      await browser.call('POST', '/api/auth/signup', {
        email: `${randomUUID()}@example.com`,
        password: 'correct horse battery',
      });
      const { key } = (await (await browser.call('POST', '/api/keys', { name: 'k' })).json()) as {
        key: string;
      };
      const res = await gatewayPost(app, key, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'provider_not_configured' } });
    });

    it('rejects malformed JSON with 400', async () => {
      const { app, key } = await setup();
      const res = await gatewayPost(app, key, '{not json');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { type: 'invalid_request_error' } });
    });

    it('names the invalid parameter', async () => {
      const { app, key } = await setup();
      const res = await gatewayPost(app, key, { model: 'gpt-test', messages: [] });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { param: 'messages' } });
    });

    it('rejects oversized bodies with 413', async () => {
      const { app, key } = await setup();
      const huge = { ...body, messages: [{ role: 'user', content: 'x'.repeat(5 * 1024 * 1024) }] };
      const res = await gatewayPost(app, key, huge);
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: { code: 'request_too_large' } });
    });
  });
});
