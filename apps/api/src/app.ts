import { Hono } from 'hono';
import { PRODUCT_NAME } from '@twynn/shared';

export type HealthCheck = () => Promise<void>;

export interface AppDeps {
  checks: Record<string, HealthCheck>;
  healthTimeoutMs?: number;
}

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createApp({ checks, healthTimeoutMs = 2_000 }: AppDeps): Hono {
  const app = new Hono();

  app.get('/health', async (c) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), healthTimeoutMs);
          return [name, 'ok'] as const;
        } catch {
          return [name, 'down'] as const;
        }
      }),
    );
    const healthy = entries.every(([, status]) => status === 'ok');
    return c.json(
      {
        status: healthy ? 'ok' : 'degraded',
        product: PRODUCT_NAME,
        checks: Object.fromEntries(entries),
      },
      healthy ? 200 : 503,
    );
  });

  return app;
}
