import { Link } from 'react-router';
import type { RequestLogView } from '@twynn/shared';
import { formatMs, formatRelative, formatScore } from '../lib/format';
import { LayerBadge } from './LayerBadge';
import styles from './RequestList.module.css';

/** Compact list of requests; each row opens the request's detail page. */
export function RequestList({
  requests,
  fresh,
}: {
  requests: RequestLogView[];
  /** Ids that just arrived live, highlighted briefly. */
  fresh?: ReadonlySet<string>;
}) {
  return (
    <ul className={styles.list}>
      {requests.map((r) => (
        <li key={r.id} data-fresh={fresh?.has(r.id) || undefined} className={styles.item}>
          <Link to={`/app/requests/${r.id}`} className={styles.row}>
            <LayerBadge layer={r.layer} status={r.status} />
            <span className={styles.prompt}>{r.promptPreview ?? '(no text)'}</span>
            <span className={styles.meta}>
              {r.matchScore !== null ? `match ${formatScore(r.matchScore)}` : (r.model ?? '')}
            </span>
            <span className={styles.meta}>
              {r.statusCode === 200 ? formatMs(r.latencyMs) : `HTTP ${r.statusCode}`}
            </span>
            <time className={styles.meta} dateTime={r.createdAt}>
              {formatRelative(r.createdAt)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
