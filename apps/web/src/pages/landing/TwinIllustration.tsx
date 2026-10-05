import { ArrowDown, CornerDownRight } from 'lucide-react';
import { VOCABULARY } from '@twynn/shared';
import styles from './TwinIllustration.module.css';

/**
 * An illustration of a twin hit, not live data: a second, differently worded
 * question is matched to the first one and answered from the cache.
 */
export function TwinIllustration() {
  return (
    <figure className={styles.figure} aria-labelledby="twin-illustration-caption">
      <div className={styles.stage} aria-hidden="true">
        <div className={`${styles.card} ${styles.first}`}>
          <span className={styles.who}>Earlier request</span>
          <p>How do I reset my password?</p>
          <span className={styles.meta}>
            <CornerDownRight size={14} /> Answered by your provider, then cached
          </span>
        </div>
        <ArrowDown className={styles.arrow} size={18} />
        <div className={`${styles.card} ${styles.second}`}>
          <span className={styles.who}>New request</span>
          <p>I forgot my password. How can I change it?</p>
          <span className={styles.match}>
            <span className={styles.dot} /> {VOCABULARY.twinHit.label}: same meaning, served from
            cache
          </span>
        </div>
      </div>
      <figcaption id="twin-illustration-caption" className={styles.caption}>
        Illustration: two differently worded questions with the same meaning are twins, so the
        second one is answered from the cache.
      </figcaption>
    </figure>
  );
}
