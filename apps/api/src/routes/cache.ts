import { Hono } from 'hono';
import { z } from 'zod';
import { cacheEntryFiltersSchema, invalidateSchema } from '@twynn/shared';
import { requireSession, type SessionCookie } from '../auth/middleware';
import type { EntryStore } from '../cache/entries';
import type { CacheManager } from '../cache/manager';
import type { Database } from '../db/client';
import { GatewayError } from '../lib/errors';
import { parseJsonBody, parseQuery } from '../lib/validation';
import type { AppEnv } from '../types';

export interface CacheRoutesDeps {
  db: Database;
  cookie: SessionCookie;
  entries: EntryStore;
  cache: CacheManager;
}

const uuid = z.string().uuid();
const notFound = () => new GatewayError(404, 'not_found_error', 'Cache entry not found.');

/** Browse, inspect and delete the workspace's cached responses. */
export function cacheRoutes({ db, cookie, entries, cache }: CacheRoutesDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const authed = requireSession(db, cookie);

  routes.get('/cache', authed, async (c) =>
    c.json(
      await entries.list(c.get('session').workspace.id, parseQuery(c, cacheEntryFiltersSchema)),
    ),
  );

  routes.get('/cache/:id', authed, async (c) => {
    const id = c.req.param('id');
    const entry = uuid.safeParse(id).success
      ? await entries.get(c.get('session').workspace.id, id)
      : null;
    if (!entry) throw notFound();
    return c.json({ entry });
  });

  routes.delete('/cache/:id', authed, async (c) => {
    const id = c.req.param('id');
    const removed =
      uuid.safeParse(id).success && (await cache.remove(c.get('session').workspace.id, id));
    if (!removed) throw notFound();
    return c.body(null, 204);
  });

  routes.post('/cache/invalidate', authed, async (c) => {
    const criteria = await parseJsonBody(c, invalidateSchema);
    return c.json({ deleted: await cache.invalidate(c.get('session').workspace.id, criteria) });
  });

  return routes;
}
