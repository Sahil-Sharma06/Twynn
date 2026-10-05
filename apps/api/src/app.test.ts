import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const ok = async () => {};
const fail = async () => {
  throw new Error('unreachable');
};

describe('GET /health', () => {
  it('returns 200 when every dependency is reachable', async () => {
    const res = await createApp({ checks: { postgres: ok, redis: ok } }).request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      product: 'Twynn',
      checks: { postgres: 'ok', redis: 'ok' },
    });
  });

  it('returns 503 and names the failing dependency', async () => {
    const res = await createApp({ checks: { postgres: ok, redis: fail } }).request('/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'degraded', checks: { redis: 'down' } });
  });
});
