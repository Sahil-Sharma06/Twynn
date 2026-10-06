import { randomUUID } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  CACHE_CONTROL_HEADER,
  CACHE_CONTROL_NO_CACHE,
  CACHE_HEADERS,
  REQUEST_ID_HEADER,
  type CacheLayer,
  type CacheStatus,
  type RequestSource,
} from '@twynn/shared';
import { requireSession, type SessionCookie } from '../auth/middleware';
import type { Database } from '../db/client';
import type { CacheContext, CacheManager } from '../cache/manager';
import { GatewayError, normalizeUpstreamError } from '../lib/errors';
import { parseJsonBody } from '../lib/validation';
import { usageFrom, type MeterDraft, type RequestRecorder } from '../metering/recorder';
import { chatCompletionRequest } from '../proxy/schema';
import { completionToSse, interceptSse } from '../proxy/stream';
import { finalMessageText } from '../semantic/request';
import type { Tenant, TenantResolver, WorkspaceLoader } from '../services/tenancy';
import type { AppEnv } from '../types';
import type { UpstreamClient } from '../upstream/client';

export interface ChatDeps {
  resolveTenant: TenantResolver;
  cache: CacheManager;
  upstream: UpstreamClient;
  recorder: RequestRecorder;
}

export interface PlaygroundDeps extends ChatDeps {
  db: Database;
  cookie: SessionCookie;
  loadWorkspace: WorkspaceLoader;
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

/**
 * Metering: every attributed request is recorded once its response (or error) is ready;
 * streamed responses are recorded when the stream ends, with latency measured to first byte.
 */
function meterRequests(
  recorder: RequestRecorder,
  source: RequestSource,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    const meter: MeterDraft = { id: randomUUID(), source };
    c.set('meter', meter);
    await next();
    if (!meter.workspaceId) return; // unauthenticated: nothing to attribute it to
    if (meter.id) c.res.headers.set(REQUEST_ID_HEADER, meter.id);
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
  };
}

/** The gateway pipeline for an identified tenant: exact cache, twin cache, then upstream. */
async function complete(c: Context<AppEnv>, tenant: Tenant, { cache, upstream }: ChatDeps) {
  const meter = c.get('meter');
  meter.workspaceId = tenant.workspaceId;
  if (tenant.keyId) meter.keyId = tenant.keyId;
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
  if (lookup.nearest) {
    meter.nearestScore = lookup.nearest.score;
    if (lookup.nearest.prompt !== null) meter.matchedPrompt = lookup.nearest.prompt;
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
}

/** OpenAI-compatible endpoint for apps, authenticated with a gateway key. */
export function chatRoutes(deps: ChatDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('/chat/completions', meterRequests(deps.recorder, 'api'));
  routes.post('/chat/completions', async (c) =>
    complete(c, await authenticate(c, deps.resolveTenant), deps),
  );
  return routes;
}

/**
 * The same pipeline for the dashboard playground, authenticated with the session so no
 * gateway key has to be handled in the browser. Requests are logged with source "playground".
 */
export function playgroundRoutes(deps: PlaygroundDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const path = '/playground/chat/completions';
  routes.use(
    path,
    requireSession(deps.db, deps.cookie),
    meterRequests(deps.recorder, 'playground'),
  );
  routes.post(path, async (c) =>
    complete(c, await deps.loadWorkspace(c.get('session').workspace.id), deps),
  );
  return routes;
}
