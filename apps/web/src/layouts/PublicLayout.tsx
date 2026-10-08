import { Link, Outlet } from 'react-router';
import { PRODUCT_NAME } from '@twynn/shared';
import { ButtonLink } from '../components/Button';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../lib/queries';
import styles from './PublicLayout.module.css';

export function PublicLayout() {
  const { data: session } = useSession();
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to="/" className={styles.home} aria-label={`${PRODUCT_NAME} home`}>
          <Logo />
        </Link>
        <nav className={styles.nav} aria-label="Main">
          <a href="/#how-it-works" className={styles.link}>
            How it works
          </a>
          <ThemeToggle />
          {session ? (
            <ButtonLink to="/app" size="sm">
              Open dashboard
            </ButtonLink>
          ) : (
            <>
              <Link to="/login" className={styles.link}>
                Log in
              </Link>
              <ButtonLink to="/signup" size="sm">
                Get started
              </ButtonLink>
            </>
          )}
        </nav>
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <Logo size={20} />
        <p>An OpenAI-compatible gateway that answers repeated questions from a cache.</p>
      </footer>
    </div>
  );
}
