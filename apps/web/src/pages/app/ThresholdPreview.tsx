import {
  CACHE_SETTINGS_LIMITS,
  twinHitsAt,
  VOCABULARY,
  type ThresholdPreview as Preview,
} from '@twynn/shared';
import { AnimatedNumber } from '../../components/AnimatedNumber';
import { Callout } from '../../components/Callout';
import { Skeleton } from '../../components/Spinner';
import { formatInteger, formatPercent, formatScore } from '../../lib/format';
import { useThresholdPreview } from '../../lib/queries';
import styles from './Settings.module.css';

const MIN = CACHE_SETTINGS_LIMITS.twinThreshold.min;
const BINS = 50; // 0.01 wide, from MIN to 1

/** Plain-language reading of a threshold value. */
export function describeThreshold(t: number): {
  tone: 'info' | 'warning';
  band: string;
  text: string;
} {
  if (t >= 0.98)
    return {
      tone: 'info',
      band: 'Very strict',
      text: 'Only near-identical rewordings count as twins, so few requests are answered this way, but wrong answers are very unlikely.',
    };
  if (t >= 0.93)
    return {
      tone: 'info',
      band: 'Balanced',
      text: 'Rephrasings of the same question count as twins; questions that differ in a detail that matters usually do not.',
    };
  if (t >= 0.85)
    return {
      tone: 'warning',
      band: 'Loose',
      text: 'More requests are answered from the cache, but related questions with different answers may be treated as twins. Check the examples below.',
    };
  return {
    tone: 'warning',
    band: 'Very loose',
    text: 'Questions that only share a topic may be treated as twins and given the wrong stored answer.',
  };
}

/** Score histogram on the threshold scale, split at the proposed threshold. */
function Histogram({ buckets, threshold }: { buckets: Preview['buckets']; threshold: number }) {
  const bins = Array.from({ length: BINS }, () => 0);
  let below = 0;
  for (const b of buckets) {
    if (b.score < MIN) below += b.count;
    else {
      const i = Math.min(BINS - 1, Math.floor(((b.score - MIN) / (1 - MIN)) * BINS));
      bins[i] = (bins[i] ?? 0) + b.count;
    }
  }
  const max = Math.max(1, ...bins);
  const cut = ((threshold - MIN) / (1 - MIN)) * BINS;
  return (
    <figure className={styles.histogram}>
      <div className={styles.bins} aria-hidden="true">
        {bins.map((count, i) => (
          <span
            key={i}
            data-served={i >= Math.floor(cut) || undefined}
            style={{ height: `${count ? Math.max(4, (count / max) * 100) : 0}%` }}
          />
        ))}
        <span className={styles.cut} style={{ left: `${(cut / BINS) * 100}%` }} />
      </div>
      <div className={styles.binAxis} aria-hidden="true">
        <span>{MIN.toFixed(2)}</span>
        <span>1.00</span>
      </div>
      <figcaption>
        Closest-match scores of recent twin searches
        {below > 0 && ` (${formatInteger(below)} scored below ${MIN.toFixed(2)})`}
      </figcaption>
    </figure>
  );
}

/** What a different threshold would have done to the workspace's own recent traffic. */
export function ThresholdImpact({ current, proposed }: { current: number; proposed: number }) {
  const preview = useThresholdPreview(7);
  if (preview.isError) {
    return <Callout tone="error">The preview could not be loaded.</Callout>;
  }
  const p = preview.data;
  if (!p) return <Skeleton height="10rem" />;
  if (p.searches === 0) {
    return (
      <p className={styles.previewEmpty}>
        No twin searches in the last {p.days} days yet, so there is nothing to preview. Once
        requests miss the exact cache and are checked for twins, this shows how a different
        threshold would have changed the outcome.
      </p>
    );
  }

  const now = twinHitsAt(p.buckets, current);
  const then = twinHitsAt(p.buckets, proposed);
  const delta = then - now;
  const lower = Math.min(current, proposed);
  const upper = Math.max(current, proposed);
  const flips = p.examples.filter((e) => e.score >= lower && e.score < upper).slice(0, 4);

  return (
    <div className={styles.impact}>
      <p className={styles.impactLine} aria-live="polite">
        In the last {p.days} days,{' '}
        <strong>
          <AnimatedNumber value={then} format={(n) => formatInteger(Math.round(n))} />
        </strong>{' '}
        of {formatInteger(p.searches)} twin searches ({formatPercent(then / p.searches)}) would have
        been answered from the cache at {formatScore(proposed)}
        {delta === 0
          ? ', the same as now.'
          : `: ${formatInteger(Math.abs(delta))} ${delta > 0 ? 'more' : 'fewer'} than at your current ${formatScore(current)}.`}
      </p>
      <Histogram buckets={p.buckets} threshold={proposed} />
      {flips.length > 0 && (
        <div className={styles.flips}>
          <p className={styles.flipsTitle}>
            {proposed < current
              ? 'These would newly count as twins. Do they really ask the same thing?'
              : 'These would no longer count as twins:'}
          </p>
          <ul>
            {flips.map((e) => (
              <li key={e.requestId}>
                <span className={styles.flipScore}>{formatScore(e.score)}</span>
                <span>
                  <q>{e.prompt ?? '(no text)'}</q>
                  <span className={styles.flipVs}> vs </span>
                  <q>{e.matchedPrompt ?? '(not recorded)'}</q>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className={styles.caveat}>
        An estimate from logged {VOCABULARY.matchScore.label.toLowerCase()}s: each search is scored
        against what was cached at the time, and answers stored by newly served twins are not
        simulated.
      </p>
    </div>
  );
}
