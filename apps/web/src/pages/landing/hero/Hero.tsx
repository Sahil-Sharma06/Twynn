import { lazy, Suspense, useState } from 'react';
import { useReducedMotion } from '../../../lib/motion';
import { webglAvailable } from '../../../lib/webgl';
import { HeroStill } from './HeroStill';
import styles from './Hero.module.css';

const HeroScene = lazy(() => import('./HeroScene'));

/**
 * The hero visual. The 3D scene (Three.js, loaded on demand) plays only when motion is
 * allowed and WebGL works; otherwise the static frame stands in, and also while loading.
 */
export function HeroVisual() {
  const reduced = useReducedMotion();
  const [webgl] = useState(webglAvailable);
  return (
    <figure className={styles.visual}>
      {reduced || !webgl ? (
        <HeroStill />
      ) : (
        <Suspense fallback={<HeroStill />}>
          <HeroScene />
        </Suspense>
      )}
      <figcaption className="visually-hidden">
        Illustration: two differently worded questions about the capital of France are recognised as
        twins and answered by one cached answer.
      </figcaption>
    </figure>
  );
}
