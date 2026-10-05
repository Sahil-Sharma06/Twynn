import { Hono } from 'hono';
import { z } from 'zod';
import {
  cacheSettingsUpdateSchema,
  createKeySchema,
  loginSchema,
  providerInputSchema,
  signupSchema,
} from '@twynn/shared';
import {
  clearSessionCookie,
  readSessionToken,
  requireSession,
  writeSessionCookie,
  type SessionCookie,
} from '../auth/middleware';
import type { Database } from '../db/client';
import { GatewayError } from '../lib/errors';
import { providerUrlProblem } from '../lib/url-safety';
import { parseJsonBody } from '../lib/validation';
import { authenticate, signup } from '../services/accounts';
import { createGatewayKey, listGatewayKeys, revokeGatewayKey } from '../services/keys';
import type { ProviderStore } from '../services/providers';
import { getCacheSettings, updateCacheSettings } from '../services/settings';
import {
  createSession,
  deleteSession,
  pruneExpiredSessions,
  resolveSession,
} from '../services/sessions';
import type { AppEnv } from '../types';

export interface DashboardDeps {
  db: Database;
  providers: ProviderStore;
  cookie: SessionCookie;
  sessionTtlDays: number;
  production: boolean;
}

const notFound = (what: string) => new GatewayError(404, 'not_found_error', `${what} not found.`);
const uuid = z.string().uuid();

/** Cookie-authenticated JSON API for the dashboard. Mount behind csrfGuard. */
export function dashboardRoutes(deps: DashboardDeps): Hono<AppEnv> {
  const { db, providers, cookie } = deps;
  const routes = new Hono<AppEnv>();
  const authed = requireSession(db, cookie);

  async function startSession(c: Parameters<typeof writeSessionCookie>[0], userId: string) {
    const { token, expiresAt } = await createSession(db, userId, deps.sessionTtlDays);
    writeSessionCookie(c, cookie, token, expiresAt);
    const session = await resolveSession(db, token);
    if (!session) throw new Error('session missing right after creation');
    return session;
  }

  // Auth
  routes.post('/auth/signup', async (c) => {
    const input = await parseJsonBody(c, signupSchema);
    const userId = await signup(db, input);
    return c.json(await startSession(c, userId), 201);
  });

  routes.post('/auth/login', async (c) => {
    const { email, password } = await parseJsonBody(c, loginSchema);
    const userId = await authenticate(db, email, password);
    if (!userId) {
      throw new GatewayError(
        401,
        'authentication_error',
        'Invalid email or password.',
        'invalid_credentials',
      );
    }
    await pruneExpiredSessions(db, userId);
    return c.json(await startSession(c, userId));
  });

  routes.post('/auth/logout', async (c) => {
    const token = readSessionToken(c, cookie);
    if (token) await deleteSession(db, token);
    clearSessionCookie(c, cookie);
    return c.body(null, 204);
  });

  routes.get('/auth/me', authed, (c) => c.json(c.get('session')));

  // Gateway keys
  routes.get('/keys', authed, async (c) =>
    c.json({ keys: await listGatewayKeys(db, c.get('session').workspace.id) }),
  );

  routes.post('/keys', authed, async (c) => {
    const { name } = await parseJsonBody(c, createKeySchema);
    return c.json(await createGatewayKey(db, c.get('session').workspace.id, name), 201);
  });

  routes.delete('/keys/:id', authed, async (c) => {
    const id = c.req.param('id');
    // Only keys inside the caller's workspace can match, so other tenants' ids read as not found.
    const revoked =
      uuid.safeParse(id).success && (await revokeGatewayKey(db, c.get('session').workspace.id, id));
    if (!revoked) throw notFound('Key');
    return c.body(null, 204);
  });

  // Upstream provider
  routes.get('/provider', authed, async (c) =>
    c.json({ provider: await providers.get(c.get('session').workspace.id) }),
  );

  routes.put('/provider', authed, async (c) => {
    const input = await parseJsonBody(c, providerInputSchema);
    const problem = providerUrlProblem(input.baseUrl, deps.production);
    if (problem) {
      throw new GatewayError(
        400,
        'invalid_request_error',
        `Invalid "baseUrl": ${problem}`,
        'invalid_base_url',
        'baseUrl',
      );
    }
    return c.json({ provider: await providers.upsert(c.get('session').workspace.id, input) });
  });

  routes.delete('/provider', authed, async (c) => {
    if (!(await providers.remove(c.get('session').workspace.id))) throw notFound('Provider');
    return c.body(null, 204);
  });

  // Cache settings
  routes.get('/settings', authed, async (c) =>
    c.json({ settings: await getCacheSettings(db, c.get('session').workspace.id) }),
  );

  routes.patch('/settings', authed, async (c) => {
    const patch = await parseJsonBody(c, cacheSettingsUpdateSchema);
    return c.json({
      settings: await updateCacheSettings(db, c.get('session').workspace.id, patch),
    });
  });

  return routes;
}
