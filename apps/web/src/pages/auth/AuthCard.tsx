import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PRODUCT_NAME } from '@twynn/shared';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { TwinBackdrop } from '../../components/TwinBackdrop';
import styles from './Auth.module.css';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <TwinBackdrop />
      <header className={styles.header}>
        <Link to="/" aria-label={`${PRODUCT_NAME} home`} className={styles.home}>
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className={styles.main}>
        <div className={styles.card}>
          <div className={styles.heading}>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
        </div>
        <p className={styles.footer}>{footer}</p>
      </main>
    </div>
  );
}
