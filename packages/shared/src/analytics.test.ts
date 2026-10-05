import { describe, expect, it } from 'vitest';
import { twinHitsAt } from './analytics';

describe('twinHitsAt', () => {
  const buckets = [
    { score: 0.42, count: 3 },
    { score: 0.949, count: 2 },
    { score: 0.95, count: 4 },
    { score: 0.991, count: 1 },
  ];

  it('counts searches at or above the threshold (inclusive)', () => {
    expect(twinHitsAt(buckets, 0.95)).toBe(5);
    expect(twinHitsAt(buckets, 0.949)).toBe(7);
    expect(twinHitsAt(buckets, 0.5)).toBe(7);
    expect(twinHitsAt(buckets, 1)).toBe(0);
  });

  it('is not thrown off by floating-point thresholds', () => {
    // 0.1 + 0.85 is 0.9499999999999999 in floating point.
    expect(twinHitsAt(buckets, 0.1 + 0.85)).toBe(5);
  });

  it('is zero with no traffic', () => {
    expect(twinHitsAt([], 0.9)).toBe(0);
  });
});
