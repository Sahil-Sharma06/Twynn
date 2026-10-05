import { describe, expect, it } from 'vitest';
import { GatewayError } from '../lib/errors';
import { fakeFetch, json } from '../test/helpers';
import { backoffMs, ClientAbortedError, UpstreamClient } from './client';

const request = {
  baseUrl: 'https://upstream.test/v1/',
  path: '/chat/completions',
  body: '{"model":"m"}',
  headers: {},
};

function client(fetchImpl: typeof fetch, opts: { maxRetries?: number; timeoutMs?: number } = {}) {
  const sleeps: number[] = [];
  const c = new UpstreamClient({
    timeoutMs: opts.timeoutMs ?? 1_000,
    maxRetries: opts.maxRetries ?? 2,
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { c, sleeps };
}

describe('UpstreamClient', () => {
  it('joins the base URL without doubling slashes', async () => {
    const f = fakeFetch(() => json({}));
    await client(f.impl).c.postBuffered(request);
    expect(f.calls[0]?.url).toBe('https://upstream.test/v1/chat/completions');
  });

  it('retries 429 and 5xx, then returns the success', async () => {
    const f = fakeFetch(
      () => json({}, 429, { 'retry-after': '1' }),
      () => json({}, 503),
      () => json({ ok: true }),
    );
    const { c, sleeps } = client(f.impl);
    const res = await c.postBuffered(request);
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(3);
    expect(sleeps[0]).toBe(1_000);
  });

  it('returns the last retryable response once retries are exhausted', async () => {
    const f = fakeFetch(() => json({ error: { message: 'busy' } }, 503));
    const res = await client(f.impl, { maxRetries: 1 }).c.postBuffered(request);
    expect(res.status).toBe(503);
    expect(f.calls).toHaveLength(2);
  });

  it('does not retry client errors', async () => {
    const f = fakeFetch(() => json({}, 400));
    await client(f.impl).c.postBuffered(request);
    expect(f.calls).toHaveLength(1);
  });

  it('retries network failures, then reports the upstream as unreachable', async () => {
    const f = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(client(f.impl, { maxRetries: 1 }).c.postBuffered(request)).rejects.toMatchObject({
      status: 502,
      code: 'upstream_unreachable',
    });
    expect(f.calls).toHaveLength(2);
  });

  it('times out a slow upstream with a 504 and does not retry it', async () => {
    const f = fakeFetch(
      ({ init }) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    const err = await client(f.impl, { timeoutMs: 10 })
      .c.postBuffered(request)
      .catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err).toMatchObject({ status: 504, code: 'upstream_timeout' });
    expect(f.calls).toHaveLength(1);
  });

  it('stops when the caller disconnects', async () => {
    const controller = new AbortController();
    const f = fakeFetch(({ init }) => {
      controller.abort();
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return json({});
    });
    await expect(
      client(f.impl).c.postBuffered({ ...request, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ClientAbortedError);
  });
});

describe('backoffMs', () => {
  it('honours Retry-After, capped at 5s', () => {
    expect(backoffMs(0, '2')).toBe(2_000);
    expect(backoffMs(0, '120')).toBe(5_000);
  });

  it('grows exponentially without Retry-After', () => {
    expect(backoffMs(0, null)).toBeLessThan(backoffMs(3, null));
  });
});
