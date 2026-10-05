import { VOCABULARY, type CacheLayer, type CacheStatus } from '@twynn/shared';
import styles from './LayerBadge.module.css';

/** Labels a request by the layer that answered it, using the shared vocabulary. */
export function LayerBadge({
  layer,
  status,
}: {
  layer: CacheLayer | null;
  status: CacheStatus | null;
}) {
  if (status === 'HIT' && layer === 'exact') {
    return (
      <span className={`${styles.badge} ${styles.exact}`} title={VOCABULARY.exactHit.technical}>
        {VOCABULARY.exactHit.label}
      </span>
    );
  }
  if (status === 'HIT' && layer === 'twin') {
    return (
      <span className={`${styles.badge} ${styles.twin}`} title={VOCABULARY.twinHit.technical}>
        {VOCABULARY.twinHit.label}
      </span>
    );
  }
  if (status === 'BYPASS')
    return <span className={`${styles.badge} ${styles.upstream}`}>Bypass</span>;
  if (status === 'MISS') return <span className={`${styles.badge} ${styles.upstream}`}>Miss</span>;
  return <span className={`${styles.badge} ${styles.error}`}>Not served</span>;
}
