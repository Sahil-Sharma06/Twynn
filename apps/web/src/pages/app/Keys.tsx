import { useState } from 'react';
import { Link } from 'react-router';
import type { CreatedGatewayKey, GatewayKeyView } from '@twynn/shared';
import { Callout } from '../../components/Callout';
import { Skeleton } from '../../components/Spinner';
import { ConfirmButton, EmptyState, PageHeader, Panel } from '../../components/Ui';
import { formatDateTime, formatRelative } from '../../lib/format';
import { toQuery, useGatewayKeys, useRevokeKey } from '../../lib/queries';
import { KeyStep } from '../onboarding/KeyStep';
import styles from './Keys.module.css';

function KeyRow({ k }: { k: GatewayKeyView }) {
  const revoke = useRevokeKey();
  const revoked = k.revokedAt !== null;
  return (
    <tr data-revoked={revoked || undefined}>
      <th scope="row">{k.name}</th>
      <td>
        <code>{k.prefix}…</code>
      </td>
      <td>
        <time dateTime={k.createdAt} title={formatDateTime(k.createdAt)}>
          {formatRelative(k.createdAt)}
        </time>
      </td>
      <td>
        {k.lastUsedAt ? (
          <time dateTime={k.lastUsedAt} title={formatDateTime(k.lastUsedAt)}>
            {formatRelative(k.lastUsedAt)}
          </time>
        ) : (
          'Never'
        )}
      </td>
      <td>
        {revoked ? (
          <span className={styles.revoked}>Revoked {formatRelative(k.revokedAt ?? '')}</span>
        ) : (
          <span className={styles.active}>Active</span>
        )}
      </td>
      <td className={styles.actions}>
        <Link to={`/app/requests?${toQuery({ keyId: k.id })}`}>Requests</Link>
        {!revoked && (
          <ConfirmButton
            label="Revoke"
            confirmLabel="Revoke"
            prompt={`Revoke "${k.name}"? Apps using it stop working at once.`}
            loading={revoke.isPending}
            onConfirm={() => revoke.mutate(k.id)}
          />
        )}
        {revoke.isError && (
          <span role="alert" className={styles.error}>
            Could not revoke. Try again.
          </span>
        )}
      </td>
    </tr>
  );
}

/** Gateway keys: create (shown once), see usage, revoke. */
export function Keys() {
  const gatewayKeys = useGatewayKeys();
  const [created, setCreated] = useState<CreatedGatewayKey | null>(null);
  const list = gatewayKeys.data ?? [];
  // Active keys first, then newest.
  const sorted = [...list].sort(
    (a, b) =>
      Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
      b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title="API keys"
        description="Your apps authenticate to Twynn with these keys instead of your provider key. Twynn stores only a fingerprint of each, so a key is shown once, when it is created."
      />

      <Panel title="Create a key">
        <KeyStep
          created={created}
          existingCount={0}
          onCreated={setCreated}
          onContinue={() => setCreated(null)}
        />
      </Panel>

      <Panel title="Keys">
        {gatewayKeys.isError ? (
          <Callout tone="error">Your keys could not be loaded. Refresh to try again.</Callout>
        ) : !gatewayKeys.data ? (
          <Skeleton height="8rem" />
        ) : sorted.length === 0 ? (
          <EmptyState title="No keys yet">
            Create a key above, then use it as the API key in your OpenAI client.
          </EmptyState>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((k) => (
                  <KeyRow key={k.id} k={k} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
