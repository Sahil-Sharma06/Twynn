export const PRODUCT_NAME = 'Twynn';
export const PRODUCT_SLUG = 'twynn';

/** Single source of truth for user-facing terminology. */
export const VOCABULARY = {
  exactHit: { label: 'Exact hit', technical: 'Layer 1 exact-match cache hit' },
  twinHit: { label: 'Twin hit', technical: 'Layer 2 semantic cache hit' },
  matchScore: { label: 'Match score', technical: 'Cosine similarity' },
  twinThreshold: { label: 'Twin threshold', technical: 'Minimum cosine similarity for a twin hit' },
} as const;

export * from './analytics';
export * from './api';
export * from './cache';
export * from './pricing';
