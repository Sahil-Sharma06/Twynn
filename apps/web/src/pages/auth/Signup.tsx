import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { PASSWORD_MIN_LENGTH, signupSchema } from '@twynn/shared';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { apiErrors, validate, type FieldErrors } from '../../lib/forms';
import { useSignup } from '../../lib/queries';
import { AuthCard } from './AuthCard';
import styles from './Auth.module.css';

export function Signup() {
  const signup = useSignup();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<FieldErrors>({});

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const workspaceName = String(form.get('workspaceName') ?? '').trim();
    const result = validate(signupSchema, {
      email: form.get('email'),
      password: form.get('password'),
      ...(workspaceName && { workspaceName }),
    });
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    signup.mutate(result.data, {
      onSuccess: () => navigate('/onboarding'),
      onError: (error) => setErrors(apiErrors(error)),
    });
  };

  return (
    <AuthCard
      title="Create your gateway"
      subtitle="Your account comes with a private workspace. Setup then takes you from provider to first request."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
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
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`}
          error={errors.password}
        />
        <Field
          label="Workspace name"
          name="workspaceName"
          autoComplete="organization"
          placeholder="My workspace"
          hint="Optional. You can use your team or project name."
          error={errors.workspaceName}
        />
        <Button type="submit" size="lg" loading={signup.isPending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
