import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Callout } from '../components/Callout';
import { Spinner } from '../components/Spinner';
import { useSession } from '../lib/queries';
import styles from './RequireAuth.module.css';

/** Renders children for signed-in users; sends everyone else to log in and back. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending, isError, refetch } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className={styles.center}>
        <Spinner size={24} label="Loading your workspace" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className={styles.center}>
        <Callout tone="error" title="We could not load your session">
          <button type="button" className={styles.retry} onClick={() => refetch()}>
            Try again
          </button>
        </Callout>
      </div>
    );
  }
  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}
