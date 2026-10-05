import { AlertTriangle, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Callout.module.css';

const icons = { info: Info, warning: AlertTriangle, error: XCircle };

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof icons;
  title?: string;
  children: ReactNode;
}) {
  const Icon = icons[tone];
  return (
    <div
      className={`${styles.callout} ${styles[tone]}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <Icon size={18} aria-hidden="true" className={styles.icon} />
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
