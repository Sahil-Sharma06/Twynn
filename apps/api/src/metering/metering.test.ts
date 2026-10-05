import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { chatCostUsd, embeddingCostUsd, type RequestEvent } from '@twynn/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { requestLogs } from '../db/schema';
import { MemoryEventBus } from '../lib/events';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  EMBED_TOKENS,
  fakeFetch,
  gatewayPost,
  json,
  silentLogger,
  type EmbedFn,
} from '../test/helpers';
import { bucketStarts, deleteOldLogs } from './analytics';
import { RequestRecorder, usageFrom } from './recorder';

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const PRICED = 'gpt-4o-mini';
const UNPRICED = 'house-model';
const USAGE = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 };

const FRANCE = 'What is the capital of France?';
const FRANCE_TWIN = 'Which city is the capital of France?';
const vectors: EmbedFn = (text) =>
  ({ [FRANCE]: [1, 0, 0], [FRANCE_TWIN]: [0.99, Math.sqrt(1 - 0.99 ** 2), 0] })[text] ?? [0, 0, 1];

const ask = (content: string, extra: Record<string, unknown> = {}) => ({
  model: PRICED,
  messages: [{ role: 'user', content }],
  ...extra,
});

/** A workspace with a fake provider, plus handles to flush and inspect its metering. */
async function tenant(responder?: () => Response) {
  const f = fakeFetch(responder ?? (() => json(completion('ok', { usage: USAGE }))));
  f.embed = vectors;
  const events = new MemoryEventBus();
  const recorder = new RequestRecorder(db, events, silentLogger);
  const shutdown = new AbortController();
  const app = buildApp({ db, fetch: f.impl, events, recorder, shutdown: shutdown.signal });
  const browser = new Browser(app);
  const { gatewayKey, keyId } = await browser.onboard(`${randomUUID()}@example.com`);
  const post = async (body: unknown) => {
    const res = await gatewayPost(app, gatewayKey, body);
    await res.text();
    await recorder.flush();
    return res;
  };
  const get = (path: string) => browser.json('GET', path);
  return { app, f, browser, post, get, recorder, events, shutdown, keyId, key: gatewayKey };
}

const rowsFor = async (keyId: string) =>
  db.select().from(requestLogs).where(eq(requestLogs.keyId, keyId)).orderBy(requestLogs.createdAt);

describe('usageFrom', () => {
  it('reads provider token counts', () => {
    expect(usageFrom(JSON.stringify({ usage: USAGE }))).toEqual({
      promptTokens: 1000,
      completionTokens: 500,
    });
  });

  it('ignores missing or malformed usage', () => {
    expect(usageFrom('{}')).toEqual({});
    expect(usageFrom('nope')).toEqual({});
    expect(
      usageFrom(JSON.stringify({ usage: { prompt_tokens: -1, completion_tokens: 'x' } })),
    ).toEqual({});
  });
});

describe('recording', () => {
  it('records a miss with provider tokens, embeddings usage and a prompt preview', async () => {
    const t = await tenant();
    await t.post(ask(FRANCE));
    const [row] = await rowsFor(t.keyId);
    expect(row).toMatchObject({
      model: PRICED,
      layer: 'upstream',
      status: 'MISS',
      statusCode: 200,
      promptTokens: 1000,
      completionTokens: 500,
      embeddingModel: 'text-embedding-3-small',
      embeddingTokens: EMBED_TOKENS,
      promptPreview: FRANCE,
      matchScore: null,
    });
    expect(row?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records exact and twin hits with the tokens they avoided', async () => {
    const t = await tenant();
    await t.post(ask(FRANCE));
    await t.post(ask(FRANCE));
    await t.post(ask(FRANCE_TWIN));
    const [, exact, twin] = await rowsFor(t.keyId);
    expect(exact).toMatchObject({
      layer: 'exact',
      status: 'HIT',
      promptTokens: 1000,
      embeddingTokens: null,
    });
    expect(twin).toMatchObject({
      layer: 'twin',
      status: 'HIT',
      promptTokens: 1000,
      completionTokens: 500,
      matchedPrompt: FRANCE,
    });
    expect(twin?.matchScore).toBeCloseTo(0.99, 6);
  });

  it('records upstream errors and validation failures, but not unauthenticated calls', async () => {
    const t = await tenant(() => json({ error: { message: 'slow down' } }, 429));
    await t.post(ask(FRANCE));
    await t.post({ model: PRICED, messages: [] });
    await gatewayPost(t.app, undefined, ask(FRANCE));
    await gatewayPost(t.app, 'twynn_sk_unknown', ask(FRANCE));
    await t.recorder.flush();

    const rows = await rowsFor(t.keyId);
    expect(rows.map((r) => [r.layer, r.status, r.statusCode])).toEqual([
      ['upstream', 'MISS', 429],
      [null, null, 400],
    ]);
  });

  it('truncates long prompts in the preview', async () => {
    const t = await tenant();
    await t.post(ask('x'.repeat(1000)));
    const [row] = await rowsFor(t.keyId);
    expect(row?.promptPreview?.length).toBeLessThan(300);
    expect(row?.promptPreview?.endsWith('…')).toBe(true);
  });
});

describe('analytics', () => {
  /** 1 miss, 2 exact hits, 1 twin hit, 1 streamed bypass, 1 unpriced-model hit pair. */
  async function trafficTenant() {
    const t = await tenant();
    t.f.embed = vectors;
    await t.post(ask(FRANCE)); // miss
    await t.post(ask(FRANCE)); // exact
    await t.post(ask(FRANCE)); // exact
    await t.post(ask(FRANCE_TWIN)); // twin
    await t.post(ask('Stream this', { stream: true })); // bypass
    await t.post(ask('Unpriced question', { model: UNPRICED })); // miss
    await t.post(ask('Unpriced question', { model: UNPRICED })); // exact, unpriced
    return t;
  }

  it('summarises totals, hit rate, tokens and estimated cost', async () => {
    const t = await trafficTenant();
    const s = await t.get('/api/analytics/summary');
    expect(s).toMatchObject({
      requests: 7,
      exactHits: 3,
      twinHits: 1,
      misses: 2,
      bypassed: 1,
      errors: 0,
      tokensSaved: 4 * 1500,
    });
    expect(s.hitRate).toBeCloseTo(4 / 6, 10);

    const savedPerHit = chatCostUsd(PRICED, 1000, 500)!;
    // Embeddings ran on the 3 eligible exact misses: FRANCE, FRANCE_TWIN, and the unpriced miss.
    // Streamed and exact-hit requests never embed.
    const embedding = embeddingCostUsd('text-embedding-3-small', EMBED_TOKENS)! * 3;
    expect(s.cost.savedUsd).toBeCloseTo(3 * savedPerHit, 12);
    expect(s.cost.embeddingUsd).toBeCloseTo(embedding, 12);
    expect(s.cost.netUsd).toBeCloseTo(3 * savedPerHit - embedding, 12);
    expect(s.cost.unpricedModels).toEqual([UNPRICED]);
    expect(s.cost.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(s.latency.exact).toMatchObject({ avgMs: expect.any(Number), p95Ms: expect.any(Number) });
    expect(s.latency.twin).not.toBeNull();
  });

  it('starts at zero for a new workspace', async () => {
    const t = await tenant();
    const s = await t.get('/api/analytics/summary');
    expect(s).toMatchObject({ requests: 0, hitRate: null, tokensSaved: 0 });
    expect(s.cost).toMatchObject({ savedUsd: 0, embeddingUsd: 0, unpricedModels: [] });
    expect(Object.values(s.latency)).toEqual([null, null, null]);
    const ts = await t.get('/api/analytics/timeseries');
    expect(ts.points.length).toBeGreaterThan(0);
    expect(ts.points.every((p: { requests: number }) => p.requests === 0)).toBe(true);
  });

  it('returns zero-filled hourly buckets that add up to the totals', async () => {
    const t = await trafficTenant();
    const ts = await t.get('/api/analytics/timeseries');
    expect(ts.bucket).toBe('hour');
    expect(ts.points.length).toBeGreaterThanOrEqual(24);
    const sum = (k: string) =>
      ts.points.reduce((n: number, p: Record<string, number>) => n + p[k]!, 0);
    expect(sum('requests')).toBe(7);
    expect(sum('exactHits')).toBe(3);
    expect(sum('twinHits')).toBe(1);
  });

  it('breaks traffic down by model', async () => {
    const t = await trafficTenant();
    const { models } = await t.get('/api/analytics/models');
    const priced = models.find((m: { model: string }) => m.model === PRICED);
    const unpriced = models.find((m: { model: string }) => m.model === UNPRICED);
    expect(priced).toMatchObject({ requests: 5, exactHits: 2, twinHits: 1, misses: 1 });
    expect(priced.costSavedUsd).toBeCloseTo(3 * chatCostUsd(PRICED, 1000, 500)!, 12);
    expect(unpriced).toMatchObject({ requests: 2, exactHits: 1, costSavedUsd: null });
  });

  it('validates the range', async () => {
    const t = await tenant();
    const backwards = await t.browser.call(
      'GET',
      '/api/analytics/summary?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z',
    );
    expect(backwards.status).toBe(400);
    const tooLong = await t.browser.call(
      'GET',
      '/api/analytics/summary?from=2025-01-01T00:00:00Z&to=2026-01-01T00:00:00Z',
    );
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ error: { param: 'from' } });
  });

  it('switches to daily buckets for long ranges', async () => {
    const t = await tenant();
    const ts = await t.get(
      '/api/analytics/timeseries?from=2026-01-01T00:00:00Z&to=2026-01-31T00:00:00Z',
    );
    expect(ts.bucket).toBe('day');
    expect(ts.points).toHaveLength(30);
  });
});

describe('bucketStarts', () => {
  it('aligns to UTC boundaries and covers a partial first bucket', () => {
    const starts = bucketStarts(
      new Date('2026-01-01T10:30:00Z'),
      new Date('2026-01-01T13:00:00Z'),
      'hour',
    );
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-01-01T10:00:00.000Z',
      '2026-01-01T11:00:00.000Z',
      '2026-01-01T12:00:00.000Z',
    ]);
  });
});

describe('request log', () => {
  it('lists newest first and pages with a cursor without gaps or repeats', async () => {
    const t = await tenant();
    for (let i = 0; i < 5; i++) await t.post(ask(`question ${i}`));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { requests: Array<{ promptPreview: string }>; nextCursor: string | null } =
        await t.get(`/api/requests?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.requests.map((r) => r.promptPreview));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([4, 3, 2, 1, 0].map((i) => `question ${i}`));
  });

  it('filters by layer, status, model, errors and search text', async () => {
    const t = await tenant();
    await t.post(ask(FRANCE));
    await t.post(ask(FRANCE));
    await t.post(ask('100% literal_match?', { model: UNPRICED }));
    await t.post({ model: PRICED, messages: [] });

    const previews = async (query: string) =>
      (await t.get(`/api/requests?${query}`)).requests.map(
        (r: { promptPreview: string | null }) => r.promptPreview,
      );

    expect(await previews('layer=exact')).toEqual([FRANCE]);
    expect(await previews('status=MISS')).toHaveLength(2);
    expect(await previews(`model=${UNPRICED}`)).toEqual(['100% literal_match?']);
    expect(await previews('errorsOnly=true')).toEqual([null]);
    expect(await previews('q=capital')).toEqual([FRANCE, FRANCE]);
    // LIKE wildcards in the search are matched literally.
    expect(await previews(`q=${encodeURIComponent('0% l')}`)).toEqual(['100% literal_match?']);
    expect(await previews(`q=${encodeURIComponent('_')}`)).toEqual(['100% literal_match?']);
  });

  it('shows which stored prompt a twin hit matched', async () => {
    const t = await tenant();
    await t.post(ask(FRANCE));
    await t.post(ask(FRANCE_TWIN));
    const { requests } = await t.get('/api/requests?layer=twin');
    const { request } = await t.get(`/api/requests/${requests[0].id}`);
    expect(request).toMatchObject({
      layer: 'twin',
      promptPreview: FRANCE_TWIN,
      matchedPrompt: FRANCE,
      embeddingModel: 'text-embedding-3-small',
    });
    expect(request.matchScore).toBeCloseTo(0.99, 6);
    expect(request.costSavedUsd).toBeCloseTo(chatCostUsd(PRICED, 1000, 500)!, 12);
  });

  it('rejects a bad filter', async () => {
    const t = await tenant();
    expect((await t.browser.call('GET', '/api/requests?layer=nope')).status).toBe(400);
    expect((await t.browser.call('GET', '/api/requests?limit=1000')).status).toBe(400);
  });
});

describe('tenant isolation', () => {
  it('keeps analytics, the request log and request details per workspace', async () => {
    const alice = await tenant();
    const bob = await tenant();
    await alice.post(ask(FRANCE));
    await alice.post(ask(FRANCE));

    expect((await bob.get('/api/analytics/summary')).requests).toBe(0);
    expect((await bob.get('/api/analytics/models')).models).toEqual([]);
    expect((await bob.get('/api/requests')).requests).toEqual([]);

    const aliceRequest = (await alice.get('/api/requests')).requests[0];
    expect((await bob.browser.call('GET', `/api/requests/${aliceRequest.id}`)).status).toBe(404);
  });

  it('requires a session', async () => {
    const app = buildApp({ db });
    for (const path of ['/api/analytics/summary', '/api/requests', '/api/events']) {
      expect((await app.request(path)).status).toBe(401);
    }
  });
});

describe('live events', () => {
  /** Accumulates an SSE response body; `until` reads more until the predicate holds. */
  function sse(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const state = { text: '' };
    return {
      state,
      cancel: () => reader.cancel(),
      async until(predicate: (text: string) => boolean) {
        const deadline = Date.now() + 3000;
        while (!predicate(state.text)) {
          if (Date.now() > deadline)
            throw new Error(`timed out; received:
${state.text}`);
          const { value, done } = await reader.read();
          if (done) break;
          state.text += decoder.decode(value);
        }
        return state.text;
      },
    };
  }

  const parseEvents = (text: string) =>
    text
      .split('\n\n')
      .filter((block) => block.includes('event: request'))
      .map(
        (block) =>
          JSON.parse(
            block
              .split('\n')
              .find((l) => l.startsWith('data: '))!
              .slice(6),
          ) as RequestEvent,
      );

  it('streams each recorded request to its own workspace only', async () => {
    const alice = await tenant();
    const bob = await tenant();
    const aliceStream = await alice.browser.call('GET', '/api/events');
    const bobStream = await bob.browser.call('GET', '/api/events');
    expect(aliceStream.headers.get('content-type')).toContain('text/event-stream');

    const aliceEvents = sse(aliceStream.body!);
    await aliceEvents.until((t) => t.includes('event: ready'));
    await alice.post(ask(FRANCE));
    await alice.post(ask(FRANCE));

    const text = await aliceEvents.until((t) => (t.match(/event: request/g) ?? []).length >= 2);
    const events = parseEvents(text);
    expect(events.map((e) => [e.request.layer, e.request.status])).toEqual([
      ['upstream', 'MISS'],
      ['exact', 'HIT'],
    ]);
    expect(events[1]?.request.costSavedUsd).toBeCloseTo(chatCostUsd(PRICED, 1000, 500)!, 12);
    await aliceEvents.cancel();

    // Bob's stream only ever carries heartbeats.
    const bobEvents = sse(bobStream.body!);
    expect(await bobEvents.until((t) => t.includes('event: ping'))).not.toContain('event: request');
    await bobEvents.cancel();
  });

  it('ends open streams on shutdown', async () => {
    const t = await tenant();
    const res = await t.browser.call('GET', '/api/events');
    const reader = res.body!.getReader();
    await reader.read();
    t.shutdown.abort();
    let done = false;
    const deadline = Date.now() + 2000;
    while (!done && Date.now() < deadline) done = (await reader.read()).done;
    expect(done).toBe(true);
  });
});

describe('retention', () => {
  it('deletes logs older than the retention window', async () => {
    const t = await tenant();
    await t.post(ask('old'));
    await t.post(ask('new'));
    const [old] = await rowsFor(t.keyId);
    await db
      .update(requestLogs)
      .set({ createdAt: sql`now() - interval '91 days'` })
      .where(eq(requestLogs.id, old!.id));
    expect(await deleteOldLogs(db, 90)).toBeGreaterThanOrEqual(1);
    expect((await rowsFor(t.keyId)).map((r) => r.promptPreview)).toEqual(['new']);
  });
});
