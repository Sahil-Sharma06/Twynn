import styles from './Spinner.module.css';

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
    >
      {label && <span className="visually-hidden">{label}</span>}
    </span>
  );
}

/** Placeholder block shown while content loads. */
export function Skeleton({ width = '100%', height = '1rem' }: { width?: string; height?: string }) {
  return <span className={styles.skeleton} style={{ width, height }} aria-hidden="true" />;
}
