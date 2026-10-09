import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PASSWORD_MIN_LENGTH, passwordResetConfirmSchema } from '@twynn/shared';
import { Button, ButtonLink } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { apiErrors, validate, type FieldErrors } from '../../lib/forms';
import { useConfirmPasswordReset } from '../../lib/queries';
import { AuthCard } from './AuthCard';
import styles from './Auth.module.css';

/** Sets a new password from an emailed link (?token=...). */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const confirm = useConfirmPasswordReset();
  const [errors, setErrors] = useState<FieldErrors>({});

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(passwordResetConfirmSchema, {
      token,
      password: new FormData(event.currentTarget).get('password'),
    });
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    confirm.mutate(result.data, { onError: (error) => setErrors(apiErrors(error)) });
  };

  const footer = (
    <>
      Need a new link? <Link to="/forgot-password">Ask again</Link>
    </>
  );

  if (confirm.isSuccess) {
    return (
      <AuthCard
        title="Password changed"
        subtitle="Every device was signed out. Log in with your new password."
        footer={footer}
      >
        <ButtonLink to="/login" size="lg">
          Log in
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="This signs you out on every device."
      footer={footer}
    >
      {!token || errors.token ? (
        <Callout tone="warning" title="This link cannot be used">
          {errors.token ??
            'The link is missing its code. Open it straight from the email, or ask for a new one.'}
        </Callout>
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {errors.form && <Callout tone="error">{errors.form}</Callout>}
          <Field
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            error={errors.password}
          />
          <Button type="submit" size="lg" loading={confirm.isPending}>
            Set new password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
