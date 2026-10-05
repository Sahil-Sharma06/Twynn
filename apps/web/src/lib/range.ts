const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Dashboard time ranges. Each resolves to concrete dates when a query runs. */
export const RANGES = {
  '24h': { label: 'Last 24 hours', ms: DAY_MS },
  '7d': { label: 'Last 7 days', ms: 7 * DAY_MS },
  '30d': { label: 'Last 30 days', ms: 30 * DAY_MS },
} as const;
export type RangeKey = keyof typeof RANGES;

export const isRangeKey = (value: unknown): value is RangeKey =>
  typeof value === 'string' && value in RANGES;

/** Query string for a range ending now. */
export function rangeParams(range: RangeKey, now = Date.now()): string {
  const params = new URLSearchParams({
    from: new Date(now - RANGES[range].ms).toISOString(),
    to: new Date(now).toISOString(),
  });
  return params.toString();
}

/** The [start, end) window covered by a timeseries bucket. */
export function bucketWindow(t: string, bucket: 'hour' | 'day'): { from: string; to: string } {
  const start = new Date(t).getTime();
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + (bucket === 'hour' ? HOUR_MS : DAY_MS)).toISOString(),
  };
}
