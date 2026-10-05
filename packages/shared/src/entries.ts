import { z } from 'zod';

export const cacheEntryFiltersSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  /** Case-insensitive search in the stored prompt. */
  q: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CacheEntryFilters = z.output<typeof cacheEntryFiltersSchema>;

/** Bulk invalidation. At least one criterion is required; `all` must be explicit. */
export const invalidateSchema = z
  .object({
    model: z.string().trim().min(1).max(200).optional(),
    /** Deletes entries created more than this many seconds ago. */
    olderThanSeconds: z.number().int().positive().optional(),
    all: z.literal(true).optional(),
  })
  .refine((v) => v.all || v.model !== undefined || v.olderThanSeconds !== undefined, {
    message: 'Specify model, olderThanSeconds, or all: true',
  })
  .refine((v) => !(v.all && (v.model !== undefined || v.olderThanSeconds !== undefined)), {
    message: '"all" cannot be combined with other criteria',
  });
export type InvalidateInput = z.infer<typeof invalidateSchema>;

export interface CacheEntryView {
  id: string;
  model: string;
  prompt: string | null;
  /** Whether the entry can serve twin hits (it has an embedding). */
  twinEligible: boolean;
  hitCount: number;
  lastHitAt: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface CacheEntryDetail extends CacheEntryView {
  /** The stored chat completion as returned to callers. */
  response: unknown;
}

export interface CacheEntryPage {
  entries: CacheEntryView[];
  nextCursor: string | null;
}
