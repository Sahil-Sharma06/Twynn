import styles from './Hero.module.css';

/**
 * The hero's resting frame: two differently worded questions overlapping, and the single
 * cached answer they share. Shown with reduced motion, without WebGL, and while the 3D
 * scene loads.
 */
export function HeroStill() {
  return (
    <div className={styles.still} aria-hidden="true">
      <div className={styles.pair}>
        <div className={`${styles.bubble} ${styles.bubbleA}`}>
          What&apos;s the capital of France?
        </div>
        <div className={`${styles.bubble} ${styles.bubbleB}`}>
          Which city is France&apos;s capital?
        </div>
        <span className={styles.overlapGlow} />
      </div>
      <div className={styles.answer}>
        <span className={styles.answerLabel}>Cached answer</span>
        <span>Paris is the capital of France.</span>
      </div>
    </div>
  );
}
