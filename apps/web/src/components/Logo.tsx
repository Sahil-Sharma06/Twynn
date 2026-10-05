import { useId } from 'react';
import styles from './Logo.module.css';

/*
 * The Twynn mark: two prompt bubbles, one solid and one outlined, facing each
 * other. Where they overlap, the match lights up in the twin colour. Animated,
 * the bubbles slide together and the overlap appears: a request finding its twin.
 */
const BUBBLE_A =
  'M8 4h7a5 5 0 0 1 5 5v3a5 5 0 0 1-5 5H9l-4.5 3.5L5.5 17A5 5 0 0 1 3 12V9a5 5 0 0 1 5-5Z';
const BUBBLE_B =
  'M17 12h7a5 5 0 0 1 5 5v3a5 5 0 0 1-2.5 4.3L27.5 28 23 25h-6a5 5 0 0 1-5-5v-3a5 5 0 0 1 5-5Z';

export function Mark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  const clip = useId();
  return (
    <svg
      className={animated ? `${styles.mark} ${styles.animated}` : styles.mark}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <path d={BUBBLE_A} />
        </clipPath>
      </defs>
      <path className={styles.a} d={BUBBLE_A} />
      <path className={styles.b} d={BUBBLE_B} />
      <path className={styles.overlap} d={BUBBLE_B} clipPath={`url(#${clip})`} />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className={styles.logo}>
      <Mark size={size} />
      <span className={styles.wordmark}>twynn</span>
    </span>
  );
}
