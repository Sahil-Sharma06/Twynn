import { z } from 'zod';

/** Prefix of every gateway API key, so keys are recognisable in code and secret scanners. */
export const GATEWAY_KEY_PREFIX = 'twynn_sk_';

export const PASSWORD_MIN_LENGTH = 10;
// Bounded so hashing cost cannot be abused with megabyte-long passwords.
export const PASSWORD_MAX_LENGTH = 256;

const email = z.string().trim().toLowerCase().email().max(254);

export const credentialsSchema = z.object({
  email,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const signupSchema = credentialsSchema.extend({
  workspaceName: z.string().trim().min(1).max(80).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

/** Login does not enforce the signup length rule, so the error never hints at the policy. */
export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const providerInputSchema = z.object({
  baseUrl: z.string().trim().url().max(2048),
  /** Optional on update: omitting it keeps the stored key. */
  apiKey: z.string().trim().min(1).max(512).optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export interface SessionView {
  user: { id: string; email: string };
  workspace: { id: string; name: string };
}

export interface GatewayKeyView {
  id: string;
  name: string;
  /** Leading characters of the key, safe to display. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** Returned only once, at creation. */
export interface CreatedGatewayKey extends GatewayKeyView {
  key: string;
}

export interface ProviderView {
  baseUrl: string;
  /** Last characters of the provider key, for recognition only. */
  apiKeyHint: string;
  updatedAt: string;
}

export const CACHE_SETTINGS_LIMITS = {
  twinThreshold: { min: 0.5, max: 1 },
  ttlSeconds: { min: 60, max: 30 * 86_400 },
} as const;

/** Defaults for a workspace that has never changed its cache settings. */
export const DEFAULT_CACHE_SETTINGS = {
  semanticEnabled: true,
  twinThreshold: 0.95,
  ttlSeconds: 86_400,
  embeddingModel: 'text-embedding-3-small',
} as const;

export const cacheSettingsSchema = z.object({
  semanticEnabled: z.boolean(),
  twinThreshold: z
    .number()
    .min(CACHE_SETTINGS_LIMITS.twinThreshold.min)
    .max(CACHE_SETTINGS_LIMITS.twinThreshold.max),
  ttlSeconds: z
    .number()
    .int()
    .min(CACHE_SETTINGS_LIMITS.ttlSeconds.min)
    .max(CACHE_SETTINGS_LIMITS.ttlSeconds.max),
  embeddingModel: z.string().trim().min(1).max(200),
});
export type CacheSettings = z.infer<typeof cacheSettingsSchema>;

export const cacheSettingsUpdateSchema = cacheSettingsSchema.partial();
export type CacheSettingsUpdate = z.infer<typeof cacheSettingsUpdateSchema>;
