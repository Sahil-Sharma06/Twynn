import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  CACHE_LAYER,
  PRICING,
  chatCostUsd,
  embeddingCostUsd,
  type AnalyticsSummary,
  type CacheLayer,
  type LatencyStats,
  type ModelBreakdown,
  type RangeQuery,
  type RequestDetailView,
  type RequestFilters,
  type RequestPage,
  type Timeseries,
  type TimeseriesPoint,
} from '@twynn/shared';
import type { Database } from '../db/client';
import { requestLogs } from '../db/schema';
import { decodeCursor, encodeCursor, escapeLike } from '../lib/pagination';
import { toLogView } from './recorder';

type Bucket = 'hour' | 'day';
const BUCKET_MS: Record<Bucket, number> = { hour: 3_600_000, day: 86_400_000 };

/** One aggregated group of request rows. */
interface Group {
  t: Date | null;
  model: string | null;
  embeddingModel: string | null;
  layer: CacheLayer | null;
  status: string | null;
  count: number;
  errors: number;
  latencySum: number;
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
}

const num = (expr: SQL) => sql<number>`${expr}`.mapWith(Number);

function inRange(workspaceId: string, from: Date, to: Date) {
  return and(
    eq(requestLogs.workspaceId, workspaceId),
    gte(requestLogs.createdAt, from),
    lt(requestLogs.createdAt, to),
  );
}

/** The single aggregation every analytics view is derived from. */
async function aggregate(
  db: Database,
  workspaceId: string,
  range: { from: Date; to: Date },
  bucket?: Bucket,
): Promise<Group[]> {
  const t = bucket
    ? sql<Date>`date_trunc(${sql.raw(`'${bucket}'`)}, ${requestLogs.createdAt}, 'UTC')`.mapWith(
        (v: string | Date) => new Date(v),
      )
    : sql<null>`null`;
  const okRows = sql`${requestLogs.statusCode} = 200`;
  const rows = await db
    .select({
      t,
      model: requestLogs.model,
      embeddingModel: requestLogs.embeddingModel,
      layer: requestLogs.layer,
      status: requestLogs.status,
      count: num(sql`count(*)`),
      errors: num(sql`count(*) filter (where ${requestLogs.statusCode} >= 400)`),
      latencySum: num(sql`coalesce(sum(${requestLogs.latencyMs}), 0)`),
      promptTokens: num(
        sql`coalesce(sum(${requestLogs.promptTokens}) filter (where ${okRows}), 0)`,
      ),
      completionTokens: num(
        sql`coalesce(sum(${requestLogs.completionTokens}) filter (where ${okRows}), 0)`,
      ),
      embeddingTokens: num(sql`coalesce(sum(${requestLogs.embeddingTokens}), 0)`),
    })
    .from(requestLogs)
    .where(inRange(workspaceId, range.from, range.to))
    .groupBy(
      ...(bucket ? [sql`1`] : []),
      requestLogs.model,
      requestLogs.embeddingModel,
      requestLogs.layer,
      requestLogs.status,
    );
  return rows as Group[];
}

const isHit = (g: Group) => (g.layer === 'exact' || g.layer === 'twin') && g.status === 'HIT';
const isMiss = (g: Group) => g.layer === 'upstream' && g.status === 'MISS';

interface Totals {
  requests: number;
  exactHits: number;
  twinHits: number;
  misses: number;
  bypassed: number;
  errors: number;
  latencySum: number;
  tokensSaved: number;
  savedUsd: number;
  embeddingUsd: number;
  unpriced: Set<string>;
}

function fold(groups: Group[]): Totals {
  const totals: Totals = {
    requests: 0,
    exactHits: 0,
    twinHits: 0,
    misses: 0,
    bypassed: 0,
    errors: 0,
    latencySum: 0,
    tokensSaved: 0,
    savedUsd: 0,
    embeddingUsd: 0,
    unpriced: new Set(),
  };
  for (const g of groups) {
    totals.requests += g.count;
    totals.errors += g.errors;
    totals.latencySum += g.latencySum;
    if (g.status === 'BYPASS') totals.bypassed += g.count;
    if (isMiss(g)) totals.misses += g.count;
    if (isHit(g)) {
      if (g.layer === 'exact') totals.exactHits += g.count;
      else totals.twinHits += g.count;
      totals.tokensSaved += g.promptTokens + g.completionTokens;
      const cost = g.model ? chatCostUsd(g.model, g.promptTokens, g.completionTokens) : null;
      if (cost === null) {
        if (g.model) totals.unpriced.add(g.model);
      } else totals.savedUsd += cost;
    }
    if (g.embeddingModel && g.embeddingTokens > 0) {
      const cost = embeddingCostUsd(g.embeddingModel, g.embeddingTokens);
      if (cost === null) totals.unpriced.add(g.embeddingModel);
      else totals.embeddingUsd += cost;
    }
  }
  return totals;
}

const hitRate = (t: Pick<Totals, 'exactHits' | 'twinHits' | 'misses'>) => {
  const cacheable = t.exactHits + t.twinHits + t.misses;
  return cacheable === 0 ? null : (t.exactHits + t.twinHits) / cacheable;
};

async function latencyByLayer(
  db: Database,
  workspaceId: string,
  range: RangeQuery,
): Promise<Record<CacheLayer, LatencyStats | null>> {
  const rows = await db
    .select({
      layer: requestLogs.layer,
      avgMs: num(sql`avg(${requestLogs.latencyMs})`),
      p50Ms: num(sql`percentile_cont(0.5) within group (order by ${requestLogs.latencyMs})`),
      p95Ms: num(sql`percentile_cont(0.95) within group (order by ${requestLogs.latencyMs})`),
    })
    .from(requestLogs)
    .where(and(inRange(workspaceId, range.from, range.to), lt(requestLogs.statusCode, 400)))
    .groupBy(requestLogs.layer);
  const result = Object.fromEntries(CACHE_LAYER.map((l) => [l, null])) as Record<
    CacheLayer,
    LatencyStats | null
  >;
  for (const row of rows) {
    if (row.layer) {
      result[row.layer] = {
        avgMs: Math.round(row.avgMs),
        p50Ms: Math.round(row.p50Ms),
        p95Ms: Math.round(row.p95Ms),
      };
    }
  }
  return result;
}

export async function summary(
  db: Database,
  workspaceId: string,
  range: RangeQuery,
): Promise<AnalyticsSummary> {
  const [groups, latency] = await Promise.all([
    aggregate(db, workspaceId, range),
    latencyByLayer(db, workspaceId, range),
  ]);
  const t = fold(groups);
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    requests: t.requests,
    exactHits: t.exactHits,
    twinHits: t.twinHits,
    misses: t.misses,
    bypassed: t.bypassed,
    errors: t.errors,
    hitRate: hitRate(t),
    tokensSaved: t.tokensSaved,
    latency,
    cost: {
      savedUsd: t.savedUsd,
      embeddingUsd: t.embeddingUsd,
      netUsd: t.savedUsd - t.embeddingUsd,
      unpricedModels: [...t.unpriced].sort(),
      pricingAsOf: PRICING.asOf,
    },
  };
}

/** Bucket start times covering [from, to), aligned to UTC. */
export function bucketStarts(from: Date, to: Date, bucket: Bucket): Date[] {
  const step = BUCKET_MS[bucket];
  const starts: Date[] = [];
  for (let t = Math.floor(from.getTime() / step) * step; t < to.getTime(); t += step) {
    starts.push(new Date(t));
  }
  return starts;
}

export async function timeseries(
  db: Database,
  workspaceId: string,
  range: RangeQuery,
): Promise<Timeseries> {
  const groups = await aggregate(db, workspaceId, range, range.bucket);
  const byBucket = new Map<number, Group[]>();
  for (const g of groups) {
    const key = g.t?.getTime() ?? 0;
    byBucket.set(key, [...(byBucket.get(key) ?? []), g]);
  }
  const points: TimeseriesPoint[] = bucketStarts(range.from, range.to, range.bucket).map((t) => {
    const totals = fold(byBucket.get(t.getTime()) ?? []);
    return {
      t: t.toISOString(),
      requests: totals.requests,
      exactHits: totals.exactHits,
      twinHits: totals.twinHits,
      misses: totals.misses,
      errors: totals.errors,
      avgLatencyMs: totals.requests ? Math.round(totals.latencySum / totals.requests) : null,
      costSavedUsd: totals.savedUsd,
    };
  });
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    bucket: range.bucket,
    points,
  };
}

export async function models(
  db: Database,
  workspaceId: string,
  range: RangeQuery,
): Promise<ModelBreakdown[]> {
  const byModel = new Map<string, Group[]>();
  for (const g of await aggregate(db, workspaceId, range)) {
    if (g.model) byModel.set(g.model, [...(byModel.get(g.model) ?? []), g]);
  }
  return [...byModel.entries()]
    .map(([model, groups]) => {
      const t = fold(groups);
      return {
        model,
        requests: t.requests,
        exactHits: t.exactHits,
        twinHits: t.twinHits,
        misses: t.misses,
        hitRate: hitRate(t),
        tokensSaved: t.tokensSaved,
        costSavedUsd: t.unpriced.has(model) ? null : t.savedUsd,
      };
    })
    .sort((a, b) => b.requests - a.requests);
}

export async function listRequests(
  db: Database,
  workspaceId: string,
  filters: RequestFilters,
): Promise<RequestPage> {
  const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
  const conditions: Array<SQL | undefined> = [eq(requestLogs.workspaceId, workspaceId)];
  if (filters.from) conditions.push(gte(requestLogs.createdAt, filters.from));
  if (filters.to) conditions.push(lt(requestLogs.createdAt, filters.to));
  if (filters.layer) conditions.push(eq(requestLogs.layer, filters.layer));
  if (filters.status) conditions.push(eq(requestLogs.status, filters.status));
  if (filters.model) conditions.push(eq(requestLogs.model, filters.model));
  if (filters.keyId) conditions.push(eq(requestLogs.keyId, filters.keyId));
  if (filters.errorsOnly) conditions.push(gte(requestLogs.statusCode, 400));
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    conditions.push(
      or(ilike(requestLogs.promptPreview, pattern), ilike(requestLogs.model, pattern)),
    );
  }
  if (cursor) {
    conditions.push(
      sql`(${requestLogs.createdAt}, ${requestLogs.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select()
    .from(requestLogs)
    .where(and(...conditions))
    .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
    .limit(filters.limit + 1);
  const page = rows.slice(0, filters.limit);
  const last = page.at(-1);
  return {
    requests: page.map(toLogView),
    nextCursor: rows.length > filters.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getRequest(
  db: Database,
  workspaceId: string,
  id: string,
): Promise<RequestDetailView | null> {
  const [row] = await db
    .select()
    .from(requestLogs)
    .where(and(eq(requestLogs.id, id), eq(requestLogs.workspaceId, workspaceId)));
  if (!row) return null;
  return {
    ...toLogView(row),
    matchedPrompt: row.matchedPrompt,
    embeddingModel: row.embeddingModel,
    embeddingTokens: row.embeddingTokens,
  };
}

/** Deletes request logs older than the retention window. Returns the number deleted. */
export async function deleteOldLogs(db: Database, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * BUCKET_MS.day);
  const rows = await db
    .delete(requestLogs)
    .where(lt(requestLogs.createdAt, cutoff))
    .returning({ id: requestLogs.id });
  return rows.length;
}
