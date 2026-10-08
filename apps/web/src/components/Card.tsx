import type { HTMLAttributes } from 'react';
import styles from './Card.module.css';

/** A plain surface: hairline border, soft shadow. `raised` lifts it one step. */
export function Card({
  raised = false,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { raised?: boolean }) {
  return (
    <div
      className={[styles.card, raised && styles.raised, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
