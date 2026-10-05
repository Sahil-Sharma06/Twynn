import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { loginSchema } from '@twynn/shared';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { apiErrors, validate, type FieldErrors } from '../../lib/forms';
import { useLogin } from '../../lib/queries';
import { AuthCard } from './AuthCard';
import styles from './Auth.module.css';

/** Only same-site paths are honoured, so a crafted link cannot redirect elsewhere after login. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

export function Login() {
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [errors, setErrors] = useState<FieldErrors>({});

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validate(loginSchema, {
      email: form.get('email'),
      password: form.get('password'),
    });
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    login.mutate(result.data, {
      onSuccess: () => navigate(safeNext(params.get('next')), { replace: true }),
      onError: (error) => setErrors(apiErrors(error)),
    });
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to your Twynn workspace."
      footer={
        <>
          New to Twynn? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {errors.form && <Callout tone="error">{errors.form}</Callout>}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={errors.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password}
        />
        <Button type="submit" size="lg" loading={login.isPending}>
          Log in
        </Button>
      </form>
    </AuthCard>
  );
}
