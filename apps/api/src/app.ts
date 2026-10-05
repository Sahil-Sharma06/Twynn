import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';
import { CACHE_HEADERS, PRODUCT_NAME } from '@twynn/shared';
import type { Logger } from 'pino';
import { csrfGuard } from './auth/middleware';
import { GatewayError } from './lib/errors';
import { analyticsRoutes, type AnalyticsDeps } from './routes/analytics';
import { chatRoutes, type ChatDeps } from './routes/chat';
import { dashboardRoutes, type DashboardDeps } from './routes/dashboard';
import type { AppEnv } from './types';
import { ClientAbortedError } from './upstream/client';

export type HealthCheck = () => Promise<void>;

export interface AppDeps {
  logger: Logger;
  checks: Record<string, HealthCheck>;
  chat: ChatDeps;
  dashboard: DashboardDeps;
  analytics: AnalyticsDeps;
  webOrigin: string;
  healthTimeoutMs?: number;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createApp({
  logger,
  checks,
  chat,
  dashboard,
  analytics,
  webOrigin,
  healthTimeoutMs = 2_000,
}: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(async (c, next) => {
    const start = performance.now();
    await next();
    logger.info(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        cache: c.res.headers.get(CACHE_HEADERS.status) ?? undefined,
        ms: Math.round(performance.now() - start),
      },
      'request',
    );
  });

  app.get('/health', async (c) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), healthTimeoutMs);
          return [name, 'ok'] as const;
        } catch {
          return [name, 'down'] as const;
        }
      }),
    );
    const healthy = entries.every(([, status]) => status === 'ok');
    return c.json(
      {
        status: healthy ? 'ok' : 'degraded',
        product: PRODUCT_NAME,
        checks: Object.fromEntries(entries),
      },
      healthy ? 200 : 503,
    );
  });

  const limitBody = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: () => {
      throw new GatewayError(
        413,
        'invalid_request_error',
        `Request body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB.`,
        'request_too_large',
      );
    },
  });
  app.use('/v1/*', limitBody);
  app.route('/v1', chatRoutes(chat));
  app.use('/api/*', limitBody, csrfGuard(webOrigin));
  app.route('/api', dashboardRoutes(dashboard));
  app.route('/api', analyticsRoutes(analytics));

  app.notFound((c) =>
    c.json(
      new GatewayError(
        404,
        'not_found_error',
        `No route for ${c.req.method} ${c.req.path}.`,
      ).toBody(),
      404,
    ),
  );

  app.onError((err, c) => {
    if (err instanceof GatewayError) return c.json(err.toBody(), err.status);
    // The caller is gone; nothing useful can be sent. 499 mirrors the common proxy convention.
    if (err instanceof ClientAbortedError) return new Response(null, { status: 499 });
    logger.error({ err, requestId: c.get('requestId') }, 'unhandled error');
    return c.json(new GatewayError(500, 'api_error', 'Internal gateway error.').toBody(), 500);
  });

  return app;
}
