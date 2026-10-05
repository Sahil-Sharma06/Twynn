import { Hono, type Context } from 'hono';
import {
  CACHE_CONTROL_HEADER,
  CACHE_CONTROL_NO_CACHE,
  CACHE_HEADERS,
  type CacheLayer,
  type CacheStatus,
} from '@twynn/shared';
import type { CacheContext, CacheManager } from '../cache/manager';
import { GatewayError, normalizeUpstreamError } from '../lib/errors';
import { parseJsonBody } from '../lib/validation';
import { usageFrom, type MeterDraft, type RequestRecorder } from '../metering/recorder';
import { chatCompletionRequest } from '../proxy/schema';
import { completionToSse, interceptSse } from '../proxy/stream';
import { finalMessageText } from '../semantic/request';
import type { Tenant, TenantResolver } from '../services/tenancy';
import type { AppEnv } from '../types';
import type { UpstreamClient } from '../upstream/client';

export interface ChatDeps {
  resolveTenant: TenantResolver;
  cache: CacheManager;
  upstream: UpstreamClient;
  recorder: RequestRecorder;
}

async function authenticate(c: Context, resolveTenant: TenantResolver): Promise<Tenant> {
  const token = c.req.header('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (!token) {
    throw new GatewayError(
      401,
      'authentication_error',
      'Missing API key. Send your Twynn key as "Authorization: Bearer <key>".',
      'missing_api_key',
    );
  }
  const tenant = await resolveTenant(token);
  if (!tenant) {
    throw new GatewayError(
      401,
      'authentication_error',
      'Invalid or revoked API key.',
      'invalid_api_key',
    );
  }
  return tenant;
}

/** True when the caller asked to skip cache lookups for this request. */
export function wantsFreshAnswer(header: string | undefined): boolean {
  return (header ?? '')
    .split(',')
    .some((directive) => directive.trim().toLowerCase() === CACHE_CONTROL_NO_CACHE);
}

function setCacheHeaders(c: Context, status: CacheStatus, layer: CacheLayer): void {
  c.header(CACHE_HEADERS.status, status);
  c.header(CACHE_HEADERS.layer, layer);
}

function sseHeaders(c: Context): void {
  c.header('content-type', 'text/event-stream; charset=utf-8');
  c.header('cache-control', 'no-cache');
  c.header('x-accel-buffering', 'no');
}

export function chatRoutes({ resolveTenant, cache, upstream, recorder }: ChatDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // Metering: every authenticated request is recorded once its response (or error) is ready;
  // streamed responses are recorded when the stream ends, with latency measured to first byte.
  routes.use('/chat/completions', async (c, next) => {
    const started = performance.now();
    const meter: MeterDraft = {};
    c.set('meter', meter);
    await next();
    if (!meter.workspaceId) return; // unauthenticated: nothing to attribute it to
    const fixed = {
      layer: (c.res.headers.get(CACHE_HEADERS.layer) as CacheLayer | null) ?? null,
      status: (c.res.headers.get(CACHE_HEADERS.status) as CacheStatus | null) ?? null,
      statusCode: c.res.status,
      latencyMs: Math.round(performance.now() - started),
    };
    const workspaceId = meter.workspaceId;
    recorder.record(
      Promise.resolve(meter.settled).then(() => ({ ...meter, ...fixed, workspaceId })),
    );
  });

  routes.post('/chat/completions', async (c) => {
    const meter = c.get('meter');
    const tenant = await authenticate(c, resolveTenant);
    meter.workspaceId = tenant.workspaceId;
    meter.keyId = tenant.keyId;
    const request = await parseJsonBody(c, chatCompletionRequest);
    meter.model = request.model;
    const preview = finalMessageText(request);
    if (preview !== undefined) meter.promptPreview = preview;
    const { provider, settings } = tenant;
    if (!provider) {
      throw new GatewayError(
        400,
        'invalid_request_error',
        'No upstream provider is connected to this workspace. Connect one in the Twynn dashboard.',
        'provider_not_configured',
      );
    }

    const fresh = wantsFreshAnswer(c.req.header(CACHE_CONTROL_HEADER));
    const ctx: CacheContext = {
      workspaceId: tenant.workspaceId,
      provider,
      settings,
      request,
      signal: c.req.raw.signal,
    };
    const lookup = await cache.lookup(ctx, { read: !fresh });
    if (lookup.embedding) {
      meter.embeddingModel = settings.embeddingModel;
      if (lookup.embedding.tokens !== null) meter.embeddingTokens = lookup.embedding.tokens;
    }
    const callerWantsUsage =
      (request.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true;

    const { hit } = lookup;
    if (hit) {
      setCacheHeaders(c, 'HIT', hit.layer);
      Object.assign(meter, usageFrom(hit.response));
      if (hit.layer === 'twin') {
        c.header(CACHE_HEADERS.matchScore, hit.score.toFixed(4));
        meter.matchScore = hit.score;
        if (hit.matchedPrompt !== null) meter.matchedPrompt = hit.matchedPrompt;
      }
      if (request.stream) {
        sseHeaders(c);
        return c.body(completionToSse(hit.response, { includeUsage: callerWantsUsage }));
      }
      return c.body(hit.response, 200, { 'content-type': 'application/json' });
    }

    setCacheHeaders(c, fresh ? 'BYPASS' : 'MISS', 'upstream');
    const upstreamRequest = {
      baseUrl: provider.baseUrl,
      path: '/chat/completions',
      headers: { authorization: `Bearer ${provider.apiKey}`, 'content-type': 'application/json' },
      signal: c.req.raw.signal,
    };

    if (request.stream) {
      // Always ask for usage so streamed requests are metered; withheld from callers who didn't ask.
      const body = JSON.stringify({
        ...request,
        stream_options: { ...(request.stream_options as object), include_usage: true },
      });
      const res = await upstream.postStream({ ...upstreamRequest, body });
      if (!res.ok || !res.body) throw normalizeUpstreamError(res.status, await res.text());
      let settle!: () => void;
      meter.settled = new Promise((resolve) => (settle = resolve));
      const stream = interceptSse(res.body, {
        forwardUsage: callerWantsUsage,
        onEnd: (completion) => {
          if (!completion) return settle();
          Object.assign(meter, usageFrom(completion));
          cache.store(ctx, lookup, completion).finally(settle);
        },
      });
      sseHeaders(c);
      return c.body(stream);
    }

    const res = await upstream.postBuffered({ ...upstreamRequest, body: JSON.stringify(request) });
    if (res.status !== 200) throw normalizeUpstreamError(res.status, res.text);
    Object.assign(meter, usageFrom(res.text));
    await cache.store(ctx, lookup, res.text);
    return c.body(res.text, 200, { 'content-type': 'application/json' });
  });

  return routes;
}
