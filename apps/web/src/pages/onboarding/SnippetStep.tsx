import { useState } from 'react';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { CodeTabs } from '../../components/CodeBlock';
import { Field } from '../../components/Field';
import { Skeleton } from '../../components/Spinner';
import { buildSnippets, type SnippetLanguage } from '../../lib/snippets';
import { useConfig } from '../../lib/queries';
import styles from './Onboarding.module.css';

const LABELS: Record<SnippetLanguage, string> = { curl: 'curl', node: 'Node.js', python: 'Python' };
export const KEY_PLACEHOLDER = 'YOUR_TWYNN_KEY';

export function SnippetStep({
  apiKey,
  onContinue,
}: {
  apiKey: string | null;
  onContinue: () => void;
}) {
  const config = useConfig();
  const [model, setModel] = useState('gpt-4o-mini');

  return (
    <div className={styles.form}>
      <p className={styles.help}>
        Run this from a terminal or your app. It sends one real request through your gateway to your
        provider.
      </p>
      {!apiKey && (
        <Callout>
          Replace <code>{KEY_PLACEHOLDER}</code> with one of your gateway keys.
        </Callout>
      )}
      <Field
        label="Model"
        name="model"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        spellCheck={false}
        hint="Any chat model your provider offers."
      />
      {config.data ? (
        <CodeTabs
          tabs={buildSnippets({
            gatewayUrl: config.data.gatewayUrl,
            apiKey: apiKey ?? KEY_PLACEHOLDER,
            model: model.trim() || 'gpt-4o-mini',
          })}
          labels={LABELS}
          initial="curl"
        />
      ) : config.isError ? (
        <Callout tone="error">
          Could not load your gateway URL. Refresh the page to try again.
        </Callout>
      ) : (
        <Skeleton height="10rem" />
      )}
      <div>
        <Button onClick={onContinue}>I have sent it</Button>
      </div>
    </div>
  );
}
