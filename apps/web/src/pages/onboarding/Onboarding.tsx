import { useState } from 'react';
import type { CreatedGatewayKey } from '@twynn/shared';
import { Callout } from '../../components/Callout';
import { Skeleton } from '../../components/Spinner';
import { useGatewayKeys, useProvider } from '../../lib/queries';
import { KeyStep } from './KeyStep';
import { ProviderStep } from './ProviderStep';
import { SnippetStep } from './SnippetStep';
import { Step, type StepState } from './Step';
import { WaitingStep } from './WaitingStep';
import styles from './Onboarding.module.css';

type StepId = 'provider' | 'key' | 'snippet' | 'waiting';
const ORDER: StepId[] = ['provider', 'key', 'snippet', 'waiting'];

export function Onboarding() {
  const provider = useProvider();
  const gatewayKeys = useGatewayKeys();
  const [createdKey, setCreatedKey] = useState<CreatedGatewayKey | null>(null);
  const [editingProvider, setEditingProvider] = useState(false);
  const [current, setCurrent] = useState<StepId | null>(null);

  if (provider.isPending || gatewayKeys.isPending) {
    return (
      <div className={styles.page}>
        <Skeleton height="2.5rem" width="60%" />
        <Skeleton height="16rem" />
      </div>
    );
  }
  if (provider.isError || gatewayKeys.isError) {
    return (
      <div className={styles.page}>
        <Callout tone="error" title="We could not load your setup">
          Refresh the page to try again.
        </Callout>
      </div>
    );
  }

  const activeKeys = gatewayKeys.data.filter((k) => !k.revokedAt).length;
  // Resume where the workspace actually is: provider first, then a key.
  const derived: StepId = !provider.data ? 'provider' : activeKeys === 0 ? 'key' : 'snippet';
  const step = editingProvider ? 'provider' : (current ?? derived);
  const stateOf = (id: StepId): StepState => {
    const diff = ORDER.indexOf(id) - ORDER.indexOf(step);
    return diff < 0 ? 'done' : diff === 0 ? 'current' : 'upcoming';
  };

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <h1>Set up your gateway</h1>
        <p>Four steps, about two minutes. Everything you see here comes from your own workspace.</p>
      </div>
      <ol className={styles.steps}>
        <Step
          number={1}
          title="Connect your provider"
          state={stateOf('provider')}
          summary={
            provider.data && (
              <>
                {provider.data.baseUrl} · key {provider.data.apiKeyHint}{' '}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setEditingProvider(true)}
                >
                  Change
                </button>
              </>
            )
          }
        >
          <ProviderStep
            existing={provider.data}
            onDone={() => {
              setEditingProvider(false);
              setCurrent(createdKey ? 'snippet' : 'key');
            }}
          />
        </Step>
        <Step
          number={2}
          title="Create a gateway key"
          state={stateOf('key')}
          summary={
            createdKey
              ? `${createdKey.name} (${createdKey.prefix}…)`
              : `${activeKeys} active key(s)`
          }
        >
          <KeyStep
            created={createdKey}
            existingCount={activeKeys}
            onCreated={(key) => {
              setCreatedKey(key);
              // Pin this step: the key list refreshes, but the one-time reveal must stay visible.
              setCurrent('key');
            }}
            onContinue={() => setCurrent('snippet')}
          />
        </Step>
        <Step number={3} title="Send a request" state={stateOf('snippet')} summary="Snippet copied">
          <SnippetStep apiKey={createdKey?.key ?? null} onContinue={() => setCurrent('waiting')} />
        </Step>
        <Step number={4} title="See it arrive" state={stateOf('waiting')}>
          <WaitingStep />
        </Step>
      </ol>
    </div>
  );
}
