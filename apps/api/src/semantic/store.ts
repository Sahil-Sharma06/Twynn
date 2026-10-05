import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Database } from '../db/client';
import { semanticEntries } from '../db/schema';

/** Embedding sizes with a partial HNSW index (see migration 0002). Others still work, unindexed. */
export const INDEXED_DIMENSIONS: readonly number[] = [384, 512, 768, 1024, 1536];

export interface TwinMatch {
  id: string;
  prompt: string;
  response: string;
  /** Cosine similarity, 1 meaning identical direction. */
  score: number;
}

export interface TwinQuery {
  workspaceId: string;
  scopeHash: string;
  embedding: number[];
  threshold: number;
}

export interface NewSemanticEntry {
  workspaceId: string;
  scopeHash: string;
  model: string;
  prompt: string;
  embedding: number[];
  response: string;
  ttlSeconds: number;
}

export interface SemanticStore {
  findTwin(query: TwinQuery): Promise<TwinMatch | null>;
  insert(entry: NewSemanticEntry): Promise<void>;
  deleteExpired(): Promise<number>;
}

/** Postgres + pgvector store. Read and write failures degrade to a miss. */
export function createSemanticStore(db: Database, logger: Logger): SemanticStore {
  return {
    async findTwin({ workspaceId, scopeHash, embedding, threshold }) {
      const dimensions = embedding.length;
      // The cast must be a literal for the planner to match the partial index; dimensions is an
      // integer we validated, never user text.
      const cast = sql.raw(
        INDEXED_DIMENSIONS.includes(dimensions) ? `::vector(${dimensions})` : '',
      );
      const distance = sql`${semanticEntries.embedding}${cast} <=> ${`[${embedding.join(',')}]`}::vector${cast}`;
      try {
        const [row] = await db.transaction(async (tx) => {
          // Keep scanning the index past other tenants' neighbours until our filters are satisfied.
          await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
          return tx
            .select({
              id: semanticEntries.id,
              prompt: semanticEntries.prompt,
              response: semanticEntries.response,
              distance: sql<number>`${distance}`.mapWith(Number),
            })
            .from(semanticEntries)
            .where(
              and(
                eq(semanticEntries.workspaceId, workspaceId),
                eq(semanticEntries.scopeHash, scopeHash),
                eq(semanticEntries.dimensions, dimensions),
                gt(semanticEntries.expiresAt, sql`now()`),
              ),
            )
            .orderBy(distance)
            .limit(1);
        });
        if (!row) return null;
        const score = 1 - row.distance;
        return score >= threshold
          ? { id: row.id, prompt: row.prompt, response: row.response, score }
          : null;
      } catch (err) {
        logger.warn({ err }, 'semantic lookup failed; treating as miss');
        return null;
      }
    },

    async insert(entry) {
      try {
        await db.insert(semanticEntries).values({
          workspaceId: entry.workspaceId,
          scopeHash: entry.scopeHash,
          model: entry.model,
          prompt: entry.prompt,
          embedding: entry.embedding,
          dimensions: entry.embedding.length,
          response: entry.response,
          expiresAt: new Date(Date.now() + entry.ttlSeconds * 1000),
        });
      } catch (err) {
        logger.warn({ err }, 'semantic insert failed');
      }
    },

    async deleteExpired() {
      const rows = await db
        .delete(semanticEntries)
        .where(lt(semanticEntries.expiresAt, sql`now()`))
        .returning({ id: semanticEntries.id });
      return rows.length;
    },
  };
}
