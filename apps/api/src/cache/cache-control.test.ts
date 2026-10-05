import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { wantsFreshAnswer } from '../routes/chat';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  fakeFetch,
  gatewayPost,
  json,
  MemoryCache,
  readJson,
} from '../test/helpers';
import type { ExactCache } from './exact';

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const ask = (content: string, model = 'gpt-test') => ({
  model,
  messages: [{ role: 'user', content }],
});

let answers = 0;
async function tenant(cache: ExactCache = new MemoryCache()) {
  const f = fakeFetch(() => json(completion(`answer #${++answers}`)));
  const app = buildApp({ db, fetch: f.impl, cache });
  const browser = new Browser(app);
  const { gatewayKey } = await browser.onboard(`${randomUUID()}@example.com`);
  const send = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await gatewayPost(app, gatewayKey, body, headers);
    const parsed = await readJson(res);
    return {
      status: res.headers.get('x-twynn-cache'),
      answer: parsed.choices?.[0]?.message?.content as string | undefined,
    };
  };
  return { f, browser, send, cache };
}

describe('X-Twynn-Cache-Control', () => {
  it.each(['no-cache', 'No-Cache', 'max-age=0, no-cache'])('recognises %j', (v) => {
    expect(wantsFreshAnswer(v)).toBe(true);
  });

  it.each([undefined, '', 'no-store', 'nocache'])('ignores %j', (v) => {
    expect(wantsFreshAnswer(v)).toBe(false);
  });

  it('skips the cache, returns BYPASS, and refreshes the stored answer', async () => {
    const t = await tenant();
    const first = await t.send(ask('Q'));
    const bypass = await t.send(ask('Q'), { 'X-Twynn-Cache-Control': 'no-cache' });
    expect(bypass.status).toBe('BYPASS');
    expect(bypass.answer).not.toBe(first.answer);
    expect(t.f.calls).toHaveLength(2);

    const after = await t.send(ask('Q'));
    expect(after).toEqual({ status: 'HIT', answer: bypass.answer });
  });
});

describe('cache management API', () => {
  it('lists entries newest first, with search and model filters', async () => {
    const t = await tenant();
    await t.send(ask('First question about Paris'));
    await t.send(ask('Second question about Rome', 'other-model'));
    const all = await t.browser.json('GET', '/api/cache');
    expect(all.entries.map((e: { prompt: string }) => e.prompt)).toEqual([
      'Second question about Rome',
      'First question about Paris',
    ]);
    expect(all.entries[0]).toMatchObject({
      model: 'other-model',
      hitCount: 0,
      twinEligible: false,
    });

    expect((await t.browser.json('GET', '/api/cache?q=paris')).entries).toHaveLength(1);
    expect((await t.browser.json('GET', '/api/cache?model=other-model')).entries).toHaveLength(1);
  });

  it('counts hits and shows the stored response', async () => {
    const t = await tenant();
    const { answer } = await t.send(ask('Counted'));
    await t.send(ask('Counted'));
    await t.send(ask('Counted'));
    const [listed] = (await t.browser.json('GET', '/api/cache')).entries;
    await expect
      .poll(async () => (await t.browser.json('GET', `/api/cache/${listed.id}`)).entry.hitCount)
      .toBe(2);
    const { entry } = await t.browser.json('GET', `/api/cache/${listed.id}`);
    expect(entry.response.choices[0].message.content).toBe(answer);
    expect(entry.lastHitAt).not.toBeNull();
  });

  it('deletes an entry from both layers', async () => {
    const t = await tenant();
    await t.send(ask('Delete me'));
    const [entry] = (await t.browser.json('GET', '/api/cache')).entries;
    expect((await t.browser.call('DELETE', `/api/cache/${entry.id}`)).status).toBe(204);
    expect((await t.send(ask('Delete me'))).status).toBe('MISS');
    expect((await t.browser.call('DELETE', `/api/cache/${entry.id}`)).status).toBe(404);
  });

  it('keeps the entry when the Redis delete fails, so nothing stale is left behind', async () => {
    const memory = new MemoryCache();
    const failing: ExactCache = {
      get: (k) => memory.get(k),
      set: (k, v, ttl) => memory.set(k, v, ttl),
      del: async () => {
        throw new Error('redis down');
      },
    };
    const t = await tenant(failing);
    await t.send(ask('Sticky'));
    const [entry] = (await t.browser.json('GET', '/api/cache')).entries;
    expect((await t.browser.call('DELETE', `/api/cache/${entry.id}`)).status).toBe(500);
    expect((await t.browser.json('GET', '/api/cache')).entries).toHaveLength(1);
  });

  it('invalidates by model, by age, or everything', async () => {
    const t = await tenant();
    await t.send(ask('one', 'model-a'));
    await t.send(ask('two', 'model-a'));
    await t.send(ask('three', 'model-b'));

    expect(await t.browser.json('POST', '/api/cache/invalidate', { model: 'model-a' })).toEqual({
      deleted: 2,
    });
    expect((await t.send(ask('one', 'model-a'))).status).toBe('MISS');
    expect((await t.send(ask('three', 'model-b'))).status).toBe('HIT');

    expect(
      await t.browser.json('POST', '/api/cache/invalidate', { olderThanSeconds: 3600 }),
    ).toEqual({ deleted: 0 });
    expect(await t.browser.json('POST', '/api/cache/invalidate', { all: true })).toEqual({
      deleted: 2,
    });
    expect((await t.browser.json('GET', '/api/cache')).entries).toEqual([]);
  });

  it.each([[{}], [{ all: false }], [{ all: true, model: 'x' }], [{ olderThanSeconds: 0 }]])(
    'rejects invalidation %j',
    async (body) => {
      const t = await tenant();
      expect((await t.browser.call('POST', '/api/cache/invalidate', body)).status).toBe(400);
    },
  );

  it('never touches another workspace', async () => {
    const alice = await tenant();
    const bob = await tenant();
    await alice.send(ask('Mine'));
    const [entry] = (await alice.browser.json('GET', '/api/cache')).entries;

    expect((await bob.browser.json('GET', '/api/cache')).entries).toEqual([]);
    expect((await bob.browser.call('GET', `/api/cache/${entry.id}`)).status).toBe(404);
    expect((await bob.browser.call('DELETE', `/api/cache/${entry.id}`)).status).toBe(404);
    expect(await bob.browser.json('POST', '/api/cache/invalidate', { all: true })).toEqual({
      deleted: 0,
    });
    expect((await alice.send(ask('Mine'))).status).toBe('HIT');
  });

  it('requires a session', async () => {
    const app = buildApp({ db });
    expect((await app.request('/api/cache')).status).toBe(401);
  });
});
