import { LogOut } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { PRODUCT_NAME } from '@twynn/shared';
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useLogout, useResendVerification, useSession } from '../lib/queries';
import { useToast } from '../components/Toast';
import styles from './AppLayout.module.css';

const navLink = styles.navLink ?? '';

const NAV: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/requests', label: 'Requests' },
  { to: '/app/playground', label: 'Playground' },
  { to: '/app/cache', label: 'Cache' },
  { to: '/app/keys', label: 'Keys' },
  { to: '/app/settings', label: 'Settings' },
  { to: '/app/docs', label: 'Docs' },
  { to: '/onboarding', label: 'Setup' },
];

/** Shown until the email is verified; access is never blocked (soft verification). */
function VerifyBanner({ email }: { email: string }) {
  const resend = useResendVerification();
  const toast = useToast();
  return (
    <div className={styles.banner} role="region" aria-label="Email verification">
      <p>
        Verify <strong>{email}</strong> using the link we emailed you.
      </p>
      <Button
        variant="secondary"
        size="sm"
        loading={resend.isPending}
        onClick={() =>
          resend.mutate(undefined, {
            onSuccess: () => toast(`Verification email sent to ${email}`, 'success'),
            onError: (err) =>
              toast(err instanceof Error ? err.message : 'Could not send the email', 'danger'),
          })
        }
      >
        Send it again
      </Button>
    </div>
  );
}

export function AppLayout() {
  const { data: session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const { pathname } = useLocation();

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
      {session && !session.user.emailVerified && <VerifyBanner email={session.user.email} />}
      <main id="main" className={styles.main}>
        {/* Keyed by route so each page fades and rises in; instant under reduced motion. */}
        <div key={pathname} className={styles.transition}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
