const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const usdSmall = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 2,
});
const integer = new Intl.NumberFormat('en-US');
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

/** Cost estimates span fractions of a cent to dollars, so small values keep two significant digits. */
export function formatUsd(value: number): string {
  if (value === 0) return usd.format(0);
  return Math.abs(value) < 0.01 ? usdSmall.format(value) : usd.format(value);
}

export const formatInteger = (value: number) => integer.format(value);
export const formatPercent = (value: number) => percent.format(value);
export const formatMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

const hourFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' });

/** Label for a timeseries bucket, in the viewer's time zone. */
export const formatBucket = (iso: string, bucket: 'hour' | 'day') =>
  (bucket === 'hour' ? hourFormat : dayFormat).format(new Date(iso));

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** Match scores are cosine similarities; three decimals tell close calls apart. */
export const formatScore = (score: number) => score.toFixed(3);

/** Durations such as cache TTLs, in the largest whole unit. */
export function formatDuration(seconds: number): string {
  const units: Array<[number, string]> = [
    [86_400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${unit}${n === 1 ? '' : 's'}`;
    }
  }
  return `${seconds} seconds`;
}
