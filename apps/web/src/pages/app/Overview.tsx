import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  VOCABULARY,
  type AnalyticsSummary,
  type CacheLayer,
  type RequestLogView,
  type RequestPage,
  type TimeseriesPoint,
} from '@twynn/shared';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { ButtonLink } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { RequestList } from '../../components/RequestList';
import { Skeleton } from '../../components/Spinner';
import { TimeChart, type ChartMode } from '../../components/TimeChart';
import { EmptyState, PageHeader, Panel, Segmented } from '../../components/Ui';
import { useRequestEvents, type StreamStatus } from '../../lib/events';
import { formatBucket, formatInteger, formatMs, formatPercent, formatUsd } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import {
  keys,
  toQuery,
  useModels,
  useProvider,
  useRecentRequests,
  useRequestLog,
  useSummary,
  useTimeseries,
} from '../../lib/queries';
import { bucketWindow, isRangeKey, RANGES, type RangeKey } from '../../lib/range';
import styles from './Overview.module.css';

const FEED_SIZE = 10;
const RANGE_OPTIONS = (Object.keys(RANGES) as RangeKey[]).map((value) => ({
  value,
  label: value,
}));

function LiveIndicator({ status }: { status: StreamStatus }) {
  return (
    <p className={styles.live} data-status={status}>
      <span className={styles.liveDot} aria-hidden="true" />
      {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
    </p>
  );
}

/** How many times `value` has changed since mount. */
function useChangeCount(value: unknown): number {
  const [state, setState] = useState({ value, count: 0 });
  if (!Object.is(state.value, value)) setState({ value, count: state.count + 1 });
  return Object.is(state.value, value) ? state.count : state.count + 1;
}

/** A headline number that eases to new values and glows briefly when it changes. */
function Stat({
  label,
  value,
  format,
  note,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  note?: string;
}) {
  const changes = useChangeCount(value);
  return (
    <div className={styles.stat}>
      {changes > 0 && <span key={changes} className={styles.glow} aria-hidden="true" />}
      <dt>{label}</dt>
      <dd>
        <span className={styles.value}>
          {value === null ? 'None yet' : <AnimatedNumber value={value} format={format} />}
        </span>
        {note && <span className={styles.note}>{note}</span>}
      </dd>
    </div>
  );
}

function Stats({ s }: { s: AnalyticsSummary | undefined }) {
  if (!s) {
    return (
      <div className={styles.stats}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height="6rem" />
        ))}
      </div>
    );
  }
  return (
    <dl className={styles.stats}>
      <Stat label="Requests" value={s.requests} format={(n) => formatInteger(Math.round(n))} />
      <Stat
        label="Hit rate"
        value={s.hitRate}
        format={formatPercent}
        note={`${formatInteger(s.exactHits)} exact · ${formatInteger(s.twinHits)} twin`}
      />
      <Stat
        label="Estimated net saved"
        value={s.cost.netUsd}
        format={formatUsd}
        note={`After ${formatUsd(s.cost.embeddingUsd)} of embeddings`}
      />
      <Stat
        label="Tokens served from cache"
        value={s.tokensSaved}
        format={(n) => formatInteger(Math.round(n))}
      />
    </dl>
  );
}

/** The requests behind the selected bucket, fetched once the pointer settles. */
function BucketDetail({ point, bucket }: { point: TimeseriesPoint; bucket: 'hour' | 'day' }) {
  const settled = useDebounced(point, 150);
  const span = bucketWindow(settled.t, bucket);
  const log = useRequestLog({ ...span, limit: 5 }, { enabled: settled.requests > 0 });
  const requests = log.data?.pages[0]?.requests ?? [];
  return (
    <div className={styles.bucket}>
      <div className={styles.bucketHead}>
        <p className={styles.bucketTitle}>{formatBucket(point.t, bucket)}</p>
        <p className={styles.bucketMeta}>
          {formatInteger(point.requests)} requests · {formatInteger(point.exactHits)} exact ·{' '}
          {formatInteger(point.twinHits)} twin · {formatInteger(point.misses)} misses
          {point.avgLatencyMs !== null && ` · avg ${formatMs(Math.round(point.avgLatencyMs))}`}
          {point.costSavedUsd > 0 && ` · ${formatUsd(point.costSavedUsd)} saved`}
        </p>
      </div>
      {point.requests === 0 ? (
        <p className={styles.muted}>No requests in this period.</p>
      ) : log.isPending || settled.t !== point.t ? (
        <Skeleton height="6rem" />
      ) : (
        <>
          <RequestList requests={requests} />
          <Link to={`/app/requests?${toQuery(span)}`} className={styles.more}>
            See all {formatInteger(point.requests)} in the explorer{' '}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </>
      )}
    </div>
  );
}

function TrafficPanel({ range, pulse }: { range: RangeKey; pulse: number }) {
  const series = useTimeseries(range);
  const [mode, setMode] = useState<ChartMode>('layers');
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  useEffect(() => setPinned(null), [range]);

  const data = series.data;
  const active = hovered ?? pinned;
  const point = active !== null ? data?.points[active] : undefined;

  return (
    <Panel
      title="Traffic"
      description="Hover or select a bar to see the requests behind it."
      actions={
        <Segmented
          label="Chart"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'layers', label: 'Requests by layer' },
            { value: 'latency', label: 'Latency' },
          ]}
        />
      }
    >
      {series.isError ? (
        <Callout tone="error">The chart could not be loaded. Refresh to try again.</Callout>
      ) : !data ? (
        <Skeleton height="13rem" />
      ) : (
        <>
          <TimeChart
            points={data.points}
            bucket={data.bucket}
            mode={mode}
            active={active}
            onHover={setHovered}
            onPin={(i) => setPinned((current) => (current === i ? null : i))}
            pulse={pulse}
            label={mode === 'layers' ? 'Requests by layer over time' : 'Average latency over time'}
          />
          {mode === 'layers' && (
            <ul className={styles.legend} aria-label="Legend">
              <li data-layer="exact">{VOCABULARY.exactHit.label}</li>
              <li data-layer="twin">{VOCABULARY.twinHit.label}</li>
              <li data-layer="miss">Miss</li>
              <li data-layer="other">Bypassed or not served</li>
            </ul>
          )}
          {point && <BucketDetail point={point} bucket={data.bucket} />}
        </>
      )}
    </Panel>
  );
}

const LAYERS: Array<{ key: string; label: string; layer?: CacheLayer }> = [
  { key: 'exact', label: VOCABULARY.exactHit.label, layer: 'exact' },
  { key: 'twin', label: VOCABULARY.twinHit.label, layer: 'twin' },
  { key: 'miss', label: 'Miss', layer: 'upstream' },
  { key: 'other', label: 'Bypassed or not served' },
];

function LayerBreakdown({ s }: { s: AnalyticsSummary }) {
  const counts: Record<string, number> = {
    exact: s.exactHits,
    twin: s.twinHits,
    miss: s.misses,
    other: Math.max(0, s.requests - s.exactHits - s.twinHits - s.misses),
  };
  return (
    <Panel title="Where answers came from">
      <div className={styles.split} aria-hidden="true">
        {LAYERS.map(({ key }) =>
          counts[key] ? (
            <span
              key={key}
              data-layer={key}
              style={{ flexGrow: counts[key] }}
              title={`${formatInteger(counts[key])}`}
            />
          ) : null,
        )}
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Layer</th>
            <th scope="col">Requests</th>
            <th scope="col">Share</th>
            <th scope="col">p50</th>
            <th scope="col">p95</th>
          </tr>
        </thead>
        <tbody>
          {LAYERS.map(({ key, label, layer }) => {
            const latency = layer ? s.latency[layer] : null;
            const count = counts[key] ?? 0;
            return (
              <tr key={key}>
                <th scope="row">
                  <span className={styles.swatch} data-layer={key} aria-hidden="true" />
                  {label}
                </th>
                <td>{formatInteger(count)}</td>
                <td>{s.requests ? formatPercent(count / s.requests) : '–'}</td>
                <td>{latency ? formatMs(latency.p50Ms) : '–'}</td>
                <td>{latency ? formatMs(latency.p95Ms) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function CostPanel({ s }: { s: AnalyticsSummary }) {
  return (
    <Panel
      title="Estimated cost"
      description={`From provider list prices as of ${s.cost.pricingAsOf}; your actual rates may differ.`}
    >
      <dl className={styles.cost}>
        <div>
          <dt>Provider calls avoided</dt>
          <dd>{formatUsd(s.cost.savedUsd)}</dd>
        </div>
        <div>
          <dt>Embeddings for twin matching</dt>
          <dd>−{formatUsd(s.cost.embeddingUsd)}</dd>
        </div>
        <div className={styles.costTotal}>
          <dt>Net saved</dt>
          <dd>{formatUsd(s.cost.netUsd)}</dd>
        </div>
      </dl>
      {s.cost.unpricedModels.length > 0 && (
        <p className={styles.muted}>
          Not included, because Twynn has no price for them: {s.cost.unpricedModels.join(', ')}.
        </p>
      )}
    </Panel>
  );
}

function ModelsPanel({ range }: { range: RangeKey }) {
  const models = useModels(range);
  return (
    <Panel title="By model">
      {models.isError ? (
        <Callout tone="error">
          The model breakdown could not be loaded. Refresh to try again.
        </Callout>
      ) : !models.data ? (
        <Skeleton height="6rem" />
      ) : models.data.length === 0 ? (
        <p className={styles.muted}>No requests in this period.</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Requests</th>
                <th scope="col">Hit rate</th>
                <th scope="col">Tokens from cache</th>
                <th scope="col">Est. saved</th>
              </tr>
            </thead>
            <tbody>
              {models.data.map((m) => (
                <tr key={m.model}>
                  <th scope="row">
                    <Link to={`/app/requests?${toQuery({ model: m.model })}`}>{m.model}</Link>
                  </th>
                  <td>{formatInteger(m.requests)}</td>
                  <td>{m.hitRate === null ? '–' : formatPercent(m.hitRate)}</td>
                  <td>{formatInteger(m.tokensSaved)}</td>
                  <td>{m.costSavedUsd === null ? 'No price' : formatUsd(m.costSavedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** The live dashboard: headline numbers, traffic over time, layers, cost and a live feed. */
export function Overview() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const rangeParam = params.get('range');
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : '24h';
  const provider = useProvider();
  const summary = useSummary(range);
  const recent = useRecentRequests(FEED_SIZE);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [pulse, setPulse] = useState(0);

  // Each live request lands in the feed at once; aggregates refresh at most every 2 seconds.
  const refresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(refresh.current ?? undefined), []);
  const status = useRequestEvents((request: RequestLogView) => {
    client.setQueryData<RequestPage>([...keys.recentRequests, FEED_SIZE], (page) =>
      page && !page.requests.some((r) => r.id === request.id)
        ? { ...page, requests: [request, ...page.requests].slice(0, FEED_SIZE) }
        : page,
    );
    setFresh((ids) => new Set(ids).add(request.id));
    setPulse((n) => n + 1);
    refresh.current ??= setTimeout(() => {
      refresh.current = null;
      void client.invalidateQueries({ queryKey: keys.analytics });
    }, 2000);
  });

  const s = summary.data;
  const noTraffic = s?.requests === 0 && recent.data?.requests.length === 0;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Overview"
        description={RANGES[range].label}
        actions={
          <>
            <LiveIndicator status={status} />
            <Segmented
              label="Time range"
              value={range}
              onChange={(value) => setParams(value === '24h' ? {} : { range: value })}
              options={RANGE_OPTIONS}
            />
          </>
        }
      />

      {provider.data === null && (
        <Callout title="Finish setting up">
          Connect a provider and create a key to start routing traffic.{' '}
          <Link to="/onboarding">Continue setup</Link>
        </Callout>
      )}

      {summary.isError ? (
        <Callout tone="error" title="We could not load your analytics">
          Refresh the page to try again.
        </Callout>
      ) : (
        <Stats s={s} />
      )}

      {noTraffic ? (
        <Panel>
          <EmptyState
            title="No traffic yet"
            action={
              <ButtonLink
                to="/onboarding"
                variant="secondary"
                icon={<ArrowRight size={16} aria-hidden="true" />}
              >
                Get a ready-to-run snippet
              </ButtonLink>
            }
          >
            When your app sends a request through Twynn, this dashboard comes alive: each request
            appears the moment it is answered, labelled {VOCABULARY.exactHit.label.toLowerCase()},{' '}
            {VOCABULARY.twinHit.label.toLowerCase()} or miss.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <TrafficPanel range={range} pulse={pulse} />
          <div className={styles.columns}>
            <Panel
              title="Live feed"
              actions={
                <Link to="/app/requests" className={styles.more}>
                  Explore all <ArrowRight size={14} aria-hidden="true" />
                </Link>
              }
            >
              {recent.isError ? (
                <Callout tone="error">
                  The live feed could not be loaded. Refresh to try again.
                </Callout>
              ) : recent.data ? (
                <div aria-live="polite" aria-relevant="additions">
                  <RequestList requests={recent.data.requests} fresh={fresh} />
                </div>
              ) : (
                <Skeleton height="14rem" />
              )}
            </Panel>
            <div className={styles.stack}>
              {s ? <LayerBreakdown s={s} /> : !summary.isError && <Skeleton height="14rem" />}
              {s && <CostPanel s={s} />}
            </div>
          </div>
          <ModelsPanel range={range} />
        </>
      )}
    </div>
  );
}
