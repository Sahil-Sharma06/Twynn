import { useState, type FormEvent } from 'react';
import { providerInputSchema, type ProviderView } from '@twynn/shared';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { apiErrors, validate, type FieldErrors } from '../../lib/forms';
import { useSaveProvider } from '../../lib/queries';
import styles from './Onboarding.module.css';

/** Common OpenAI-compatible endpoints, offered as shortcuts for the base URL. */
export const PROVIDER_PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
] as const;

export function ProviderStep({
  existing,
  onDone,
}: {
  existing: ProviderView | null;
  onDone: () => void;
}) {
  const save = useSaveProvider();
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? PROVIDER_PRESETS[0].baseUrl);
  const [errors, setErrors] = useState<FieldErrors>({});

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const apiKey = String(new FormData(event.currentTarget).get('apiKey') ?? '').trim();
    const result = validate(providerInputSchema, { baseUrl, ...(apiKey && { apiKey }) });
    if (result.errors) return setErrors(result.errors);
    if (!existing && !apiKey) return setErrors({ apiKey: 'Paste the API key from your provider.' });
    setErrors({});
    save.mutate(result.data, { onSuccess: onDone, onError: (e) => setErrors(apiErrors(e)) });
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <p className={styles.help}>
        Twynn forwards anything it cannot answer from cache to this provider, using this key. Any
        OpenAI-compatible endpoint works.
      </p>
      {errors.form && <Callout tone="error">{errors.form}</Callout>}
      <div className={styles.presets} role="group" aria-label="Provider shortcuts">
        {PROVIDER_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={styles.preset}
            aria-pressed={baseUrl === preset.baseUrl}
            onClick={() => setBaseUrl(preset.baseUrl)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <Field
        label="Base URL"
        name="baseUrl"
        type="url"
        inputMode="url"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        hint="The URL your OpenAI client would normally use, ending in /v1 for most providers."
        error={errors.baseUrl}
      />
      <Field
        label="Provider API key"
        name="apiKey"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={existing ? `Saved key ${existing.apiKeyHint}; leave blank to keep it` : 'sk-…'}
        hint="Encrypted before it is stored, and never shown again."
        error={errors.apiKey}
      />
      <div>
        <Button type="submit" loading={save.isPending}>
          {existing ? 'Save provider' : 'Connect provider'}
        </Button>
      </div>
    </form>
  );
}
