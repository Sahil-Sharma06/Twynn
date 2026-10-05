/** Value of the `X-Twynn-Cache` response header. */
export const CACHE_STATUS = ['HIT', 'MISS', 'BYPASS'] as const;
export type CacheStatus = (typeof CACHE_STATUS)[number];

/** Which layer answered a request. */
export const CACHE_LAYER = ['exact', 'twin', 'upstream'] as const;
export type CacheLayer = (typeof CACHE_LAYER)[number];

/** Response headers the gateway sets on every proxied request. */
export const CACHE_HEADERS = {
  status: 'X-Twynn-Cache',
  layer: 'X-Twynn-Cache-Layer',
  /** Set on twin hits: cosine similarity between the request and the stored prompt. */
  matchScore: 'X-Twynn-Match-Score',
} as const;
