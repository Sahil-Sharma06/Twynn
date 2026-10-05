import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import { PRODUCT_NAME } from '@twynn/shared';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { createLogger } from './lib/logger';
import { createRedis } from './lib/redis';

const config = loadConfig();
const logger = createLogger(config);
const { db, pool } = createDb(config.TWYNN_DB_URL, logger);
const redis = createRedis(config.TWYNN_REDIS_URL, logger);
await redis.connect();

const app = createApp({
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

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
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
