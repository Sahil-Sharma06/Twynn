import { Hono, type Context } from 'hono';
import { CACHE_HEADERS, type CacheLayer, type CacheStatus } from '@twynn/shared';
import type { ExactCache } from '../cache/exact';
import { exactCacheKey } from '../cache/key';
import { sha256 } from '../lib/crypto';
import { GatewayError, normalizeUpstreamError } from '../lib/errors';
import { parseJsonBody } from '../lib/validation';
import { chatCompletionRequest } from '../proxy/schema';
import { usageFrom, type MeterDraft, type RequestRecorder } from '../metering/recorder';
import type { Embedder } from '../semantic/embeddings';
import { finalMessageText, semanticQuery } from '../semantic/request';
import type { SemanticStore } from '../semantic/store';
import type { Tenant, TenantResolver } from '../services/tenancy';
import type { AppEnv } from '../types';
import type { UpstreamClient } from '../upstream/client';

export interface ChatDeps {
  resolveTenant: TenantResolver;
  cache: ExactCache;
  semantic: SemanticStore;
  embedder: Embedder;
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

/**
 * Cache entries are scoped to the workspace and to the provider URL, so switching
 * providers never serves answers produced by the previous one.
 */
export function cacheScope(workspaceId: string, baseUrl: string): string {
  return `${workspaceId}:${sha256(baseUrl).slice(0, 16)}`;
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

export function chatRoutes({
  resolveTenant,
  cache,
  semantic,
  embedder,
  upstream,
  recorder,
}: ChatDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // Metering: every authenticated request is recorded once its response (or error) is ready.
  routes.use('/chat/completions', async (c, next) => {
    const started = performance.now();
    const meter: MeterDraft = {};
    c.set('meter', meter);
    await next();
    const { workspaceId } = meter;
    if (!workspaceId) return; // unauthenticated: nothing to attribute it to
    recorder.record({
      ...meter,
      workspaceId,
      layer: (c.res.headers.get(CACHE_HEADERS.layer) as CacheLayer | null) ?? null,
      status: (c.res.headers.get(CACHE_HEADERS.status) as CacheStatus | null) ?? null,
      statusCode: c.res.status,
      latencyMs: Math.round(performance.now() - started),
    });
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

    const upstreamRequest = {
      baseUrl: provider.baseUrl,
      path: '/chat/completions',
      body: JSON.stringify(request),
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        'content-type': 'application/json',
      },
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

    // Layer 1: exact match.
    const key = exactCacheKey(cacheScope(tenant.workspaceId, provider.baseUrl), request);
    const cached = await cache.get(key);
    if (cached !== null) {
      setCacheHeaders(c, 'HIT', 'exact');
      Object.assign(meter, usageFrom(cached));
      return c.body(cached, 200, { 'content-type': 'application/json' });
    }

    // Layer 2: twin match on the final user message, within an exactly-matching scope.
    const query = settings.semanticEnabled
      ? semanticQuery(request, provider.baseUrl, settings.embeddingModel)
      : null;
    const embedding = query
      ? await embedder.embed({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: settings.embeddingModel,
          text: query.text,
          signal: c.req.raw.signal,
        })
      : null;
    if (embedding) {
      meter.embeddingModel = settings.embeddingModel;
      if (embedding.tokens !== null) meter.embeddingTokens = embedding.tokens;
    }
    if (query && embedding) {
      const twin = await semantic.findTwin({
        workspaceId: tenant.workspaceId,
        scopeHash: query.scopeHash,
        embedding: embedding.vector,
        threshold: settings.twinThreshold,
      });
      if (twin) {
        setCacheHeaders(c, 'HIT', 'twin');
        c.header(CACHE_HEADERS.matchScore, twin.score.toFixed(4));
        Object.assign(meter, usageFrom(twin.response), {
          matchScore: twin.score,
          matchedPrompt: twin.prompt,
        });
        return c.body(twin.response, 200, { 'content-type': 'application/json' });
      }
    }

    setCacheHeaders(c, 'MISS', 'upstream');
    const res = await upstream.postBuffered(upstreamRequest);
    if (res.status !== 200) throw normalizeUpstreamError(res.status, res.text);
    Object.assign(meter, usageFrom(res.text));
    if (isCacheableCompletion(res.text)) {
      await cache.set(key, res.text, settings.ttlSeconds);
      if (query && embedding) {
        await semantic.insert({
          workspaceId: tenant.workspaceId,
          scopeHash: query.scopeHash,
          model: request.model,
          prompt: query.text,
          embedding: embedding.vector,
          response: res.text,
          ttlSeconds: settings.ttlSeconds,
        });
      }
    }
    return c.body(res.text, 200, { 'content-type': 'application/json' });
  });

  return routes;
}
