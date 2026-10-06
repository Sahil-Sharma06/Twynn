import { randomUUID } from 'node:crypto';
import type { EvaluationData, RequestPage } from '@twynn/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { MemoryEventBus } from '../lib/events';
import { RequestRecorder } from '../metering/recorder';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  fakeFetch,
  gatewayPost,
  json,
  silentLogger,
  type EmbedFn,
} from '../test/helpers';

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const FRANCE = 'What is the capital of France?';
const FRANCE_TWIN = 'Which city is the capital of France?';
const GERMANY = 'What is the capital of Germany?';
const vectors: EmbedFn = (text) =>
  ({
    [FRANCE]: [1, 0, 0],
    [FRANCE_TWIN]: [0.99, Math.sqrt(1 - 0.99 ** 2), 0],
    [GERMANY]: [0.9, 0, Math.sqrt(1 - 0.81)],
  })[text] ?? [0, 0, 1];

async function workspace() {
  const f = fakeFetch(() => json(completion('ok')));
  f.embed = vectors;
  const recorder = new RequestRecorder(db, new MemoryEventBus(), silentLogger);
  const app = buildApp({ db, fetch: f.impl, recorder });
  const browser = new Browser(app);
  const { gatewayKey } = await browser.onboard(`${randomUUID()}@example.com`);
  const send = async (content: string) => {
    const res = await gatewayPost(app, gatewayKey, {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content }],
    });
    await res.text();
    await recorder.flush();
  };
  const pairs = async () =>
    ((await browser.json('GET', '/api/evaluation')) as EvaluationData).pairs;
  return { app, browser, send, pairs };
}

describe('evaluation', () => {
  it('lists distinct borderline pairs from real twin searches, closest first', async () => {
    const w = await workspace();
    for (const p of [FRANCE, FRANCE, FRANCE_TWIN, FRANCE_TWIN, GERMANY, 'Unrelated']) {
      await w.send(p);
    }
    const pairs = await w.pairs();
    expect(pairs.map((p) => [p.prompt, p.matchedPrompt, p.label])).toEqual([
      [FRANCE_TWIN, FRANCE, null], // twin hit twice, listed once
      [GERMANY, FRANCE, null], // a miss whose closest stored prompt was France
    ]);
    expect(pairs[0]?.score).toBeCloseTo(0.99, 5);
  });

  it('stores, updates and clears labels', async () => {
    const w = await workspace();
    await w.send(FRANCE);
    await w.send(GERMANY);
    const [pair] = await w.pairs();
    const path = `/api/evaluation/labels/${pair!.requestId}`;
    expect((await w.browser.call('PUT', path, { same: true })).status).toBe(204);
    expect((await w.pairs())[0]?.label).toBe(true);
    await w.browser.call('PUT', path, { same: false });
    expect((await w.pairs())[0]?.label).toBe(false);
    expect((await w.browser.call('DELETE', path)).status).toBe(204);
    expect((await w.pairs())[0]?.label).toBeNull();
    expect((await w.browser.call('DELETE', path)).status).toBe(404);
    expect((await w.browser.call('PUT', path, { same: 'yes' })).status).toBe(400);
  });

  it('only labels twin searches in the caller workspace', async () => {
    const a = await workspace();
    await a.send(FRANCE);
    await a.send(GERMANY);
    const [pair] = await a.pairs();
    const b = await workspace();
    expect(
      (await b.browser.call('PUT', `/api/evaluation/labels/${pair!.requestId}`, { same: true }))
        .status,
    ).toBe(404);
    expect(await b.pairs()).toEqual([]);

    // A request with no twin search (the first, with nothing stored) cannot be labelled.
    const log = (await a.browser.json(
      'GET',
      `/api/requests?q=${encodeURIComponent('France')}`,
    )) as RequestPage;
    const noSearch = log.requests.find((r) => r.promptPreview === FRANCE);
    expect(
      (await a.browser.call('PUT', `/api/evaluation/labels/${noSearch!.id}`, { same: true }))
        .status,
    ).toBe(404);
    expect(
      (await a.browser.call('PUT', '/api/evaluation/labels/nope', { same: true })).status,
    ).toBe(404);
  });

  it('requires a session', async () => {
    const w = await workspace();
    expect((await new Browser(w.app).call('GET', '/api/evaluation')).status).toBe(401);
  });
});
