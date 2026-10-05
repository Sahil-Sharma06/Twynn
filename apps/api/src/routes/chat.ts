import { Hono, type Context } from 'hono';
import { CACHE_HEADERS, type CacheLayer, type CacheStatus } from '@twynn/shared';
import type { ExactCache } from '../cache/exact';
import { exactCacheKey, sha256 } from '../cache/key';
import { GatewayError, normalizeUpstreamError } from '../lib/errors';
import { chatCompletionRequest } from '../proxy/schema';
import type { UpstreamClient } from '../upstream/client';

export interface ChatDeps {
  cache: ExactCache;
  upstream: UpstreamClient;
  cacheTtlSeconds: number;
}

/** Request headers forwarded to the provider besides auth. */
const FORWARDED_HEADERS = ['openai-organization', 'openai-project'] as const;

function bearerToken(c: Context): string {
  const token = c.req.header('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (!token) {
    throw new GatewayError(
      401,
      'authentication_error',
      'Missing API key. Send it as "Authorization: Bearer <key>".',
      'missing_api_key',
    );
  }
  return token;
}

function setCacheHeaders(c: Context, status: CacheStatus, layer: CacheLayer): void {
  c.header(CACHE_HEADERS.status, status);
  c.header(CACHE_HEADERS.layer, layer);
}

/** A successful completion worth caching: valid JSON with at least one message choice. */
export function isCacheableCompletion(text: string): boolean {
  try {
    const body = JSON.parse(text) as { choices?: unknown };
    return (
      Array.isArray(body.choices) &&
      body.choices.length > 0 &&
      body.choices.every((choice: { message?: unknown }) => typeof choice?.message === 'object')
    );
  } catch {
    return false;
  }
}

export function chatRoutes({ cache, upstream, cacheTtlSeconds }: ChatDeps): Hono {
  const routes = new Hono();

  routes.post('/chat/completions', async (c) => {
    const token = bearerToken(c);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new GatewayError(400, 'invalid_request_error', 'Request body must be valid JSON.');
    }
    const parsed = chatCompletionRequest.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const param = issue?.path.join('.') || null;
      throw new GatewayError(
        400,
        'invalid_request_error',
        param ? `Invalid "${param}": ${issue?.message}` : 'Invalid request body.',
        'invalid_request',
        param,
      );
    }
    const request = parsed.data;

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };
    for (const name of FORWARDED_HEADERS) {
      const value = c.req.header(name);
      if (value) headers[name] = value;
    }
    const upstreamRequest = {
      path: '/chat/completions',
      body: JSON.stringify(request),
      headers,
      signal: c.req.raw.signal,
    };

    if (request.stream) {
      setCacheHeaders(c, 'BYPASS', 'upstream');
      const res = await upstream.postStream(upstreamRequest);
      if (!res.ok) throw normalizeUpstreamError(res.status, await res.text());
      c.header('content-type', res.headers.get('content-type') ?? 'text/event-stream');
      c.header('cache-control', 'no-cache');
      return res.body ? c.body(res.body) : c.body(null);
    }

    // Until tenants exist, the caller's key is the isolation boundary.
    const key = exactCacheKey(sha256(token), request);
    const cached = await cache.get(key);
    if (cached !== null) {
      setCacheHeaders(c, 'HIT', 'exact');
      return c.body(cached, 200, { 'content-type': 'application/json' });
    }

    setCacheHeaders(c, 'MISS', 'upstream');
    const res = await upstream.postBuffered(upstreamRequest);
    if (res.status !== 200) throw normalizeUpstreamError(res.status, res.text);
    if (isCacheableCompletion(res.text)) await cache.set(key, res.text, cacheTtlSeconds);
    return c.body(res.text, 200, { 'content-type': 'application/json' });
  });

  return routes;
}
