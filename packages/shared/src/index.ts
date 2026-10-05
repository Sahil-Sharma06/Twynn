export const PRODUCT_NAME = 'Twynn';
export const PRODUCT_SLUG = 'twynn';

/** Value of the `X-Twynn-Cache` response header. */
export const CACHE_STATUS = ['HIT', 'MISS', 'BYPASS'] as const;
export type CacheStatus = (typeof CACHE_STATUS)[number];

/** Which layer answered a request. */
export const CACHE_LAYER = ['exact', 'twin', 'upstream'] as const;
export type CacheLayer = (typeof CACHE_LAYER)[number];

/** Single source of truth for user-facing terminology. */
export const VOCABULARY = {
  exactHit: { label: 'Exact hit', technical: 'Layer 1 exact-match cache hit' },
  twinHit: { label: 'Twin hit', technical: 'Layer 2 semantic cache hit' },
  matchScore: { label: 'Match score', technical: 'Cosine similarity' },
  twinThreshold: { label: 'Twin threshold', technical: 'Minimum cosine similarity for a twin hit' },
} as const;
