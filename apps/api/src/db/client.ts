import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Logger } from 'pino';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export function createDb(url: string, logger: Logger): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5_000 });
  pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));
  return { db: drizzle(pool, { schema }), pool };
}
