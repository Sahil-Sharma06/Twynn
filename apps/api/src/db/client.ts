import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Logger } from 'pino';
import * as schema from './schema';

/** Driver-agnostic handle, so tests can run the same queries on PGlite. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(
  url: string,
  logger: Logger,
): { db: NodePgDatabase<typeof schema>; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5_000 });
  pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));
  return { db: drizzle({ client: pool, schema }), pool };
}

/** True when a Postgres error (possibly wrapped by Drizzle) is a unique-constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
