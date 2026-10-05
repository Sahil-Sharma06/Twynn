import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TWYNN_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TWYNN_DB_URL: z.string().url(),
  TWYNN_REDIS_URL: z.string().url(),
  TWYNN_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TWYNN_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  TWYNN_UPSTREAM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  /** Time allowed for the upstream to start responding (headers, or the full body when not streaming). */
  TWYNN_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  TWYNN_UPSTREAM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  TWYNN_EXACT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
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
