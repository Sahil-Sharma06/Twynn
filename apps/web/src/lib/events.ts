import { useEffect, useRef, useState } from 'react';
import type { RequestEvent, RequestLogView } from '@twynn/shared';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * Subscribes to the workspace's live request stream (GET /api/events). The
 * browser reconnects automatically; `status` reflects the connection so the UI
 * can say when it is not live.
 */
export function useRequestEvents(
  onRequest: (request: RequestLogView) => void,
  { enabled = true }: { enabled?: boolean } = {},
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const handler = useRef(onRequest);
  handler.current = onRequest;

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/api/events');
    source.addEventListener('ready', () => setStatus('live'));
    source.addEventListener('request', (event) => {
      try {
        handler.current((JSON.parse((event as MessageEvent<string>).data) as RequestEvent).request);
      } catch {
        // A malformed event is skipped; the next one still arrives.
      }
    });
    source.onerror = () => setStatus('reconnecting');
    return () => source.close();
  }, [enabled]);

  return status;
}
