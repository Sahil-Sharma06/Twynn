import { useState, type FormEvent } from 'react';
import { createKeySchema, type CreatedGatewayKey } from '@twynn/shared';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { CodeBlock } from '../../components/CodeBlock';
import { Field } from '../../components/Field';
import { apiErrors, validate, type FieldErrors } from '../../lib/forms';
import { useCreateKey } from '../../lib/queries';
import styles from './Onboarding.module.css';

export function KeyStep({
  created,
  existingCount,
  onCreated,
  onContinue,
}: {
  created: CreatedGatewayKey | null;
  existingCount: number;
  onCreated: (key: CreatedGatewayKey) => void;
  onContinue: () => void;
}) {
  const create = useCreateKey();
  const [errors, setErrors] = useState<FieldErrors>({});

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(createKeySchema, {
      name: new FormData(event.currentTarget).get('name'),
    });
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    create.mutate(result.data.name, {
      onSuccess: onCreated,
      onError: (e) => setErrors(apiErrors(e)),
    });
  };

  if (created) {
    return (
      <div className={styles.form}>
        <Callout tone="warning" title="Copy this key now">
          This is the only time Twynn shows it. Only a fingerprint is stored, so it cannot be
          recovered later. If you lose it, create a new one.
        </Callout>
        <div className={styles.reveal}>
          <p className={styles.revealLabel}>Gateway key · {created.name}</p>
          <CodeBlock code={created.key} label="Copy gateway key" />
        </div>
        <div>
          <Button onClick={onContinue}>I have saved my key</Button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <p className={styles.help}>
        Your app authenticates to Twynn with a gateway key, in place of your provider key.
        {existingCount > 0 &&
          ` This workspace already has ${existingCount} active ${existingCount === 1 ? 'key' : 'keys'}; existing keys cannot be shown again, so create one to use below.`}
      </p>
      {errors.form && <Callout tone="error">{errors.form}</Callout>}
      <Field
        label="Key name"
        name="name"
        defaultValue="My first key"
        hint="For your own reference, for example the app or environment that will use it."
        error={errors.name}
      />
      <div className={styles.row}>
        <Button type="submit" loading={create.isPending}>
          Create key
        </Button>
        {existingCount > 0 && (
          <Button variant="ghost" onClick={onContinue}>
            Skip, I already have a key
          </Button>
        )}
      </div>
    </form>
  );
}
