import { CACHE_SETTINGS_LIMITS, VOCABULARY } from '@twynn/shared';
import { formatScore } from '../lib/format';
import styles from './ScoreMeter.module.css';

const MIN = CACHE_SETTINGS_LIMITS.twinThreshold.min;
const position = (score: number) =>
  `${(Math.min(1, Math.max(0, (score - MIN) / (1 - MIN))) * 100).toFixed(2)}%`;

/**
 * A match score against the twin threshold, on the threshold's own scale. Scores below
 * the scale's floor sit at its left edge.
 */
export function ScoreMeter({ score, threshold }: { score: number; threshold: number }) {
  const served = score >= threshold;
  return (
    <div className={styles.meter} data-served={served || undefined}>
      <div className={styles.track}>
        <span className={styles.fill} style={{ width: position(score) }} />
        <span
          className={styles.threshold}
          style={{ left: position(threshold) }}
          title={`${VOCABULARY.twinThreshold.label} ${formatScore(threshold)}`}
        />
      </div>
      <p className={styles.caption}>
        {VOCABULARY.matchScore.label} <strong>{formatScore(score)}</strong>{' '}
        {served ? 'meets' : 'is below'} the {VOCABULARY.twinThreshold.label.toLowerCase()} of{' '}
        {formatScore(threshold)}
      </p>
    </div>
  );
}
