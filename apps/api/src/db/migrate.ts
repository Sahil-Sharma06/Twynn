import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config';
import { createLogger } from '../lib/logger';
import { createDb } from './client';

const config = loadConfig();
const logger = createLogger(config);
const { db, pool } = createDb(config.TWYNN_DB_URL, logger);
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

try {
  await migrate(db, { migrationsFolder });
  logger.info('migrations complete');
} catch (err) {
  logger.error({ err }, 'migrations failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
