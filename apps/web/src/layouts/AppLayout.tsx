import { LogOut } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { PRODUCT_NAME } from '@twynn/shared';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useLogout, useSession } from '../lib/queries';
import styles from './AppLayout.module.css';

const navLink = styles.navLink ?? '';

const NAV: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/requests', label: 'Requests' },
  { to: '/app/cache', label: 'Cache' },
  { to: '/app/keys', label: 'Keys' },
  { to: '/app/settings', label: 'Settings' },
  { to: '/onboarding', label: 'Setup' },
];

export function AppLayout() {
  const { data: session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.left}>
          <Link to="/app" aria-label={`${PRODUCT_NAME} dashboard`} className={styles.home}>
            <Logo size={24} />
          </Link>
          <nav aria-label="Dashboard" className={styles.nav}>
            {NAV.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end ?? false} className={navLink}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className={styles.right}>
          <span className={styles.workspace} title={session?.user.email}>
            {session?.workspace.name}
          </span>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut size={15} aria-hidden="true" />}
            loading={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate('/') })}
          >
            Log out
          </Button>
        </div>
      </header>
      <main id="main" className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
