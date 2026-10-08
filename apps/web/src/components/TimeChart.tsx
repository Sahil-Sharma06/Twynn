import type { KeyboardEvent } from 'react';
import type { TimeseriesPoint } from '@twynn/shared';
import { formatBucket, formatInteger, formatMs } from '../lib/format';
import styles from './TimeChart.module.css';

export type ChartMode = 'layers' | 'latency';

const HEIGHT = 100;
const SLOT = 10;
const GAP = 3;
/** Extrusion depth of each bar, in view-box units: a side face to the right and a top cap. */
const DX = 1.6;
const DY = 2.4;

/** Stacked segments per bucket, bottom to top. Requests without a layer (bypass, errors) are "other". */
export function layerSegments(p: TimeseriesPoint) {
  const other = Math.max(0, p.requests - p.exactHits - p.twinHits - p.misses);
  return [
    { key: 'exact', value: p.exactHits },
    { key: 'twin', value: p.twinHits },
    { key: 'miss', value: p.misses },
    { key: 'other', value: other },
  ] as const;
}

/** A round number at or above `max`, so the axis reads cleanly. */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= max) ?? 10;
  return step * magnitude;
}

export function describePoint(p: TimeseriesPoint, bucket: 'hour' | 'day', mode: ChartMode) {
  const when = formatBucket(p.t, bucket);
  if (mode === 'latency') {
    return p.avgLatencyMs === null
      ? `${when}: no requests`
      : `${when}: average latency ${formatMs(Math.round(p.avgLatencyMs))} over ${formatInteger(p.requests)} requests`;
  }
  return `${when}: ${formatInteger(p.requests)} requests, ${formatInteger(p.exactHits)} exact hits, ${formatInteger(p.twinHits)} twin hits, ${formatInteger(p.misses)} misses`;
}

/**
 * Bars (requests by layer) or a line (average latency) over time. Hover or focus a
 * bucket to select it; click pins the selection; arrow keys move it.
 */
export function TimeChart({
  points,
  bucket,
  mode,
  active,
  onHover,
  onPin,
  label,
  pulse = 0,
}: {
  points: TimeseriesPoint[];
  bucket: 'hour' | 'day';
  mode: ChartMode;
  active: number | null;
  onHover: (index: number | null) => void;
  onPin: (index: number | null) => void;
  label: string;
  /** Changes each time live traffic arrives, so the newest bar pulses. */
  pulse?: number;
}) {
  const n = points.length;
  const width = Math.max(1, n) * SLOT;
  const values = points.map((p) => (mode === 'layers' ? p.requests : (p.avgLatencyMs ?? 0)));
  const ceiling = niceCeiling(Math.max(0, ...values));
  // Leave room above the tallest bar for its extruded cap.
  const PLOT = HEIGHT - DY;
  const y = (value: number) => HEIGHT - (value / ceiling) * PLOT;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const current = active ?? n - 1;
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, current - 1)
        : event.key === 'ArrowRight'
          ? Math.min(n - 1, current + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? n - 1
              : undefined;
    if (event.key === 'Escape') {
      onPin(null);
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    onPin(next);
  };

  // Latency line, broken where a bucket had no requests.
  const segments: string[] = [];
  if (mode === 'latency') {
    let run: string[] = [];
    points.forEach((p, i) => {
      if (p.avgLatencyMs === null) {
        if (run.length) segments.push(run.join(' '));
        run = [];
      } else run.push(`${i * SLOT + SLOT / 2},${y(p.avgLatencyMs)}`);
    });
    if (run.length) segments.push(run.join(' '));
  }

  const selected = active !== null ? points[active] : undefined;
  const first = points[0];
  const last = points.at(-1);

  return (
    <div className={styles.chart}>
      <div className={styles.axisY} aria-hidden="true">
        <span>{mode === 'layers' ? formatInteger(ceiling) : formatMs(ceiling)}</span>
        <span>0</span>
      </div>
      <div
        className={styles.plot}
        role="group"
        aria-label={`${label}. Use the left and right arrow keys to move between time buckets.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseLeave={() => onHover(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="none"
          className={styles.svg}
          aria-hidden="true"
        >
          <line x1={0} x2={width} y1={HEIGHT / 2} y2={HEIGHT / 2} className={styles.grid} />
          <g className={styles.bars} key={`${points[0]?.t}-${n}`}>
            {points.map((p, i) => {
              const x = i * SLOT + GAP / 2;
              const w = SLOT - GAP;
              let base = HEIGHT;
              const latest = i === n - 1;
              const stack =
                mode === 'layers'
                  ? layerSegments(p).flatMap(({ key, value }) => {
                      if (value === 0) return [];
                      const h = (value / ceiling) * PLOT;
                      base -= h;
                      return [{ key, top: base, h }];
                    })
                  : [];
              const cap = stack.at(-1);
              return (
                <g
                  key={latest ? `${p.t}-${pulse}` : p.t}
                  data-active={active === i || undefined}
                  data-latest={latest && pulse > 0 ? true : undefined}
                >
                  <rect
                    x={i * SLOT}
                    y={0}
                    width={SLOT}
                    height={HEIGHT}
                    className={styles.slot}
                    onMouseEnter={() => onHover(i)}
                    onClick={() => onPin(i)}
                  />
                  {stack.map(({ key, top, h }) => (
                    <g key={key} className={`${styles.bar} ${styles[key]}`}>
                      <rect x={x} y={top} width={w} height={h} />
                      {/* Side face: the same hue, shaded. */}
                      <polygon
                        className={styles.side}
                        points={`${x + w},${top} ${x + w + DX},${top - DY} ${x + w + DX},${top + h - DY} ${x + w},${top + h}`}
                      />
                    </g>
                  ))}
                  {cap && (
                    <polygon
                      className={`${styles.bar} ${styles[cap.key]} ${styles.cap}`}
                      points={`${x},${cap.top} ${x + DX},${cap.top - DY} ${x + w + DX},${cap.top - DY} ${x + w},${cap.top}`}
                    />
                  )}
                </g>
              );
            })}
          </g>
          {segments.map((pts) => (
            <polyline key={pts} points={pts} className={styles.line} />
          ))}
          {mode === 'latency' && selected?.avgLatencyMs != null && active !== null && (
            <line
              x1={active * SLOT + SLOT / 2}
              x2={active * SLOT + SLOT / 2}
              y1={0}
              y2={HEIGHT}
              className={styles.cursor}
            />
          )}
        </svg>
        <p className="visually-hidden" aria-live="polite">
          {selected ? describePoint(selected, bucket, mode) : ''}
        </p>
      </div>
      <div className={styles.axisX} aria-hidden="true">
        <span>{first ? formatBucket(first.t, bucket) : ''}</span>
        <span>{last ? formatBucket(last.t, bucket) : ''}</span>
      </div>
    </div>
  );
}
