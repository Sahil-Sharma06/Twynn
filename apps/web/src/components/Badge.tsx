import type { ReactNode } from 'react';
import styles from './Badge.module.css';

export type BadgeTone = 'exact' | 'twin' | 'miss' | 'bypass' | 'danger' | 'neutral';

/**
 * A small label whose colour carries meaning: indigo for exact hits, teal for twin hits,
 * grey for misses. Bypass and neutral stay grey; danger is only for real failures.
 */
export function Badge({
  tone,
  children,
  title,
}: {
  tone: BadgeTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={title}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}
