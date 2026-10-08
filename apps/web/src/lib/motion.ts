import { useEffect, useState } from 'react';

/**
 * The single source of motion timing for JavaScript-driven animation (Framer Motion, the Web
 * Animations API, Three.js). CSS uses the matching --duration-* and --ease-* tokens in
 * styles/tokens.css; keep the two in step.
 *
 * UI feedback is quick (120-200ms). Storytelling, such as the twin bubbles merging, takes
 * 400-900ms. Nothing loops except the hero scene, and only when motion is allowed.
 */
export const duration = {
  fast: 0.12,
  base: 0.2,
  slow: 0.42,
  story: 0.9,
} as const;

/** Cubic-bezier curves, as Framer Motion arrays. */
export const ease = {
  out: [0.2, 0.8, 0.2, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** Springs for things that settle into place (markers, meters, merging bubbles). */
export const spring = {
  snappy: { type: 'spring', stiffness: 420, damping: 34 },
  soft: { type: 'spring', stiffness: 160, damping: 22 },
} as const;

/** Fade-and-rise used for page and panel entrances. */
export const rise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: duration.slow, ease: ease.out },
} as const;

const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false;
}

/** Live value of prefers-reduced-motion; components swap animation for an instant state change. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(QUERY);
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
