import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Onboarding.module.css';

export type StepState = 'done' | 'current' | 'upcoming';

/** One numbered step of the onboarding checklist. Upcoming steps show only their title. */
export function Step({
  number,
  title,
  state,
  summary,
  children,
}: {
  number: number;
  title: string;
  state: StepState;
  /** Shown in place of the body once the step is done. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      className={`${styles.step} ${styles[state]}`}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <span className={styles.marker} aria-hidden="true">
        {state === 'done' ? <Check size={16} strokeWidth={3} /> : number}
      </span>
      <div className={styles.stepBody}>
        <h2 className={styles.stepTitle}>
          {title}
          <span className="visually-hidden">
            {state === 'done' ? ' (done)' : state === 'current' ? ' (current step)' : ' (upcoming)'}
          </span>
        </h2>
        {state === 'current' && <div className={styles.stepContent}>{children}</div>}
        {state === 'done' && summary && <div className={styles.summary}>{summary}</div>}
      </div>
    </li>
  );
}
