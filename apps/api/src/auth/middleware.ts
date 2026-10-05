import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Database } from '../db/client';
import { GatewayError } from '../lib/errors';
import { resolveSession } from '../services/sessions';
import type { AppEnv } from '../types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * CSRF protection for cookie-authenticated routes. State-changing requests must
 * come from the dashboard origin and carry JSON, which a cross-site form cannot
 * send. This backs up the SameSite=Lax session cookie.
 */
export function csrfGuard(webOrigin: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      if (c.req.header('origin') !== webOrigin) {
        throw new GatewayError(
          403,
          'invalid_request_error',
          'Cross-origin request blocked.',
          'csrf',
        );
      }
      if (
        BODY_METHODS.has(c.req.method) &&
        !c.req.header('content-type')?.toLowerCase().startsWith('application/json')
      ) {
        throw new GatewayError(
          415,
          'invalid_request_error',
          'Content-Type must be application/json.',
          'unsupported_media_type',
        );
      }
    }
    await next();
  };
}

export interface SessionCookie {
  name: string;
  secure: boolean;
}

/** `__Host-` makes the browser enforce Secure, Path=/ and no Domain in production. */
export function sessionCookie(production: boolean): SessionCookie {
  return production
    ? { name: '__Host-twynn_session', secure: true }
    : { name: 'twynn_session', secure: false };
}

export function writeSessionCookie(
  c: Context,
  cookie: SessionCookie,
  token: string,
  expires: Date,
): void {
  setCookie(c, cookie.name, token, {
    httpOnly: true,
    secure: cookie.secure,
    sameSite: 'Lax',
    path: '/',
    expires,
  });
}

export function clearSessionCookie(c: Context, cookie: SessionCookie): void {
  deleteCookie(c, cookie.name, { path: '/', secure: cookie.secure });
}

export function readSessionToken(c: Context, cookie: SessionCookie): string | undefined {
  return getCookie(c, cookie.name);
}

export function requireSession(db: Database, cookie: SessionCookie): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = readSessionToken(c, cookie);
    const session = token ? await resolveSession(db, token) : null;
    if (!session) {
      throw new GatewayError(401, 'authentication_error', 'Please log in.', 'unauthenticated');
    }
    c.set('session', session);
    await next();
  };
}
