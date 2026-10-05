import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RequestLogView } from '@twynn/shared';
import { ButtonLink } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { LayerBadge } from '../../components/LayerBadge';
import { Mark } from '../../components/Logo';
import { useRequestEvents } from '../../lib/events';
import { formatMs } from '../../lib/format';
import { keys, useRecentRequests } from '../../lib/queries';
import styles from './Onboarding.module.css';

function RequestRow({ request }: { request: RequestLogView }) {
  return (
    <li className={styles.requestRow}>
      <LayerBadge layer={request.layer} status={request.status} />
      <span className={styles.requestModel}>{request.model ?? 'unknown model'}</span>
      <span className={styles.requestMeta}>
        {request.statusCode === 200 ? formatMs(request.latencyMs) : `HTTP ${request.statusCode}`}
      </span>
    </li>
  );
}

/** Waits for the workspace's first real request, then shows it as it arrives. */
export function WaitingStep() {
  const client = useQueryClient();
  const recent = useRecentRequests(5);
  const [live, setLive] = useState<RequestLogView[]>([]);
  const status = useRequestEvents((request) => {
    setLive((current) => [request, ...current].slice(0, 5));
    void client.invalidateQueries({ queryKey: keys.summary });
  });

  // Requests that arrived before this page opened count too.
  const seen = live.length > 0 ? live : (recent.data?.requests ?? []);
  const first = seen.at(-1);
  const sawHit = seen.some((r) => r.status === 'HIT');
  const sawError = first && first.statusCode !== 200;

  if (!first) {
    return (
      <div className={styles.waiting} role="status" aria-live="polite">
        <Mark size={40} animated />
        <div>
          <p className={styles.waitingTitle}>Waiting for your first request…</p>
          <p className={styles.help}>
            {status === 'reconnecting'
              ? 'Reconnecting to the live stream. Requests you send meanwhile will still appear.'
              : 'This updates on its own the moment Twynn sees your request.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.form} aria-live="polite">
      {sawError ? (
        <Callout tone="warning" title="Twynn received your request, but it was not answered">
          Your provider or the request itself returned an error (HTTP {first.statusCode}). Check the
          provider base URL, key and model name, then send it again.
        </Callout>
      ) : (
        <Callout title="Your gateway is live">
          {sawHit
            ? 'That repeat was answered from the cache, without calling your provider.'
            : 'Run the same snippet again: the repeat is answered from the cache.'}
        </Callout>
      )}
      <ul className={styles.requests}>
        {seen.map((request) => (
          <RequestRow key={request.id} request={request} />
        ))}
      </ul>
      <div>
        <ButtonLink to="/app">Go to your dashboard</ButtonLink>
      </div>
    </div>
  );
}
