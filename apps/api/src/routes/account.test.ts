import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { authTokens } from '../db/schema';
import { passwordResetEmail } from '../lib/emails';
import { createResendMailer, MemoryMailer } from '../lib/mailer';
import { Browser, buildApp, createTestDb, WEB_ORIGIN } from '../test/helpers';

let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const PASSWORD = 'correct horse battery';
const freshEmail = () => `${randomUUID()}@example.com`;

function setup(guard?: Parameters<typeof buildApp>[0]['guard']) {
  const mailer = new MemoryMailer();
  const app = buildApp({ db, mailer, ...(guard && { guard }) });
  /** The token from the newest email to an address, once it has been sent. */
  const tokenFor = async (email: string, path: string) => {
    await expect.poll(() => mailer.linkTo(email)).toContain(path);
    return new URL(mailer.linkTo(email) ?? '').searchParams.get('token') ?? '';
  };
  return { app, mailer, tokenFor };
}

async function signedUp(app: ReturnType<typeof buildApp>, email = freshEmail()) {
  const browser = new Browser(app);
  await browser.call('POST', '/api/auth/signup', { email, password: PASSWORD });
  return { browser, email };
}

const me = async (browser: Browser) =>
  (await browser.json('GET', '/api/auth/me')) as { user: { emailVerified: boolean } };

describe('email verification', () => {
  it('emails a link at sign-up that verifies the address once', async () => {
    const { app, tokenFor, mailer } = setup();
    const { browser, email } = await signedUp(app);
    expect((await me(browser)).user.emailVerified).toBe(false);

    const token = await tokenFor(email, '/verify-email');
    expect(mailer.linkTo(email)).toMatch(new RegExp(`^${WEB_ORIGIN}/verify-email\\?token=`));
    const anyone = new Browser(app); // the link works without being signed in
    expect((await anyone.call('POST', '/api/auth/verify-email', { token })).status).toBe(204);
    expect((await me(browser)).user.emailVerified).toBe(true);
    expect((await anyone.call('POST', '/api/auth/verify-email', { token })).status).toBe(400);
  });

  it('resends a fresh link and revokes the old one', async () => {
    const { app, tokenFor, mailer } = setup();
    const { browser, email } = await signedUp(app);
    const first = await tokenFor(email, '/verify-email');
    expect((await browser.call('POST', '/api/auth/verify-email/resend', {})).status).toBe(202);
    await expect.poll(() => mailer.sent.filter((m) => m.to === email)).toHaveLength(2);
    const second = await tokenFor(email, '/verify-email');
    expect(second).not.toBe(first);
    expect((await browser.call('POST', '/api/auth/verify-email', { token: first })).status).toBe(
      400,
    );
    expect((await browser.call('POST', '/api/auth/verify-email', { token: second })).status).toBe(
      204,
    );
    // Already verified: nothing more is sent.
    expect((await browser.call('POST', '/api/auth/verify-email/resend', {})).status).toBe(204);
    expect(mailer.sent.filter((m) => m.to === email)).toHaveLength(2);
  });

  it('rejects expired links and requires a session to resend', async () => {
    const { app, tokenFor } = setup();
    const { email } = await signedUp(app);
    const token = await tokenFor(email, '/verify-email');
    await db.update(authTokens).set({ expiresAt: sql`now() - interval '1 minute'` });
    const res = await new Browser(app).call('POST', '/api/auth/verify-email', { token });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_token' } });
    expect((await new Browser(app).call('POST', '/api/auth/verify-email/resend', {})).status).toBe(
      401,
    );
  });
});

describe('password reset', () => {
  it('answers the same way whether or not the email has an account', async () => {
    const { app, mailer } = setup();
    const stranger = freshEmail();
    const res = await new Browser(app).call('POST', '/api/auth/password-reset', {
      email: stranger,
    });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(mailer.sent.filter((m) => m.to === stranger)).toHaveLength(0);
  });

  it('sets a new password, signs out every session and verifies the email', async () => {
    const { app, tokenFor } = setup();
    const { browser, email } = await signedUp(app);
    const anyone = new Browser(app);
    expect(
      (await anyone.call('POST', '/api/auth/password-reset', { email: email.toUpperCase() }))
        .status,
    ).toBe(202);
    const token = await tokenFor(email, '/reset-password');

    const tooShort = await anyone.call('POST', '/api/auth/password-reset/confirm', {
      token,
      password: 'short',
    });
    expect(tooShort.status).toBe(400);

    const newPassword = 'a much better passphrase';
    const ok = await anyone.call('POST', '/api/auth/password-reset/confirm', {
      token,
      password: newPassword,
    });
    expect(ok.status).toBe(204);
    expect((await browser.call('GET', '/api/auth/me')).status).toBe(401); // signed out

    const login = (password: string) =>
      new Browser(app).call('POST', '/api/auth/login', { email, password });
    expect((await login(PASSWORD)).status).toBe(401);
    const fresh = new Browser(app);
    expect(
      (await fresh.call('POST', '/api/auth/login', { email, password: newPassword })).status,
    ).toBe(200);
    expect((await me(fresh)).user.emailVerified).toBe(true);

    // The link works once.
    const again = await anyone.call('POST', '/api/auth/password-reset/confirm', {
      token,
      password: 'yet another passphrase',
    });
    expect(again.status).toBe(400);
  });

  it('does not accept a verification token as a reset token', async () => {
    const { app, tokenFor } = setup();
    const { email } = await signedUp(app);
    const verifyToken = await tokenFor(email, '/verify-email');
    const res = await new Browser(app).call('POST', '/api/auth/password-reset/confirm', {
      token: verifyToken,
      password: 'a much better passphrase',
    });
    expect(res.status).toBe(400);
  });

  it('limits reset requests per address', async () => {
    const { app } = setup({
      auth: {
        loginPerEmail: { name: 'login-email', max: 0, windowSeconds: 60 },
        loginPerIp: { name: 'login-ip', max: 0, windowSeconds: 60 },
        signupPerIp: { name: 'signup-ip', max: 0, windowSeconds: 60 },
        resetPerEmail: { name: 'reset-email', max: 1, windowSeconds: 3600 },
        resetPerIp: { name: 'reset-ip', max: 0, windowSeconds: 60 },
        verifyResend: { name: 'verify-resend', max: 0, windowSeconds: 60 },
      },
    });
    const email = freshEmail();
    const request = () => new Browser(app).call('POST', '/api/auth/password-reset', { email });
    expect((await request()).status).toBe(202);
    expect((await request()).status).toBe(429);
  });
});

describe('Resend mailer', () => {
  it('posts the message to Resend with the API key', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const mailer = createResendMailer({
      apiKey: 're_test_key',
      from: 'Twynn <no-reply@example.com>',
      fetch: async (url, init) => {
        seen = { url: String(url), init: init ?? {} };
        return new Response('{"id":"x"}', { status: 200 });
      },
    });
    await mailer.send(passwordResetEmail('a@example.com', 'https://app.example.com/reset?token=t'));
    expect(seen?.url).toBe('https://api.resend.com/emails');
    expect(new Headers(seen?.init.headers).get('authorization')).toBe('Bearer re_test_key');
    expect(JSON.parse(String(seen?.init.body))).toMatchObject({
      from: 'Twynn <no-reply@example.com>',
      to: ['a@example.com'],
      subject: 'Reset your Twynn password',
    });
  });

  it('reports a rejection by status only', async () => {
    const mailer = createResendMailer({
      apiKey: 'k',
      from: 'f',
      fetch: async () => new Response('{"message":"account detail"}', { status: 403 }),
    });
    await expect(
      mailer.send(passwordResetEmail('a@example.com', 'https://x.test')),
    ).rejects.toThrow('Resend rejected the email (HTTP 403)');
  });

  it('escapes HTML in templates', () => {
    const email = passwordResetEmail('a@example.com', 'https://x.test/?a="><script>');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
