import { Hono } from 'hono';
import { z } from 'zod';
import { twinLabelSchema, type EvaluationData } from '@twynn/shared';
import { requireSession, type SessionCookie } from '../auth/middleware';
import type { Database } from '../db/client';
import { GatewayError } from '../lib/errors';
import { parseJsonBody } from '../lib/validation';
import { clearLabel, evaluationPairs, setLabel } from '../services/evaluation';
import type { AppEnv } from '../types';

export interface EvaluationDeps {
  db: Database;
  cookie: SessionCookie;
}

const uuid = z.string().uuid();
const notFound = () => new GatewayError(404, 'not_found_error', 'Twin search not found.');

/** Label real twin-search pairs to evaluate false hits and choose a twin threshold. */
export function evaluationRoutes({ db, cookie }: EvaluationDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const authed = requireSession(db, cookie);

  routes.get('/evaluation', authed, async (c) =>
    c.json({
      pairs: await evaluationPairs(db, c.get('session').workspace.id),
    } satisfies EvaluationData),
  );

  routes.put('/evaluation/labels/:requestId', authed, async (c) => {
    const requestId = c.req.param('requestId');
    const { same } = await parseJsonBody(c, twinLabelSchema);
    const ok =
      uuid.safeParse(requestId).success &&
      (await setLabel(db, c.get('session').workspace.id, requestId, same));
    if (!ok) throw notFound();
    return c.body(null, 204);
  });

  routes.delete('/evaluation/labels/:requestId', authed, async (c) => {
    const requestId = c.req.param('requestId');
    const ok =
      uuid.safeParse(requestId).success &&
      (await clearLabel(db, c.get('session').workspace.id, requestId));
    if (!ok) throw notFound();
    return c.body(null, 204);
  });

  return routes;
}
