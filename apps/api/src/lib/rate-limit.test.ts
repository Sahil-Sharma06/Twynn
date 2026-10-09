import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  fakeFetch,
  gatewayPost,
  json,
  off,
  readJson,
  silentLogger,
} from '../test/helpers';
import { clientIp, createRedisCounter, MemoryCounter, RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  const limit = { name: 't', max: 2, windowSeconds: 60 };

  it('allows up to the limit per window, then resets with the next window', async () => {
    let now = 120_000; // the start of a window
    const limiter = new RateLimiter(new MemoryCounter(), () => now);
    expect(await limiter.check(limit, 'a')).toMatchObject({
      allowed: true,
      remaining: 1,
      resetSeconds: 60,
    });
    expect(await limiter.check(limit, 'a')).toMatchObject({ allowed: true, remaining: 0 });
    now += 15_000;
    expect(await limiter.check(limit, 'a')).toMatchObject({
      allowed: false,
      remaining: 0,
      resetSeconds: 45,
    });
    expect((await limiter.check(limit, 'b')).allowed).toBe(true); // separate identity
    now += 45_000;
    expect((await limiter.check(limit, 'a')).allowed).toBe(true);
  });

  it('treats a limit of 0 as disabled', async () => {
    const limiter = new RateLimiter(new MemoryCounter());
    for (let i = 0; i < 5; i++) {
      expect((await limiter.check({ ...limit, max: 0 }, 'a')).allowed).toBe(true);
    }
  });

  it('fails open when Redis is unavailable', async () => {
    const broken = {
      multi: () => {
        throw new Error('connection refused');
      },
    } as unknown as Redis;
    const limiter = new RateLimiter(createRedisCounter(broken, silentLogger));
    expect((await limiter.check({ ...limit, max: 1 }, 'a')).allowed).toBe(true);
    expect((await limiter.check({ ...limit, max: 1 }, 'a')).allowed).toBe(true);
  });
});

describe('clientIp', () => {
  const app = (trust: boolean) =>
    new Hono().get('/', async (c) => c.text(await clientIp(c, trust)));
  const headers = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };

  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    expect(await (await app(false).request('/', { headers })).text()).toBe('unknown');
    expect(await (await app(true).request('/', { headers })).text()).toBe('203.0.113.7');
  });
});

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const ask = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] };

describe('gateway limits', () => {
  it('limits each key per minute with an OpenAI-shaped 429 and standard headers', async () => {
    const f = fakeFetch(() => json(completion('ok')));
    const app = buildApp({ db, fetch: f.impl, guard: { keyPerMinute: 2 } });
    const browser = new Browser(app);
    const { gatewayKey } = await browser.onboard(`${randomUUID()}@example.com`);

    const first = await gatewayPost(app, gatewayKey, ask);
    expect(first.headers.get('x-ratelimit-limit')).toBe('2');
    expect(first.headers.get('x-ratelimit-remaining')).toBe('1');
    await gatewayPost(app, gatewayKey, ask);
    const limited = await gatewayPost(app, gatewayKey, ask);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await readJson(limited)).toMatchObject({
      error: { type: 'rate_limit_error', code: 'rate_limit_exceeded' },
    });
    expect(f.calls).toHaveLength(1); // the second was a cache hit; the third never ran

    const other = await browser.call('POST', '/api/keys', { name: 'second' });
    const { key } = (await readJson(other)) as { key: string };
    expect((await gatewayPost(app, key, ask)).status).toBe(200);
  });

  it('enforces one daily quota across gateway keys and the playground', async () => {
    const f = fakeFetch(() => json(completion('ok')));
    const app = buildApp({ db, fetch: f.impl, guard: { dailyQuota: 2 } });
    const browser = new Browser(app);
    const { gatewayKey } = await browser.onboard(`${randomUUID()}@example.com`);
    expect((await gatewayPost(app, gatewayKey, ask)).status).toBe(200);
    expect((await browser.call('POST', '/api/playground/chat/completions', ask)).status).toBe(200);
    const over = await gatewayPost(app, gatewayKey, ask);
    expect(over.status).toBe(429);
    expect(((await readJson(over)) as { error: { message: string } }).error.message).toMatch(
      /daily quota of 2/,
    );
  });

  it('limits the playground per workspace', async () => {
    const f = fakeFetch(() => json(completion('ok')));
    const app = buildApp({ db, fetch: f.impl, guard: { playgroundPerMinute: 1 } });
    const browser = new Browser(app);
    await browser.onboard(`${randomUUID()}@example.com`);
    expect((await browser.call('POST', '/api/playground/chat/completions', ask)).status).toBe(200);
    expect((await browser.call('POST', '/api/playground/chat/completions', ask)).status).toBe(429);
  });
});

describe('sign-in abuse protection', () => {
  const auth = {
    loginPerEmail: { name: 'login-email', max: 3, windowSeconds: 900 },
    loginPerIp: { name: 'login-ip', max: 100, windowSeconds: 900 },
    signupPerIp: { name: 'signup-ip', max: 2, windowSeconds: 3600 },
    resetPerEmail: off('reset-email'),
    resetPerIp: off('reset-ip'),
    verifyResend: off('verify-resend'),
  };

  it('locks out an account after repeated attempts, even with the right password', async () => {
    const app = buildApp({ db, guard: { auth } });
    const email = `${randomUUID()}@example.com`;
    const password = 'correct horse battery';
    await new Browser(app).call('POST', '/api/auth/signup', { email, password });
    const login = (pw: string, who = email) =>
      new Browser(app).call('POST', '/api/auth/login', { email: who, password: pw });
    expect((await login('wrong password 1')).status).toBe(401);
    expect((await login('wrong password 2')).status).toBe(401);
    expect((await login(password)).status).toBe(200);
    expect((await login(password)).status).toBe(429);
    expect((await login(password, email.toUpperCase())).status).toBe(429); // same account
    expect((await login('whatever', `${randomUUID()}@example.com`)).status).toBe(401);
  });

  it('limits sign-ups from one address', async () => {
    const app = buildApp({ db, guard: { auth } });
    const signup = () =>
      new Browser(app).call('POST', '/api/auth/signup', {
        email: `${randomUUID()}@example.com`,
        password: 'correct horse battery',
      });
    expect((await signup()).status).toBe(201);
    expect((await signup()).status).toBe(201);
    const limited = await signup();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });
});
