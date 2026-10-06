import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { CACHE_HEADERS, REQUEST_ID_HEADER, type RequestPage } from '@twynn/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { requestLogs } from '../db/schema';
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
} from '../test/helpers';

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const PATH = '/api/playground/chat/completions';
const ask = (content: string, extra: Record<string, unknown> = {}) => ({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content }],
  ...extra,
});

async function setup() {
  const f = fakeFetch(() => json(completion('Paris.')));
  const recorder = new RequestRecorder(db, new MemoryEventBus(), silentLogger);
  const app = buildApp({ db, fetch: f.impl, recorder });
  const browser = new Browser(app);
  const { gatewayKey } = await browser.onboard(`${randomUUID()}@example.com`);
  const play = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await browser.call('POST', PATH, body, headers);
    await res.clone().text();
    await recorder.flush();
    return res;
  };
  return { app, f, browser, recorder, play, gatewayKey };
}

const row = async (id: string | null) => {
  const [r] = await db
    .select()
    .from(requestLogs)
    .where(eq(requestLogs.id, id ?? ''));
  return r;
};

describe('playground', () => {
  it('runs the real gateway pipeline for the signed-in workspace', async () => {
    const t = await setup();
    const first = await t.play(ask('Capital of France?'));
    expect(first.status).toBe(200);
    expect(first.headers.get(CACHE_HEADERS.status)).toBe('MISS');
    const repeat = await t.play(ask('Capital of France?'));
    expect(repeat.headers.get(CACHE_HEADERS.layer)).toBe('exact');
    expect(t.f.calls).toHaveLength(1); // the repeat never reached the provider
  });

  it('shares the cache with the workspace gateway, in both directions', async () => {
    const t = await setup();
    await t.play(ask('Shared question'));
    const viaKey = await gatewayPost(t.app, t.gatewayKey, ask('Shared question'));
    expect(viaKey.headers.get(CACHE_HEADERS.status)).toBe('HIT');
  });

  it('logs playground requests as such, without a key, under the id it returns', async () => {
    const t = await setup();
    const res = await t.play(ask('Logged question'));
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await row(id)).toMatchObject({ source: 'playground', keyId: null, status: 'MISS' });

    const page = (await t.browser.json('GET', '/api/requests?source=playground')) as RequestPage;
    expect(page.requests.map((r) => r.id)).toEqual([id]);
    expect(page.requests[0]?.source).toBe('playground');
  });

  it('returns the log id on gateway responses too, including errors', async () => {
    const t = await setup();
    const ok = await gatewayPost(t.app, t.gatewayKey, ask('Via key'));
    await ok.text();
    await t.recorder.flush();
    expect(await row(ok.headers.get(REQUEST_ID_HEADER))).toMatchObject({
      source: 'api',
      statusCode: 200,
    });

    const bad = await gatewayPost(t.app, t.gatewayKey, { model: 'gpt-4o-mini' });
    await bad.text();
    await t.recorder.flush();
    expect(bad.status).toBe(400);
    expect(await row(bad.headers.get(REQUEST_ID_HEADER))).toMatchObject({ statusCode: 400 });

    const anonymous = await gatewayPost(t.app, undefined, ask('No key'));
    expect(anonymous.headers.get(REQUEST_ID_HEADER)).toBeNull(); // nothing was logged
  });

  it('streams like the gateway does', async () => {
    const t = await setup();
    await t.play(ask('Stream me'));
    const res = await t.play(ask('Stream me', { stream: true }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toContain('data: [DONE]');
  });

  it('requires a session and passes the CSRF check', async () => {
    const t = await setup();
    const anonymous = new Browser(t.app);
    expect((await anonymous.call('POST', PATH, ask('x'))).status).toBe(401);
    expect(
      (await t.browser.call('POST', PATH, ask('x'), { origin: 'https://evil.test' })).status,
    ).toBe(403);
  });

  it('never reads another workspace cache', async () => {
    const a = await setup();
    await a.play(ask('Private question'));
    const b = await setup();
    const res = await b.play(ask('Private question'));
    expect(res.headers.get(CACHE_HEADERS.status)).toBe('MISS');
  });
});
