import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  rangeQuerySchema,
  requestFiltersSchema,
  thresholdPreviewQuerySchema,
  type RequestEvent,
} from '@twynn/shared';
import { requireSession, type SessionCookie } from '../auth/middleware';
import type { Database } from '../db/client';
import { GatewayError } from '../lib/errors';
import type { EventBus } from '../lib/events';
import { parseQuery } from '../lib/validation';
import {
  getRequest,
  listRequests,
  models,
  summary,
  thresholdPreview,
  timeseries,
} from '../metering/analytics';
import type { AppEnv } from '../types';

export interface AnalyticsDeps {
  db: Database;
  cookie: SessionCookie;
  events: EventBus;
  /** Aborted on shutdown so open event streams end instead of holding the server open. */
  shutdown: AbortSignal;
  heartbeatMs?: number;
}

const uuid = z.string().uuid();

/** Workspace-scoped analytics, request log and live events. All reads; behind the session. */
export function analyticsRoutes({
  db,
  cookie,
  events,
  shutdown,
  heartbeatMs = 25_000,
}: AnalyticsDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  // Attached per route: a '*' middleware here would also match every other /api route.
  const authed = requireSession(db, cookie);
  const ws = (c: { get(key: 'session'): { workspace: { id: string } } }) =>
    c.get('session').workspace.id;

  routes.get('/analytics/summary', authed, async (c) =>
    c.json(await summary(db, ws(c), parseQuery(c, rangeQuerySchema))),
  );
  routes.get('/analytics/timeseries', authed, async (c) =>
    c.json(await timeseries(db, ws(c), parseQuery(c, rangeQuerySchema))),
  );
  routes.get('/analytics/models', authed, async (c) =>
    c.json({ models: await models(db, ws(c), parseQuery(c, rangeQuerySchema)) }),
  );
  routes.get('/analytics/threshold-preview', authed, async (c) => {
    const { days } = parseQuery(c, thresholdPreviewQuerySchema);
    return c.json(await thresholdPreview(db, ws(c), days));
  });

  routes.get('/requests', authed, async (c) =>
    c.json(await listRequests(db, ws(c), parseQuery(c, requestFiltersSchema))),
  );
  routes.get('/requests/:id', authed, async (c) => {
    const id = c.req.param('id');
    const request = uuid.safeParse(id).success ? await getRequest(db, ws(c), id) : null;
    if (!request) throw new GatewayError(404, 'not_found_error', 'Request not found.');
    return c.json({ request });
  });

  routes.get('/events', authed, (c) => {
    const workspaceId = ws(c);
    c.header('x-accel-buffering', 'no'); // keep reverse proxies from buffering the stream
    return streamSSE(c, async (stream) => {
      const queue: RequestEvent[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = events.subscribe(workspaceId, (event) => {
        queue.push(event);
        wake?.();
      });
      const stop = () => wake?.();
      shutdown.addEventListener('abort', stop);
      stream.onAbort(stop);
      try {
        await stream.writeSSE({ event: 'ready', data: '{}' });
        while (!stream.aborted && !shutdown.aborted) {
          const event = queue.shift();
          if (event) {
            await stream.writeSSE({
              event: event.type,
              id: event.request.id,
              data: JSON.stringify(event),
            });
            continue;
          }
          // Sleep until an event arrives, the heartbeat is due, or the stream ends.
          const timedOut = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), heartbeatMs);
            wake = () => {
              clearTimeout(timer);
              resolve(false);
            };
          });
          wake = undefined;
          if (timedOut) await stream.writeSSE({ event: 'ping', data: '{}' });
        }
      } finally {
        unsubscribe();
        shutdown.removeEventListener('abort', stop);
      }
    });
  });

  return routes;
}
