import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { CACHE_LAYER, CACHE_STATUS } from '@twynn/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always stored lowercased and trimmed. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

/** The tenant. Every cache entry, key and provider belongs to exactly one workspace. */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index().on(t.userId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the cookie token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId)],
);

export const gatewayKeys = pgTable(
  'gateway_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    /** SHA-256 of the full key. */
    keyHash: text('key_hash').notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index().on(t.workspaceId)],
);

export const providers = pgTable('providers', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  baseUrl: text('base_url').notNull(),
  /** AES-256-GCM ciphertext bound to the workspace id; see lib/crypto. */
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  apiKeyHint: text('api_key_hint').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Per-workspace cache settings. A missing row means DEFAULT_CACHE_SETTINGS apply. */
export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  semanticEnabled: boolean('semantic_enabled').notNull(),
  twinThreshold: doublePrecision('twin_threshold').notNull(),
  ttlSeconds: integer('ttl_seconds').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * pgvector column without a fixed dimension, so any embeddings model works.
 * Searches cast to the row's dimension to use the partial HNSW indexes.
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: (value) => `[${value.join(',')}]`,
  fromDriver: (value) => JSON.parse(value) as number[],
});

/** Layer 2: prompts with their embeddings and the response served to twin requests. */
export const semanticEntries = pgTable(
  'semantic_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Hash of everything that must match exactly for a twin hit; see semantic/request. */
    scopeHash: text('scope_hash').notNull(),
    model: text('model').notNull(),
    prompt: text('prompt').notNull(),
    embedding: vector('embedding').notNull(),
    dimensions: integer('dimensions').notNull(),
    response: text('response').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index().on(t.workspaceId, t.scopeHash, t.dimensions), index().on(t.expiresAt)],
);

/** One row per authenticated gateway request. The source of every number the dashboard shows. */
export const requestLogs = pgTable(
  'request_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    keyId: uuid('key_id').references(() => gatewayKeys.id, { onDelete: 'set null' }),
    // Millisecond precision so keyset cursors round-trip exactly through JavaScript Dates.
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).defaultNow().notNull(),
    model: text('model'),
    /** Null when the request never reached the cache, e.g. it failed validation. */
    layer: text('layer', { enum: CACHE_LAYER }),
    status: text('status', { enum: CACHE_STATUS }),
    statusCode: integer('status_code').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    /** Token counts as reported by the provider (for hits: when the answer was first produced). */
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    embeddingModel: text('embedding_model'),
    embeddingTokens: integer('embedding_tokens'),
    matchScore: doublePrecision('match_score'),
    /** Final user message, truncated. */
    promptPreview: text('prompt_preview'),
    /** For twin hits: the stored prompt that matched, truncated. */
    matchedPrompt: text('matched_prompt'),
  },
  (t) => [index().on(t.workspaceId, t.createdAt.desc(), t.id.desc()), index().on(t.createdAt)],
);
