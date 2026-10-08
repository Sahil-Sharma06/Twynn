import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimeseriesPoint } from '@twynn/shared';
import { TimeChart } from './TimeChart';

const point = (t: string, overrides: Partial<TimeseriesPoint> = {}): TimeseriesPoint => ({
  t,
  requests: 4,
  exactHits: 1,
  twinHits: 1,
  misses: 2,
  errors: 0,
  avgLatencyMs: 100,
  costSavedUsd: 0,
  ...overrides,
});

const points = [
  point('2026-10-05T00:00:00.000Z'),
  point('2026-10-05T01:00:00.000Z', { requests: 0, exactHits: 0, twinHits: 0, misses: 0 }),
  point('2026-10-05T02:00:00.000Z'),
];

const chart = (props: Partial<Parameters<typeof TimeChart>[0]> = {}) => (
  <TimeChart
    points={points}
    bucket="hour"
    mode="layers"
    active={null}
    onHover={() => {}}
    onPin={() => {}}
    label="Traffic"
    {...props}
  />
);

describe('TimeChart bars', () => {
  it('extrudes each stack: a side face per segment and one cap on top', () => {
    const { container } = render(chart());
    // Two non-empty buckets, three segments each (exact, twin, miss): 6 sides + 2 caps.
    expect(container.querySelectorAll('polygon')).toHaveLength(8);
    // The empty bucket draws nothing but its hover slot.
    expect(container.querySelectorAll('rect')).toHaveLength(3 + 6);
  });

  it('marks the newest bar to pulse only once live traffic has arrived', () => {
    const { container, rerender } = render(chart());
    expect(container.querySelector('g[data-latest]')).toBeNull();
    rerender(chart({ pulse: 1 }));
    expect(container.querySelector('g[data-latest]')).not.toBeNull();
  });

  it('draws no bars in latency mode', () => {
    const { container } = render(chart({ mode: 'latency' }));
    expect(container.querySelectorAll('polygon')).toHaveLength(0);
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0);
  });
});
