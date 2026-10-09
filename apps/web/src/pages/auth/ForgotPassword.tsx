import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { passwordResetRequestSchema } from '@twynn/shared';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { apiErrors, validate, type FieldErrors } from '../../lib/forms';
import { useRequestPasswordReset } from '../../lib/queries';
import { AuthCard } from './AuthCard';
import styles from './Auth.module.css';

/** Asks for a reset link. The answer is the same whether or not the email has an account. */
export function ForgotPassword() {
  const request = useRequestPasswordReset();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(passwordResetRequestSchema, {
      email: new FormData(event.currentTarget).get('email'),
    });
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    request.mutate(result.data.email, {
      onSuccess: () => setSentTo(result.data.email),
      onError: (error) => setErrors(apiErrors(error)),
    });
  };

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter the email you signed up with and Twynn will send a link to choose a new password."
      footer={
        <>
          Remembered it? <Link to="/login">Log in</Link>
        </>
      }
    >
      {sentTo ? (
        <div className={styles.form} role="status">
          <Callout title="Check your inbox">
            If {sentTo} has a Twynn account, a reset link is on its way. It works once and expires
            in 1 hour. Nothing arrived? Check spam, or ask again in a few minutes.
          </Callout>
        </div>
      ) : (
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
          <Button type="submit" size="lg" loading={request.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
