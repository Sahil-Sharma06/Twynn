import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Eases from the previous value to the new one, so live counters visibly move as traffic
 * arrives. Jumps straight to the value under prefers-reduced-motion.
 */
export function useTweened(value: number, durationMs = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - began) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const current = start + (value - start) * eased;
      from.current = current;
      setShown(current);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return shown;
}

/** A number that animates between values. Screen readers get the final value only. */
export function AnimatedNumber({
  value,
  format,
}: {
  value: number;
  format: (value: number) => string;
}) {
  const shown = useTweened(value);
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="visually-hidden">{format(value)}</span>
    </>
  );
}
