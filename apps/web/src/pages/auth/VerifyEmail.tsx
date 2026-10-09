import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { ButtonLink } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Spinner } from '../../components/Spinner';
import { useSession, useVerifyEmail } from '../../lib/queries';
import { AuthCard } from './AuthCard';

/** Spends the emailed verification link (?token=...) as soon as the page opens. */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const verify = useVerifyEmail();
  const session = useSession();
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // links are single-use: never send twice
    verify.mutate(token);
  }, [token, verify]);

  const next = session.data ? (
    <ButtonLink to="/app" size="lg">
      Go to your dashboard
    </ButtonLink>
  ) : (
    <ButtonLink to="/login" size="lg">
      Log in
    </ButtonLink>
  );

  if (verify.isSuccess) {
    return (
      <AuthCard title="Email verified" subtitle="Thanks. Your address is confirmed." footer={null}>
        {next}
      </AuthCard>
    );
  }

  if (!token || verify.isError) {
    return (
      <AuthCard
        title="This link cannot be used"
        subtitle="It may have expired, been used already, or been replaced by a newer one."
        footer={null}
      >
        <Callout>
          {session.data
            ? 'Use the banner in your dashboard to send a fresh verification email.'
            : 'Log in, and the dashboard lets you send a fresh verification email.'}
        </Callout>
        {next}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Verifying your email" subtitle="One moment." footer={null}>
      <Spinner label="Verifying" />
    </AuthCard>
  );
}
