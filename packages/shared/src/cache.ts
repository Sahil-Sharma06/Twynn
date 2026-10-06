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

/** Request header a caller sends to skip cache lookups and get (and store) a fresh answer. */
export const CACHE_CONTROL_HEADER = 'X-Twynn-Cache-Control';
export const CACHE_CONTROL_NO_CACHE = 'no-cache';

/** Response header carrying the request's id in the Twynn request log. */
export const REQUEST_ID_HEADER = 'X-Twynn-Request-Id';

/** Where a logged request came from: an app using a gateway key, or the dashboard playground. */
export const REQUEST_SOURCE = ['api', 'playground'] as const;
export type RequestSource = (typeof REQUEST_SOURCE)[number];
