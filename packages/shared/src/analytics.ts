import { z } from 'zod';
import { CACHE_LAYER, CACHE_STATUS, type CacheLayer, type CacheStatus } from './cache';

export const MAX_RANGE_DAYS = 90;

/** Prompts are stored in the request log truncated to this many characters. */
export const PROMPT_PREVIEW_CHARS = 280;
const DAY_MS = 86_400_000;

/** Time range for analytics; defaults to the last 24 hours. */
export const rangeQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    bucket: z.enum(['hour', 'day']).optional(),
  })
  .transform(({ from, to, bucket }, ctx) => {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - DAY_MS);
    if (start >= end) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'must be before "to"' });
      return z.NEVER;
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: `range exceeds ${MAX_RANGE_DAYS} days`,
      });
      return z.NEVER;
    }
    // Hourly buckets up to a week, daily beyond.
    const auto = end.getTime() - start.getTime() <= 7 * DAY_MS ? 'hour' : 'day';
    return { from: start, to: end, bucket: bucket ?? auto };
  });
export type RangeQuery = z.output<typeof rangeQuerySchema>;

export const requestFiltersSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  layer: z.enum(CACHE_LAYER).optional(),
  status: z.enum(CACHE_STATUS).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  keyId: z.string().uuid().optional(),
  /** Case-insensitive search in the prompt preview and model. */
  q: z.string().trim().min(1).max(200).optional(),
  errorsOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type RequestFilters = z.output<typeof requestFiltersSchema>;

export interface RequestLogView {
  id: string;
  createdAt: string;
  keyId: string | null;
  model: string | null;
  /** Null when the request never reached the cache (for example, it failed validation). */
  layer: CacheLayer | null;
  status: CacheStatus | null;
  statusCode: number;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  matchScore: number | null;
  promptPreview: string | null;
  /** Estimated cost avoided by this hit; null for misses and unpriced models. */
  costSavedUsd: number | null;
}

export interface RequestDetailView extends RequestLogView {
  /** The stored prompt the twin search found closest: the match itself for twin hits. */
  matchedPrompt: string | null;
  /** Score of that closest stored prompt; null when no twin search ran. */
  nearestScore: number | null;
  embeddingModel: string | null;
  embeddingTokens: number | null;
}

export interface RequestPage {
  requests: RequestLogView[];
  nextCursor: string | null;
}

export interface LatencyStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface CostEstimate {
  /** Cost of the provider calls that hits avoided. */
  savedUsd: number;
  /** Cost of the embeddings calls the twin layer made. */
  embeddingUsd: number;
  netUsd: number;
  /** Models seen in the range that have no price, so are excluded from the figures. */
  unpricedModels: string[];
  pricingAsOf: string;
}

export interface AnalyticsSummary {
  from: string;
  to: string;
  requests: number;
  exactHits: number;
  twinHits: number;
  misses: number;
  bypassed: number;
  errors: number;
  /** (exact + twin) / (exact + twin + misses); null with no cacheable traffic. */
  hitRate: number | null;
  tokensSaved: number;
  latency: Record<CacheLayer, LatencyStats | null>;
  cost: CostEstimate;
}

export interface TimeseriesPoint {
  t: string;
  requests: number;
  exactHits: number;
  twinHits: number;
  misses: number;
  errors: number;
  avgLatencyMs: number | null;
  costSavedUsd: number;
}

export interface Timeseries {
  from: string;
  to: string;
  bucket: 'hour' | 'day';
  points: TimeseriesPoint[];
}

export interface ModelBreakdown {
  model: string;
  requests: number;
  exactHits: number;
  twinHits: number;
  misses: number;
  hitRate: number | null;
  tokensSaved: number;
  /** Null when the model has no price. */
  costSavedUsd: number | null;
}

/** Live event pushed over GET /api/events. */
export interface RequestEvent {
  type: 'request';
  request: RequestLogView;
}

export const thresholdPreviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});

/** How the workspace's recent twin searches scored, to preview a different twin threshold. */
export interface ThresholdPreview {
  days: number;
  /** Twin searches in the window that found a candidate (requests that missed Layer 1). */
  searches: number;
  /** Nearest-candidate scores, floored to 0.001, with how many searches scored each. */
  buckets: Array<{ score: number; count: number }>;
  /** Recent searches scoring at least EXAMPLE_MIN_SCORE, newest first, to show real borderline pairs. */
  examples: Array<{
    requestId: string;
    createdAt: string;
    score: number;
    prompt: string | null;
    matchedPrompt: string | null;
  }>;
}

export const PREVIEW_EXAMPLE_MIN_SCORE = 0.75;

/** Searches in a preview whose nearest candidate would be served at `threshold` (inclusive). */
export function twinHitsAt(buckets: ThresholdPreview['buckets'], threshold: number): number {
  const min = Math.round(threshold * 1000);
  return buckets.reduce((n, b) => (Math.round(b.score * 1000) >= min ? n + b.count : n), 0);
}
