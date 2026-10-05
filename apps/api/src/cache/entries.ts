import { and, desc, eq, gt, ilike, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type {
  CacheEntryDetail,
  CacheEntryFilters,
  CacheEntryPage,
  CacheEntryView,
  InvalidateInput,
} from '@twynn/shared';
import type { Logger } from 'pino';
import type { Database } from '../db/client';
import { cacheEntries } from '../db/schema';
import { decodeCursor, encodeCursor, escapeLike } from '../lib/pagination';

/** Embedding sizes with a partial HNSW index (see migration 0005). Others still work, unindexed. */
export const INDEXED_DIMENSIONS: readonly number[] = [384, 512, 768, 1024, 1536];

export interface TwinMatch {
  id: string;
  prompt: string | null;
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

export interface NewEntry {
  workspaceId: string;
  exactKey: string;
  model: string;
  prompt: string | null;
  /** Present only when the request is eligible for twin matching. */
  twin: { scopeHash: string; embedding: number[] } | null;
  response: string;
  ttlSeconds: number;
}

type Row = typeof cacheEntries.$inferSelect;

function toView(row: Pick<Row, keyof Row>): CacheEntryView {
  return {
    id: row.id,
    model: row.model,
    prompt: row.prompt,
    twinEligible: row.dimensions !== null,
    hitCount: row.hitCount,
    lastHitAt: row.lastHitAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

function parseResponse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const live = () => gt(cacheEntries.expiresAt, sql`now()`);

/** Postgres catalogue of cached responses and the Layer 2 (twin) search. */
export class EntryStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async findTwin({
    workspaceId,
    scopeHash,
    embedding,
    threshold,
  }: TwinQuery): Promise<TwinMatch | null> {
    const dimensions = embedding.length;
    // The cast must be a literal for the planner to match the partial index; dimensions is an
    // integer we validated, never user text.
    const cast = sql.raw(INDEXED_DIMENSIONS.includes(dimensions) ? `::vector(${dimensions})` : '');
    const distance = sql`${cacheEntries.embedding}${cast} <=> ${`[${embedding.join(',')}]`}::vector${cast}`;
    try {
      const [row] = await this.db.transaction(async (tx) => {
        // Keep scanning the index past other tenants' neighbours until our filters are satisfied.
        await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
        return tx
          .select({
            id: cacheEntries.id,
            prompt: cacheEntries.prompt,
            response: cacheEntries.response,
            distance: sql<number>`${distance}`.mapWith(Number),
          })
          .from(cacheEntries)
          .where(
            and(
              eq(cacheEntries.workspaceId, workspaceId),
              eq(cacheEntries.scopeHash, scopeHash),
              eq(cacheEntries.dimensions, dimensions),
              live(),
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
      this.logger.warn({ err }, 'twin lookup failed; treating as miss');
      return null;
    }
  }

  /** Inserts or replaces the entry for an exact key. Failures are logged, never thrown. */
  async upsert(entry: NewEntry): Promise<void> {
    const values = {
      model: entry.model,
      prompt: entry.prompt,
      scopeHash: entry.twin?.scopeHash ?? null,
      embedding: entry.twin?.embedding ?? null,
      dimensions: entry.twin?.embedding.length ?? null,
      response: entry.response,
      expiresAt: new Date(Date.now() + entry.ttlSeconds * 1000),
    };
    try {
      await this.db
        .insert(cacheEntries)
        .values({ workspaceId: entry.workspaceId, exactKey: entry.exactKey, ...values })
        .onConflictDoUpdate({
          target: cacheEntries.exactKey,
          set: { ...values, hitCount: 0, lastHitAt: null, createdAt: new Date() },
        });
    } catch (err) {
      this.logger.warn({ err }, 'cache entry write failed');
    }
  }

  /** Counts a hit. Bookkeeping only, so callers should not await it on the request path. */
  async recordHit(by: { exactKey: string } | { id: string }): Promise<void> {
    await this.db
      .update(cacheEntries)
      .set({ hitCount: sql`${cacheEntries.hitCount} + 1`, lastHitAt: new Date() })
      .where('id' in by ? eq(cacheEntries.id, by.id) : eq(cacheEntries.exactKey, by.exactKey));
  }

  async list(workspaceId: string, filters: CacheEntryFilters): Promise<CacheEntryPage> {
    const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
    const conditions: Array<SQL | undefined> = [eq(cacheEntries.workspaceId, workspaceId), live()];
    if (filters.model) conditions.push(eq(cacheEntries.model, filters.model));
    if (filters.q) conditions.push(ilike(cacheEntries.prompt, `%${escapeLike(filters.q)}%`));
    if (cursor) {
      conditions.push(
        sql`(${cacheEntries.createdAt}, ${cacheEntries.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
    const rows = await this.db
      .select()
      .from(cacheEntries)
      .where(and(...conditions))
      .orderBy(desc(cacheEntries.createdAt), desc(cacheEntries.id))
      .limit(filters.limit + 1);
    const page = rows.slice(0, filters.limit);
    const last = page.at(-1);
    return {
      entries: page.map(toView),
      nextCursor:
        rows.length > filters.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async get(workspaceId: string, id: string): Promise<CacheEntryDetail | null> {
    const [row] = await this.db
      .select()
      .from(cacheEntries)
      .where(and(eq(cacheEntries.id, id), eq(cacheEntries.workspaceId, workspaceId), live()));
    return row ? { ...toView(row), response: parseResponse(row.response) } : null;
  }

  /** Entries in the workspace matching an id or bulk criteria; the first step of a delete. */
  async findForDeletion(
    workspaceId: string,
    target: { id: string } | InvalidateInput,
  ): Promise<Array<{ id: string; exactKey: string }>> {
    const conditions: Array<SQL | undefined> = [eq(cacheEntries.workspaceId, workspaceId)];
    if ('id' in target) conditions.push(eq(cacheEntries.id, target.id));
    else {
      if (target.model) conditions.push(eq(cacheEntries.model, target.model));
      if (target.olderThanSeconds !== undefined) {
        conditions.push(
          lt(cacheEntries.createdAt, new Date(Date.now() - target.olderThanSeconds * 1000)),
        );
      }
    }
    return this.db
      .select({ id: cacheEntries.id, exactKey: cacheEntries.exactKey })
      .from(cacheEntries)
      .where(and(...conditions));
  }

  async deleteByIds(workspaceId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(cacheEntries)
      .where(and(eq(cacheEntries.workspaceId, workspaceId), inArray(cacheEntries.id, ids)));
  }

  async deleteExpired(): Promise<number> {
    const rows = await this.db
      .delete(cacheEntries)
      .where(lt(cacheEntries.expiresAt, sql`now()`))
      .returning({ id: cacheEntries.id });
    return rows.length;
  }
}
