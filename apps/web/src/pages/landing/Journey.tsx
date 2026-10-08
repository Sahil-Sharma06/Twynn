import { useInView } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CACHE_SETTINGS, VOCABULARY } from '@twynn/shared';
import { useReducedMotion } from '../../lib/motion';
import styles from './Journey.module.css';

const T = DEFAULT_CACHE_SETTINGS.twinThreshold.toFixed(2);

type LaneKey = 'exact' | 'twin' | 'provider';
interface Scenario {
  key: LaneKey;
  label: string;
  prompt: string;
  /** What each lane reports, in order, until the request is answered. */
  checks: Partial<Record<LaneKey, string>>;
}

/** Example requests, one ending in each lane. Scores are illustrative. */
export const SCENARIOS: Scenario[] = [
  {
    key: 'exact',
    label: 'A repeat',
    prompt: "What's the capital of France?",
    checks: { exact: 'Identical request answered before. Served from memory.' },
  },
  {
    key: 'twin',
    label: 'A rewording',
    prompt: "Which city is France's capital?",
    checks: {
      exact: 'No identical request.',
      twin: `Closest stored prompt scores 0.97, at or above the ${T} threshold. Its answer is reused.`,
    },
  },
  {
    key: 'provider',
    label: 'A new question',
    prompt: 'How tall is Mont Blanc?',
    checks: {
      exact: 'No identical request.',
      twin: `Closest stored prompt scores 0.41, below ${T}.`,
      provider: 'Sent to your provider. The answer is stored for the next repeat or twin.',
    },
  },
];

const LANES: Array<{ key: LaneKey; title: string; detail: string }> = [
  { key: 'exact', title: VOCABULARY.exactHit.label, detail: 'Layer 1 · Redis' },
  { key: 'twin', title: VOCABULARY.twinHit.label, detail: 'Layer 2 · meaning search' },
  { key: 'provider', title: 'Miss', detail: 'Your provider' },
];

const STEP_MS = 900;
const HOLD_MS = 2600;

/**
 * A request travelling through the lanes: it stops at the first lane that can answer it,
 * which lights up in that lane's colour. Plays when scrolled into view; each example can
 * also be picked directly.
 */
export function Journey() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(1);
  const [step, setStep] = useState(reduced ? 99 : -1);
  const [auto, setAuto] = useState(true);
  const scenario = SCENARIOS[index % SCENARIOS.length] as Scenario;
  const stop = LANES.findIndex((l) => l.key === scenario.key);

  // Walk the token down one lane at a time, then move on to the next example.
  useEffect(() => {
    if (reduced) {
      setStep(99);
      return;
    }
    if (!inView) return;
    if (step < stop) {
      const timer = setTimeout(() => setStep((s) => s + 1), step < 0 ? 400 : STEP_MS);
      return () => clearTimeout(timer);
    }
    if (!auto) return;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % SCENARIOS.length);
      setStep(-1);
    }, HOLD_MS);
    return () => clearTimeout(timer);
  }, [inView, step, stop, auto, reduced]);

  const choose = (i: number) => {
    setAuto(false);
    setIndex(i);
    setStep(reduced ? 99 : -1);
  };
  const reached = Math.min(step, stop);

  return (
    <div ref={ref} className={styles.journey}>
      <div className={styles.picker} role="group" aria-label="Example request">
        {SCENARIOS.map((s, i) => (
          <button key={s.key} type="button" aria-pressed={i === index} onClick={() => choose(i)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className={styles.request}>
        <span className={styles.requestLabel}>Request</span>
        <code>{scenario.prompt}</code>
      </div>
      <ol className={styles.lanes} style={{ ['--stop' as string]: Math.max(0, reached) }}>
        <span
          className={styles.token}
          data-moving={step >= 0 || undefined}
          data-tone={step >= stop ? scenario.key : undefined}
          aria-hidden="true"
        />
        {LANES.map((lane, i) => {
          const check = i <= reached ? scenario.checks[lane.key] : undefined;
          const answered = i === stop && step >= stop;
          return (
            <li
              key={lane.key}
              className={styles.lane}
              data-lane={lane.key}
              data-state={answered ? 'answered' : i <= reached ? 'passed' : 'idle'}
            >
              <div className={styles.laneHead}>
                <span className={styles.laneTitle}>{lane.title}</span>
                <span className={styles.laneDetail}>{lane.detail}</span>
              </div>
              <p className={styles.check}>{check ?? ' '}</p>
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {step >= stop
          ? `${scenario.prompt}: answered by ${LANES[stop]?.title}. ${Object.values(scenario.checks).join(' ')}`
          : ''}
      </p>
    </div>
  );
}
