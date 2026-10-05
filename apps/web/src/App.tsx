import { useEffect, useState } from 'react';
import { PRODUCT_NAME } from '@twynn/shared';

type ApiState = 'checking' | 'ok' | 'degraded' | 'unreachable';

// Placeholder shell until the Phase 6 design system lands; shows only real API status.
export function App() {
  const [api, setApi] = useState<ApiState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/health', { signal: controller.signal })
      .then((res) => res.json() as Promise<{ status: 'ok' | 'degraded' }>)
      .then((body) => setApi(body.status))
      .catch(() => {
        if (!controller.signal.aborted) setApi('unreachable');
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <p>
        API status: <strong>{api}</strong>
      </p>
    </main>
  );
}
