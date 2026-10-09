import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  verifyEmailSchema,
} from '@twynn/shared';
import { requireSession, type SessionCookie } from '../auth/middleware';
import type { Database } from '../db/client';
import { sessions, users } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { GatewayError } from '../lib/errors';
import { hashPassword } from '../lib/password';
import { clientIp, type Guard } from '../lib/rate-limit';
import { parseJsonBody } from '../lib/validation';
import type { AccountEmails } from '../services/account-emails';
import { consumeToken } from '../services/auth-tokens';
import type { AppEnv } from '../types';

export interface AccountDeps {
  db: Database;
  cookie: SessionCookie;
  emails: AccountEmails;
  guard: Guard;
}

const invalidLink = () =>
  new GatewayError(
    400,
    'invalid_request_error',
    'This link is invalid or has expired. Ask for a new one.',
    'invalid_token',
    'token',
  );

const tooMany = 'Too many requests. Wait a while and try again.';

/** Email verification and password reset. Mount behind csrfGuard. */
export function accountRoutes({ db, cookie, emails, guard }: AccountDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const authed = requireSession(db, cookie);

  routes.post('/auth/verify-email', async (c) => {
    const { token } = await parseJsonBody(c, verifyEmailSchema);
    const userId = await consumeToken(db, token, 'verify_email');
    if (!userId) throw invalidLink();
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
    return c.body(null, 204);
  });

  routes.post('/auth/verify-email/resend', authed, async (c) => {
    const { user } = c.get('session');
    if (user.emailVerified) return c.body(null, 204);
    await guard.limiter.enforce(guard.auth.verifyResend, user.id, tooMany);
    emails.sendVerification(user.id, user.email);
    return c.body(null, 202);
  });

  // Always 202, whether or not the address has an account.
  routes.post('/auth/password-reset', async (c) => {
    const { email } = await parseJsonBody(c, passwordResetRequestSchema);
    const ip = await clientIp(c, guard.trustProxy);
    await guard.limiter.enforce(guard.auth.resetPerIp, ip, tooMany);
    await guard.limiter.enforce(guard.auth.resetPerEmail, sha256(email), tooMany);
    emails.requestPasswordReset(email);
    return c.body(null, 202);
  });

  // Following a reset link proves control of the email, so it also verifies it. Every
  // existing session is signed out.
  routes.post('/auth/password-reset/confirm', async (c) => {
    const { token, password } = await parseJsonBody(c, passwordResetConfirmSchema);
    const userId = await consumeToken(db, token, 'reset_password');
    if (!userId) throw invalidLink();
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, userId));
      await tx
        .update(users)
        .set({ passwordHash, emailVerifiedAt: user?.verifiedAt ?? new Date() })
        .where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    });
    return c.body(null, 204);
  });

  return routes;
}
