import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import { PRODUCT_NAME } from '@twynn/shared';
import { sessionCookie } from './auth/middleware';
import { createApp } from './app';
import { createRedisExactCache } from './cache/exact';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { parseEncryptionKey } from './lib/crypto';
import { createLogger } from './lib/logger';
import { createRedis } from './lib/redis';
import { Embedder } from './semantic/embeddings';
import { createSemanticStore } from './semantic/store';
import { ProviderStore } from './services/providers';
import { createTenantResolver } from './services/tenancy';
import { UpstreamClient } from './upstream/client';

const config = loadConfig();
const production = config.NODE_ENV === 'production';
const logger = createLogger(config);
const { db, pool } = createDb(config.TWYNN_DB_URL, logger);
const redis = createRedis(config.TWYNN_REDIS_URL, logger);
await redis.connect();

const providers = new ProviderStore(db, parseEncryptionKey(config.TWYNN_ENCRYPTION_KEY));
const semantic = createSemanticStore(db, logger);

const app = createApp({
  logger,
  webOrigin: config.TWYNN_WEB_ORIGIN,
  chat: {
    resolveTenant: createTenantResolver(db, providers, logger),
    cache: createRedisExactCache(redis, logger),
    semantic,
    embedder: new Embedder(
      new UpstreamClient({ timeoutMs: config.TWYNN_EMBEDDING_TIMEOUT_MS, maxRetries: 1 }),
      logger,
    ),
    upstream: new UpstreamClient({
      timeoutMs: config.TWYNN_UPSTREAM_TIMEOUT_MS,
      maxRetries: config.TWYNN_UPSTREAM_MAX_RETRIES,
    }),
  },
  dashboard: {
    db,
    providers,
    cookie: sessionCookie(production),
    sessionTtlDays: config.TWYNN_SESSION_TTL_DAYS,
    production,
  },
  checks: {
    postgres: async () => {
      await db.execute(sql`select 1`);
    },
    redis: async () => {
      await redis.ping();
    },
  },
});

const server = serve({ fetch: app.fetch, port: config.TWYNN_API_PORT }, ({ port }) => {
  logger.info({ port }, `${PRODUCT_NAME} API listening`);
});

// Expired twin entries are already ignored by lookups; this just reclaims the space.
const CLEANUP_INTERVAL_MS = 10 * 60_000;
const cleanup = setInterval(() => {
  semantic
    .deleteExpired()
    .then((count) => count > 0 && logger.info({ count }, 'deleted expired semantic entries'))
    .catch((err) => logger.warn({ err }, 'semantic cleanup failed'));
}, CLEANUP_INTERVAL_MS).unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  clearInterval(cleanup);
  const force = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit');
    process.exit(1);
  }, config.TWYNN_SHUTDOWN_TIMEOUT_MS).unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([pool.end(), redis.quit()]);
  clearTimeout(force);
  logger.info('shutdown complete');
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
