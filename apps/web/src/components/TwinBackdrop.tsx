import styles from './TwinBackdrop.module.css';

/**
 * A quiet field of speech-bubble outlines drifting in pairs, used behind the sign-in card.
 * Decorative only; under reduced motion the pairs stay still.
 */
export function TwinBackdrop() {
  return (
    <div className={styles.backdrop} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.pair} data-pair={i}>
          <span className={`${styles.bubble} ${styles.a}`} />
          <span className={`${styles.bubble} ${styles.b}`} />
        </div>
      ))}
    </div>
  );
}
