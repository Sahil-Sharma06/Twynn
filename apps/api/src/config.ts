import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TWYNN_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TWYNN_DB_URL: z.string().url(),
  TWYNN_REDIS_URL: z.string().url(),
  TWYNN_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TWYNN_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** 32 random bytes, base64. Encrypts provider API keys at rest. */
  TWYNN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  /** Origin of the dashboard; the only origin allowed to make state-changing /api calls. */
  TWYNN_WEB_ORIGIN: z
    .string()
    .url()
    .transform((v) => new URL(v).origin)
    .default('http://localhost:5173'),
  TWYNN_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Time allowed for the upstream to start responding (headers, or the full body when not streaming). */
  TWYNN_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  TWYNN_UPSTREAM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /** Embeddings calls sit on the request path of every exact miss, so they get a tighter budget. */
  TWYNN_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
