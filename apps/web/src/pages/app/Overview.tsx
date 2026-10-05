import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { PRICING, VOCABULARY, type RequestLogView } from '@twynn/shared';
import { ButtonLink } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { LayerBadge } from '../../components/LayerBadge';
import { Mark } from '../../components/Logo';
import { Skeleton } from '../../components/Spinner';
import { useRequestEvents } from '../../lib/events';
import {
  formatInteger,
  formatMs,
  formatPercent,
  formatRelative,
  formatUsd,
} from '../../lib/format';
import { keys, useProvider, useRecentRequests, useSummary } from '../../lib/queries';
import styles from './Overview.module.css';

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>
        <span className={styles.value}>{value}</span>
        {note && <span className={styles.note}>{note}</span>}
      </dd>
    </div>
  );
}

function RecentRow({ request }: { request: RequestLogView }) {
  return (
    <li className={styles.row}>
      <LayerBadge layer={request.layer} status={request.status} />
      <span className={styles.prompt}>{request.promptPreview ?? '(no text)'}</span>
      <span className={styles.meta}>{request.model}</span>
      <span className={styles.meta}>{formatMs(request.latencyMs)}</span>
      <time className={styles.meta} dateTime={request.createdAt}>
        {formatRelative(request.createdAt)}
      </time>
    </li>
  );
}

/** Signed-in home: the last 24 hours at a glance. The full dashboard builds on this. */
export function Overview() {
  const client = useQueryClient();
  const provider = useProvider();
  const summary = useSummary();
  const recent = useRecentRequests(8);
  const status = useRequestEvents(() => {
    void client.invalidateQueries({ queryKey: keys.summary });
    void client.invalidateQueries({ queryKey: keys.recentRequests });
  });

  if (summary.isError || recent.isError) {
    return (
      <Callout tone="error" title="We could not load your analytics">
        Refresh the page to try again.
      </Callout>
    );
  }

  const s = summary.data;
  const empty = s?.requests === 0;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1>Overview</h1>
        <p className={styles.live} data-status={status}>
          <span className={styles.liveDot} aria-hidden="true" />
          {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          <span className={styles.range}> · last 24 hours</span>
        </p>
      </div>

      {provider.data === null && (
        <Callout title="Finish setting up">
          Connect a provider and create a key to start routing traffic.{' '}
          <Link to="/onboarding">Continue setup</Link>
        </Callout>
      )}

      {!s ? (
        <div className={styles.stats}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height="5.5rem" />
          ))}
        </div>
      ) : (
        <dl className={styles.stats}>
          <Stat label="Requests" value={formatInteger(s.requests)} />
          <Stat
            label="Hit rate"
            value={s.hitRate === null ? 'None yet' : formatPercent(s.hitRate)}
            note={`${formatInteger(s.exactHits)} exact · ${formatInteger(s.twinHits)} twin`}
          />
          <Stat
            label="Estimated saved"
            value={formatUsd(s.cost.netUsd)}
            note={`Prices as of ${PRICING.asOf}${s.cost.unpricedModels.length ? ' · some models unpriced' : ''}`}
          />
          <Stat label="Tokens served from cache" value={formatInteger(s.tokensSaved)} />
        </dl>
      )}

      <section aria-labelledby="recent-heading" className={styles.panel}>
        <h2 id="recent-heading">Recent requests</h2>
        {empty ? (
          <div className={styles.empty}>
            <Mark size={36} animated />
            <p className={styles.emptyTitle}>No traffic yet</p>
            <p>
              When your app sends a request through Twynn, it appears here instantly, labelled{' '}
              {VOCABULARY.exactHit.label.toLowerCase()}, {VOCABULARY.twinHit.label.toLowerCase()} or
              miss.
            </p>
            <ButtonLink
              to="/onboarding"
              variant="secondary"
              icon={<ArrowRight size={16} aria-hidden="true" />}
            >
              Get a ready-to-run snippet
            </ButtonLink>
          </div>
        ) : recent.data ? (
          <ul className={styles.rows}>
            {recent.data.requests.map((r) => (
              <RecentRow key={r.id} request={r} />
            ))}
          </ul>
        ) : (
          <Skeleton height="12rem" />
        )}
      </section>
    </div>
  );
}
