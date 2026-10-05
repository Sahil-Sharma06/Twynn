import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './db/client';
import { buildApp, createTestDb, type TestAppOptions } from './test/helpers';

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});
const app = (options: Omit<TestAppOptions, 'db'> = {}) => buildApp({ db, ...options });

const ok = async () => {};
const fail = async () => {
  throw new Error('unreachable');
};

describe('GET /health', () => {
  it('returns 200 when every dependency is reachable', async () => {
    const res = await app({ checks: { postgres: ok, redis: ok } }).request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      product: 'Twynn',
      checks: { postgres: 'ok', redis: 'ok' },
    });
  });

  it('returns 503 and names the failing dependency', async () => {
    const res = await app({ checks: { postgres: ok, redis: fail } }).request('/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'degraded', checks: { redis: 'down' } });
  });

  it('marks a hanging dependency as down instead of blocking', async () => {
    const hang = () => new Promise<void>(() => {});
    const res = await app({
      checks: { postgres: ok, redis: hang },
      healthTimeoutMs: 20,
    }).request('/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ checks: { postgres: 'ok', redis: 'down' } });
  });
});

describe('unknown routes', () => {
  it('return a 404 in the OpenAI error shape', async () => {
    const res = await app().request('/v1/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { type: 'not_found_error' } });
  });

  it('attach a request id', async () => {
    const res = await app().request('/health');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});
