import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import { PRODUCT_NAME } from '@twynn/shared';
import { sessionCookie } from './auth/middleware';
import { createApp } from './app';
import { EntryStore } from './cache/entries';
import { createRedisExactCache } from './cache/exact';
import { CacheManager } from './cache/manager';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { parseEncryptionKey } from './lib/crypto';
import { createLogger } from './lib/logger';
import { createRedisEventBus } from './lib/events';
import { createRedis } from './lib/redis';
import { deleteOldLogs } from './metering/analytics';
import { RequestRecorder } from './metering/recorder';
import { Embedder } from './semantic/embeddings';
import { ProviderStore } from './services/providers';
import { createTenantResolver } from './services/tenancy';
import { UpstreamClient } from './upstream/client';

const config = loadConfig();
const production = config.NODE_ENV === 'production';
const logger = createLogger(config);
const { db, pool } = createDb(config.TWYNN_DB_URL, logger);
const redis = createRedis(config.TWYNN_REDIS_URL, logger);
const subscriber = createRedis(config.TWYNN_REDIS_URL, logger);
await Promise.all([redis.connect(), subscriber.connect()]);
const events = await createRedisEventBus(redis, subscriber, logger);
const shutdownController = new AbortController();

const providers = new ProviderStore(db, parseEncryptionKey(config.TWYNN_ENCRYPTION_KEY));
const entries = new EntryStore(db, logger);
const cache = new CacheManager(
  createRedisExactCache(redis, logger),
  entries,
  new Embedder(
    new UpstreamClient({ timeoutMs: config.TWYNN_EMBEDDING_TIMEOUT_MS, maxRetries: 1 }),
    logger,
  ),
  logger,
);
const recorder = new RequestRecorder(db, events, logger);
const cookie = sessionCookie(production);

const app = createApp({
  logger,
  webOrigin: config.TWYNN_WEB_ORIGIN,
  chat: {
    resolveTenant: createTenantResolver(db, providers, logger),
    cache,
    upstream: new UpstreamClient({
      timeoutMs: config.TWYNN_UPSTREAM_TIMEOUT_MS,
      maxRetries: config.TWYNN_UPSTREAM_MAX_RETRIES,
    }),
    recorder,
  },
  dashboard: {
    db,
    providers,
    cookie,
    sessionTtlDays: config.TWYNN_SESSION_TTL_DAYS,
    production,
  },
  analytics: { db, cookie, events, shutdown: shutdownController.signal },
  cacheAdmin: { db, cookie, entries, cache },
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

// Expired twin entries are already ignored by lookups; this reclaims their space and enforces
// request log retention.
const CLEANUP_INTERVAL_MS = 10 * 60_000;
const cleanup = setInterval(() => {
  Promise.all([entries.deleteExpired(), deleteOldLogs(db, config.TWYNN_LOG_RETENTION_DAYS)])
    .then(([entries, logs]) => {
      if (entries || logs) logger.info({ entries, logs }, 'cleanup removed expired rows');
    })
    .catch((err) => logger.warn({ err }, 'cleanup failed'));
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

  shutdownController.abort(); // ends open event streams
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await recorder.flush();
  await Promise.allSettled([pool.end(), redis.quit(), subscriber.quit()]);
  clearTimeout(force);
  logger.info('shutdown complete');
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
