import { describe, expect, it } from 'vitest';
import type { ExactCache } from '../cache/exact';
import { buildApp, completion, fakeFetch, json, MemoryCache } from '../test/helpers';

const body = {
  model: 'gpt-test',
  messages: [{ role: 'user', content: 'Say hi' }],
  temperature: 0,
};

function post(
  app: ReturnType<typeof buildApp>,
  payload: unknown,
  key = 'sk-a',
  extra: Record<string, string> = {},
) {
  return app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

describe('POST /v1/chat/completions', () => {
  it('misses, forwards upstream, then serves an exact hit without calling upstream', async () => {
    const f = fakeFetch(() => json(completion('hi')));
    const app = buildApp({ fetch: f.impl });

    const first = await post(app, body);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-twynn-cache')).toBe('MISS');
    expect(first.headers.get('x-twynn-cache-layer')).toBe('upstream');

    const second = await post(app, { ...body, user: 'someone' });
    expect(second.headers.get('x-twynn-cache')).toBe('HIT');
    expect(second.headers.get('x-twynn-cache-layer')).toBe('exact');
    expect(await second.json()).toEqual(await first.json());
    expect(f.calls).toHaveLength(1);
  });

  it('forwards the caller key and the body unchanged', async () => {
    const f = fakeFetch(() => json(completion('hi')));
    await post(buildApp({ fetch: f.impl }), { ...body, custom_field: 1 }, 'sk-a', {
      'openai-organization': 'org-1',
    });
    const headers = f.calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-a');
    expect(headers['openai-organization']).toBe('org-1');
    expect(f.calls[0]?.body).toEqual({ ...body, custom_field: 1 });
  });

  it('never shares cache entries between different API keys', async () => {
    const f = fakeFetch(() => json(completion('hi')));
    const app = buildApp({ fetch: f.impl });
    await post(app, body, 'sk-a');
    const other = await post(app, body, 'sk-b');
    expect(other.headers.get('x-twynn-cache')).toBe('MISS');
    expect(f.calls).toHaveLength(2);
  });

  it('caches with the configured TTL', async () => {
    const cache = new MemoryCache();
    await post(buildApp({ fetch: fakeFetch(() => json(completion('hi'))).impl, cache }), body);
    expect([...cache.store.values()][0]?.ttlSeconds).toBe(60);
  });

  it('does not cache upstream errors and passes them through in OpenAI shape', async () => {
    const cache = new MemoryCache();
    const f = fakeFetch(() =>
      json(
        {
          error: {
            message: 'Rate limit reached',
            type: 'requests',
            code: 'rate_limit_exceeded',
            param: null,
          },
        },
        429,
      ),
    );
    const res = await post(buildApp({ fetch: f.impl, cache }), body);
    expect(res.status).toBe(429);
    expect(res.headers.get('x-twynn-cache')).toBe('MISS');
    expect(await res.json()).toEqual({
      error: {
        message: 'Rate limit reached',
        type: 'requests',
        code: 'rate_limit_exceeded',
        param: null,
      },
    });
    expect(cache.store.size).toBe(0);
  });

  it('wraps a non-JSON upstream error as a 502 without echoing it', async () => {
    const f = fakeFetch(() => new Response('<html>bad gateway</html>', { status: 500 }));
    const res = await post(buildApp({ fetch: f.impl }), body);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('<html>');
    expect(JSON.parse(text)).toMatchObject({
      error: { type: 'upstream_error', code: 'upstream_bad_response' },
    });
  });

  it('does not cache a 200 that is not a valid completion', async () => {
    const cache = new MemoryCache();
    await post(buildApp({ fetch: fakeFetch(() => json({ choices: [] })).impl, cache }), body);
    expect(cache.store.size).toBe(0);
  });

  it('streams through uncached with a BYPASS header', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const cache = new MemoryCache();
    const f = fakeFetch(
      () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }),
    );
    const res = await post(buildApp({ fetch: f.impl, cache }), { ...body, stream: true });
    expect(res.headers.get('x-twynn-cache')).toBe('BYPASS');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toBe(sse);
    expect(cache.store.size).toBe(0);
  });

  it('serves from upstream when the cache is unavailable', async () => {
    const broken: ExactCache = {
      get: async () => null,
      set: async () => {},
    };
    const res = await post(
      buildApp({ fetch: fakeFetch(() => json(completion('hi'))).impl, cache: broken }),
      body,
    );
    expect(res.status).toBe(200);
  });

  describe('validation', () => {
    const app = buildApp({ fetch: fakeFetch(() => json(completion('hi'))).impl });

    it('rejects a missing key with 401', async () => {
      const res = await app.request('/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        error: { type: 'authentication_error', code: 'missing_api_key' },
      });
    });

    it('rejects malformed JSON with 400', async () => {
      const res = await post(app, '{not json');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { type: 'invalid_request_error' } });
    });

    it('names the invalid parameter', async () => {
      const res = await post(app, { model: 'gpt-test', messages: [] });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { param: 'messages' } });
    });

    it('rejects oversized bodies with 413', async () => {
      const huge = { ...body, messages: [{ role: 'user', content: 'x'.repeat(5 * 1024 * 1024) }] };
      const res = await post(app, huge);
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: { code: 'request_too_large' } });
    });
  });
});
