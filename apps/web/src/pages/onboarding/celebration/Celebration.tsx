import { lazy, Suspense, useState } from 'react';
import { Mark } from '../../../components/Logo';
import { useReducedMotion } from '../../../lib/motion';
import { webglAvailable } from '../../../lib/webgl';
import styles from './Celebration.module.css';

const FirstRequestScene = lazy(() => import('./FirstRequestScene'));

/**
 * Marks the workspace's first request. The 3D merge plays once when motion is allowed and
 * WebGL works; otherwise (and while it loads) the merged mark is shown still.
 */
export function Celebration() {
  const reduced = useReducedMotion();
  const [webgl] = useState(webglAvailable);
  const still = (
    <div className={styles.still}>
      <Mark size={88} />
    </div>
  );
  return (
    <div className={styles.frame} aria-hidden="true">
      {reduced || !webgl ? still : <Suspense fallback={still}>{<FirstRequestScene />}</Suspense>}
    </div>
  );
}
