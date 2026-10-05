import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { semanticEntries } from '../db/schema';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  fakeFetch,
  gatewayPost,
  json,
  type EmbedFn,
} from '../test/helpers';
import { INDEXED_DIMENSIONS } from './store';

/**
 * End-to-end twin layer: real gateway, real Postgres + pgvector (PGlite), fake
 * provider whose embeddings are chosen so similarities are known exactly.
 */
let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const ORIGINAL = 'What is the capital of France?';
const TWIN = 'Which city is the capital of France?'; // cosine 0.99 with ORIGINAL
const COUSIN = 'What is the capital of Germany?'; // cosine 0.80 with ORIGINAL
const UNRELATED = 'Write a haiku about rain.'; // cosine 0 with ORIGINAL

function vectors(dimensions = 3): EmbedFn {
  const at = (values: number[]) => [...values, ...Array(dimensions - values.length).fill(0)];
  const table: Record<string, number[]> = {
    [ORIGINAL]: at([1, 0, 0]),
    [TWIN]: at([0.99, Math.sqrt(1 - 0.99 ** 2), 0]),
    [COUSIN]: at([0.8, 0.6, 0]),
    [UNRELATED]: at([0, 0, 1]),
  };
  return (text) => table[text] ?? null;
}

const ask = (content: string, extra: Record<string, unknown> = {}) => ({
  model: 'gpt-test',
  messages: [{ role: 'user', content }],
  temperature: 0,
  ...extra,
});

let answers = 0;
async function tenant(dimensions = 3) {
  const f = fakeFetch(() => json(completion(`answer #${++answers}`)));
  f.embed = vectors(dimensions);
  const app = buildApp({ db, fetch: f.impl });
  const browser = new Browser(app);
  const { gatewayKey } = await browser.onboard(`${randomUUID()}@example.com`);
  const post = (body: unknown) => gatewayPost(app, gatewayKey, body);
  const settings = (patch: Record<string, unknown>) =>
    browser.call('PATCH', '/api/settings', patch);
  return { f, app, browser, post, settings, key: gatewayKey };
}

const header = (res: Response) => ({
  cache: res.headers.get('x-twynn-cache'),
  layer: res.headers.get('x-twynn-cache-layer'),
  score: res.headers.get('x-twynn-match-score'),
});

describe('twin layer', () => {
  it('serves a reworded prompt from the stored answer', async () => {
    const t = await tenant();
    const first = await t.post(ask(ORIGINAL));
    expect(header(first)).toEqual({ cache: 'MISS', layer: 'upstream', score: null });

    const twin = await t.post(ask(TWIN));
    expect(header(twin)).toEqual({ cache: 'HIT', layer: 'twin', score: '0.9900' });
    expect(await twin.json()).toEqual(await first.json());
    expect(t.f.calls).toHaveLength(1);
  });

  it('prefers an exact hit and does not embed for it', async () => {
    const t = await tenant();
    await t.post(ask(ORIGINAL));
    const embedsBefore = t.f.embedCalls.length;
    expect(header(await t.post(ask(ORIGINAL))).layer).toBe('exact');
    expect(t.f.embedCalls.length).toBe(embedsBefore);
  });

  it('misses below the twin threshold and stores the new prompt', async () => {
    const t = await tenant();
    await t.post(ask(ORIGINAL));
    expect(header(await t.post(ask(COUSIN))).cache).toBe('MISS');
    expect(header(await t.post(ask(UNRELATED))).cache).toBe('MISS');
    expect(t.f.calls).toHaveLength(3);
  });

  it('honours the tenant threshold', async () => {
    const t = await tenant();
    await t.post(ask(ORIGINAL));

    await t.settings({ twinThreshold: 0.995 });
    expect(header(await t.post(ask(TWIN))).cache).toBe('MISS');

    await t.settings({ twinThreshold: 0.75 });
    // The TWIN miss above was stored too. COUSIN is nearer to it (0.8766) than to ORIGINAL (0.80),
    // so the nearest neighbour wins.
    const res = await t.post(ask(COUSIN));
    expect(header(res)).toMatchObject({ layer: 'twin', score: '0.8766' });
    expect(t.f.calls).toHaveLength(2);
  });

  it('treats the threshold as inclusive', async () => {
    const t = await tenant();
    await t.settings({ twinThreshold: 0.99 });
    await t.post(ask(ORIGINAL));
    expect(header(await t.post(ask(TWIN))).layer).toBe('twin');
  });

  it('does nothing when switched off', async () => {
    const t = await tenant();
    await t.settings({ semanticEnabled: false });
    await t.post(ask(ORIGINAL));
    expect(header(await t.post(ask(TWIN))).cache).toBe('MISS');
    expect(t.f.embedCalls).toHaveLength(0);
  });

  it('embeds with the tenant embeddings model and provider key', async () => {
    const t = await tenant();
    await t.settings({ embeddingModel: 'my-embedder' });
    await t.post(ask(ORIGINAL));
    const call = t.f.embedCalls[0];
    expect(call?.body).toEqual({ model: 'my-embedder', input: ORIGINAL });
    expect((call?.init.headers as Record<string, string>).authorization).toMatch(
      /^Bearer sk-provider-/,
    );
  });

  describe('never matches across scopes', () => {
    it.each([
      ['model', { model: 'gpt-other' }],
      ['temperature', { temperature: 1 }],
      ['max_tokens', { max_tokens: 5 }],
      ['response_format', { response_format: { type: 'json_object' } }],
    ])('different %s', async (_, change) => {
      const t = await tenant();
      await t.post(ask(ORIGINAL));
      expect(header(await t.post(ask(TWIN, change))).cache).toBe('MISS');
    });

    it('different conversation context', async () => {
      const t = await tenant();
      await t.post(ask(ORIGINAL));
      const withSystem = {
        ...ask(TWIN),
        messages: [
          { role: 'system', content: 'Answer in French.' },
          { role: 'user', content: TWIN },
        ],
      };
      expect(header(await t.post(withSystem)).cache).toBe('MISS');
    });

    it('different embeddings model', async () => {
      const t = await tenant();
      await t.post(ask(ORIGINAL));
      await t.settings({ embeddingModel: 'other-embedder' });
      expect(header(await t.post(ask(TWIN))).cache).toBe('MISS');
    });

    it('different provider URL', async () => {
      const t = await tenant();
      await t.post(ask(ORIGINAL));
      await t.browser.call('PUT', '/api/provider', { baseUrl: 'https://other.test/v1' });
      expect(header(await t.post(ask(TWIN))).cache).toBe('MISS');
    });

    it('different tenant, even with identical embeddings', async () => {
      const alice = await tenant();
      const bob = await tenant();
      await alice.post(ask(ORIGINAL));
      const res = await bob.post(ask(TWIN));
      expect(header(res).cache).toBe('MISS');
      expect(JSON.stringify(await res.json())).not.toContain(`answer #${answers - 1}`);
    });
  });

  it('ignores expired entries', async () => {
    const t = await tenant();
    await t.post(ask(ORIGINAL));
    await db.update(semanticEntries).set({ expiresAt: sql`now() - interval '1 second'` });
    expect(header(await t.post(ask(TWIN))).cache).toBe('MISS');
  });

  it('serves the request normally when embeddings fail', async () => {
    const t = await tenant();
    t.f.embed = null; // provider answers /embeddings with 404
    const res = await t.post(ask(ORIGINAL));
    expect(res.status).toBe(200);
    expect(header(res).cache).toBe('MISS');
  });

  it('does not store failed upstream responses', async () => {
    const f = fakeFetch(() => json({ error: { message: 'boom' } }, 400));
    f.embed = vectors();
    const app = buildApp({ db, fetch: f.impl });
    const { gatewayKey } = await new Browser(app).onboard(`${randomUUID()}@example.com`);
    const before = (await db.select().from(semanticEntries)).length;
    await gatewayPost(app, gatewayKey, ask(ORIGINAL));
    expect((await db.select().from(semanticEntries)).length).toBe(before);
  });

  it('skips prompts that are not plain text', async () => {
    const t = await tenant();
    await t.post(
      ask('', {
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
      }),
    );
    expect(t.f.embedCalls).toHaveLength(0);
  });

  it('uses the HNSW-indexed path for common embedding sizes', async () => {
    const t = await tenant(384);
    await t.post(ask(ORIGINAL));
    expect(header(await t.post(ask(TWIN)))).toMatchObject({ layer: 'twin', score: '0.9900' });
  });
});

describe('HNSW indexes', () => {
  it('exist in the migration for every indexed dimension', () => {
    const migration = readFileSync(
      fileURLToPath(new URL('../../drizzle/0002_semantic_layer.sql', import.meta.url)),
      'utf8',
    );
    for (const d of INDEXED_DIMENSIONS) {
      expect(migration).toContain(
        `USING hnsw (("embedding"::vector(${d})) vector_cosine_ops) WHERE "dimensions" = ${d}`,
      );
    }
  });

  it('are used by the twin lookup', async () => {
    const t = await tenant(1536);
    await t.post(ask(ORIGINAL));
    const probe = `[${[1, ...Array(1535).fill(0)].join(',')}]`;
    await db.execute(sql`SET enable_seqscan = off`);
    const plan = await db.execute(sql`
      EXPLAIN SELECT id FROM semantic_entries
      WHERE dimensions = 1536
      ORDER BY embedding::vector(1536) <=> ${probe}::vector(1536) LIMIT 1`);
    await db.execute(sql`SET enable_seqscan = on`);
    expect(JSON.stringify(plan)).toContain('semantic_entries_embedding_hnsw_1536');
  });
});
