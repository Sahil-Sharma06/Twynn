import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { gatewayKeys, providers, sessions, users } from '../db/schema';
import { sha256 } from '../lib/crypto';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  fakeFetch,
  gatewayPost,
  json,
  readJson,
  WEB_ORIGIN,
} from '../test/helpers';

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const password = 'correct horse battery';
const freshEmail = () => `${randomUUID()}@example.com`;
const browser = (production = false) => new Browser(buildApp({ db, production }));

describe('auth', () => {
  it('signs up, creates a workspace and starts a session', async () => {
    const b = browser();
    const email = freshEmail();
    const res = await b.call('POST', '/api/auth/signup', {
      email: `  ${email.toUpperCase()} `,
      password,
    });
    expect(res.status).toBe(201);
    const session = await res.json();
    expect(session).toMatchObject({ user: { email }, workspace: { name: 'My workspace' } });

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    expect(await b.json('GET', '/api/auth/me')).toEqual(session);
  });

  it('stores an argon2id hash, never the password', async () => {
    const email = freshEmail();
    await browser().call('POST', '/api/auth/signup', { email, password });
    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain(password);
  });

  it('stores only a hash of the session token', async () => {
    const b = browser();
    await b.call('POST', '/api/auth/signup', { email: freshEmail(), password });
    const token = b.cookie?.split('=')[1] ?? '';
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256(token)));
    expect(rows).toHaveLength(1);
  });

  it('uses a __Host- Secure cookie in production', async () => {
    const res = await browser(true).call('POST', '/api/auth/signup', {
      email: freshEmail(),
      password,
    });
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-twynn_session=.*Secure/i);
  });

  it('rejects a duplicate email with 409', async () => {
    const email = freshEmail();
    await browser().call('POST', '/api/auth/signup', { email, password });
    const res = await browser().call('POST', '/api/auth/signup', { email, password });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'email_taken' } });
  });

  it('enforces the password length on signup', async () => {
    const res = await browser().call('POST', '/api/auth/signup', {
      email: freshEmail(),
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { param: 'password' } });
  });

  it('logs in, logs out and invalidates the session server-side', async () => {
    const email = freshEmail();
    await browser().call('POST', '/api/auth/signup', { email, password });

    const b = browser();
    expect((await b.call('POST', '/api/auth/login', { email, password })).status).toBe(200);
    const stolenCookie = b.cookie;
    expect((await b.call('GET', '/api/auth/me')).status).toBe(200);

    expect((await b.call('POST', '/api/auth/logout', {})).status).toBe(204);
    expect(b.cookie).toBeUndefined();

    // A copy of the old cookie no longer works.
    const replay = await b.call('GET', '/api/auth/me', undefined, { cookie: stolenCookie ?? '' });
    expect(replay.status).toBe(401);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const email = freshEmail();
    await browser().call('POST', '/api/auth/signup', { email, password });
    const wrong = await browser().call('POST', '/api/auth/login', {
      email,
      password: 'nope-nope-nope',
    });
    const unknown = await browser().call('POST', '/api/auth/login', {
      email: freshEmail(),
      password,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('requires a session for protected routes', async () => {
    for (const path of ['/api/auth/me', '/api/keys', '/api/provider']) {
      expect((await browser().call('GET', path)).status).toBe(401);
    }
  });
});

describe('CSRF protection', () => {
  it('blocks state-changing requests from another origin', async () => {
    const res = await browser().call(
      'POST',
      '/api/auth/signup',
      { email: freshEmail(), password },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'csrf' } });
  });

  it('blocks requests with no Origin', async () => {
    const app = buildApp({ db });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: freshEmail(), password }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks form-encoded bodies, which a cross-site form could send', async () => {
    const app = buildApp({ db });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { origin: WEB_ORIGIN, 'content-type': 'text/plain' },
      body: JSON.stringify({ email: freshEmail(), password }),
    });
    expect(res.status).toBe(415);
  });
});

describe('gateway keys', () => {
  it('shows the key once, stores only its hash, and lists it without the secret', async () => {
    const b = browser();
    await b.call('POST', '/api/auth/signup', { email: freshEmail(), password });
    const created = await b.json('POST', '/api/keys', { name: 'Production' });
    expect(created.key).toMatch(/^twynn_sk_[A-Za-z0-9_-]{32}$/);
    expect(created.key.startsWith(created.prefix)).toBe(true);

    const [row] = await db.select().from(gatewayKeys).where(eq(gatewayKeys.id, created.id));
    expect(row?.keyHash).toBe(sha256(created.key));
    expect(JSON.stringify(row)).not.toContain(created.key);

    const listed = await b.json('GET', '/api/keys');
    expect(listed.keys).toHaveLength(1);
    expect(listed.keys[0]).not.toHaveProperty('key');
    expect(JSON.stringify(listed)).not.toContain(created.key);
  });

  it('revokes a key so the gateway rejects it immediately', async () => {
    const app = buildApp({ db, fetch: fakeFetch(() => json(completion('hi'))).impl });
    const b = new Browser(app);
    const { gatewayKey, keyId } = await b.onboard(freshEmail());
    const body = { model: 'm', messages: [{ role: 'user', content: 'x' }] };
    expect((await gatewayPost(app, gatewayKey, body)).status).toBe(200);

    expect((await b.call('DELETE', `/api/keys/${keyId}`)).status).toBe(204);
    expect((await gatewayPost(app, gatewayKey, body)).status).toBe(401);
    expect((await b.call('DELETE', `/api/keys/${keyId}`)).status).toBe(404);
  });

  it('records when a key was last used', async () => {
    const app = buildApp({ db, fetch: fakeFetch(() => json(completion('hi'))).impl });
    const b = new Browser(app);
    const { gatewayKey, keyId } = await b.onboard(freshEmail());
    const before = await db.select().from(gatewayKeys).where(eq(gatewayKeys.id, keyId));
    expect(before[0]?.lastUsedAt).toBeNull();

    await gatewayPost(app, gatewayKey, { model: 'm', messages: [{ role: 'user', content: 'x' }] });
    await expect
      .poll(
        async () =>
          (await db.select().from(gatewayKeys).where(eq(gatewayKeys.id, keyId)))[0]?.lastUsedAt,
      )
      .toBeInstanceOf(Date);
  });

  it('returns 404 for a malformed key id', async () => {
    const b = browser();
    await b.call('POST', '/api/auth/signup', { email: freshEmail(), password });
    expect((await b.call('DELETE', '/api/keys/not-a-uuid')).status).toBe(404);
  });
});

describe('provider', () => {
  it('encrypts the key at rest and only ever returns a hint', async () => {
    const b = browser();
    const signup = await b.json('POST', '/api/auth/signup', { email: freshEmail(), password });
    const apiKey = 'sk-proj-abcdefghijklmnop1234';
    const res = await b.call('PUT', '/api/provider', {
      baseUrl: 'https://api.example.com/v1/',
      apiKey,
    });
    expect(res.status).toBe(200);
    const { provider } = await readJson(res);
    expect(provider).toMatchObject({ baseUrl: 'https://api.example.com/v1', apiKeyHint: '…1234' });
    expect(JSON.stringify(provider)).not.toContain(apiKey);

    const [row] = await db
      .select()
      .from(providers)
      .where(eq(providers.workspaceId, signup.workspace.id));
    expect(row?.apiKeyEncrypted).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain(apiKey);

    expect(JSON.stringify(await b.json('GET', '/api/provider'))).not.toContain(apiKey);
  });

  it('requires a key on first connect, then allows URL-only updates', async () => {
    const b = browser();
    await b.call('POST', '/api/auth/signup', { email: freshEmail(), password });
    const first = await b.call('PUT', '/api/provider', { baseUrl: 'https://a.example.com/v1' });
    expect(first.status).toBe(400);
    expect(await first.json()).toMatchObject({ error: { code: 'api_key_required' } });

    await b.call('PUT', '/api/provider', {
      baseUrl: 'https://a.example.com/v1',
      apiKey: 'sk-aaaaaaaaaa1111',
    });
    const update = await b.call('PUT', '/api/provider', { baseUrl: 'https://b.example.com/v1' });
    expect(await update.json()).toMatchObject({
      provider: { baseUrl: 'https://b.example.com/v1', apiKeyHint: '…1111' },
    });
  });

  it('rejects private provider URLs in production', async () => {
    const b = browser(true);
    await b.call('POST', '/api/auth/signup', { email: freshEmail(), password });
    const res = await b.call('PUT', '/api/provider', {
      baseUrl: 'https://169.254.169.254/latest',
      apiKey: 'sk-x',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_base_url' } });
  });

  it('disconnects a provider', async () => {
    const b = browser();
    await b.call('POST', '/api/auth/signup', { email: freshEmail(), password });
    await b.call('PUT', '/api/provider', { baseUrl: 'https://a.example.com/v1', apiKey: 'sk-x' });
    expect((await b.call('DELETE', '/api/provider')).status).toBe(204);
    expect(await b.json('GET', '/api/provider')).toEqual({ provider: null });
  });
});
