import { LogOut } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { PRODUCT_NAME } from '@twynn/shared';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useLogout, useSession } from '../lib/queries';
import styles from './AppLayout.module.css';

const navLink = styles.navLink ?? '';

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
            <NavLink to="/app" end className={navLink}>
              Overview
            </NavLink>
            <NavLink to="/onboarding" className={navLink}>
              Setup
            </NavLink>
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
