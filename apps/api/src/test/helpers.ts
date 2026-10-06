import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { pino } from 'pino';
import { createApp, type AppDeps } from '../app';
import { sessionCookie } from '../auth/middleware';
import { EntryStore } from '../cache/entries';
import type { ExactCache } from '../cache/exact';
import { CacheManager } from '../cache/manager';
import type { Database } from '../db/client';
import { MemoryEventBus, type EventBus } from '../lib/events';
import { MemoryCounter, RateLimiter, type Guard, type Limit } from '../lib/rate-limit';
import { RequestRecorder } from '../metering/recorder';
import * as schema from '../db/schema';
import { Embedder } from '../semantic/embeddings';
import { ProviderStore } from '../services/providers';
import { createTenantResolver, createWorkspaceLoader } from '../services/tenancy';
import { UpstreamClient } from '../upstream/client';

export const silentLogger = pino({ level: 'silent' });
export const WEB_ORIGIN = 'http://dashboard.test';
export const UPSTREAM_URL = 'https://upstream.test/v1';

/** In-process Postgres (with pgvector) migrated with the real migrations. */
export async function createTestDb(): Promise<Database> {
  const db = drizzle({ client: new PGlite({ extensions: { vector } }), schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  return db;
}

export class MemoryCache implements ExactCache {
  readonly store = new Map<string, { value: string; ttlSeconds: number }>();
  async get(key: string) {
    return this.store.get(key)?.value ?? null;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.store.set(key, { value, ttlSeconds });
  }
  async del(keys: string[]) {
    for (const key of keys) this.store.delete(key);
  }
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** Token count the fake provider reports for every embeddings call. */
export const EMBED_TOKENS = 8;

/** Embeddings stand-in: maps an input text to its vector, or null for "unknown". */
export type EmbedFn = (text: string) => number[] | null;

/**
 * A fetch stand-in that records calls. Chat calls are answered from a queue of
 * responders and recorded in `calls`; /embeddings calls go to `embed` (404 by
 * default, which skips the twin layer) and are recorded in `embedCalls`.
 */
export function fakeFetch(
  ...responders: Array<(call: RecordedCall) => Response | Promise<Response>>
) {
  const calls: RecordedCall[] = [];
  const embedCalls: RecordedCall[] = [];
  const state: { embed: EmbedFn | null } = { embed: null };
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init, body: JSON.parse(String(init.body)) };
    if (call.url.endsWith('/embeddings')) {
      embedCalls.push(call);
      const vector = state.embed?.(String(call.body.input)) ?? null;
      return vector
        ? json({
            object: 'list',
            data: [{ object: 'embedding', index: 0, embedding: vector }],
            usage: { prompt_tokens: EMBED_TOKENS, total_tokens: EMBED_TOKENS },
          })
        : json({ error: { message: 'model not found' } }, 404);
    }
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (!responder) throw new Error('fakeFetch has no responder');
    return responder(call);
  }) as typeof fetch;
  return {
    impl,
    calls,
    embedCalls,
    set embed(fn: EmbedFn | null) {
      state.embed = fn;
    },
  };
}

export function completion(content: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-test',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    ...extra,
  };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export interface TestAppOptions extends Partial<Pick<AppDeps, 'checks' | 'healthTimeoutMs'>> {
  db: Database;
  fetch?: typeof fetch;
  cache?: ExactCache;
  maxRetries?: number;
  production?: boolean;
  events?: EventBus;
  recorder?: RequestRecorder;
  shutdown?: AbortSignal;
  /** Limits to apply; by default every limit is off so suites can create many accounts. */
  guard?: Partial<Guard>;
}

const off = (name: string): Limit => ({ name, max: 0, windowSeconds: 60 });

export function testGuard(overrides: Partial<Guard> = {}): Guard {
  return {
    limiter: new RateLimiter(new MemoryCounter()),
    keyPerMinute: 0,
    playgroundPerMinute: 0,
    dailyQuota: 0,
    trustProxy: false,
    auth: {
      loginPerEmail: off('login-email'),
      loginPerIp: off('login-ip'),
      signupPerIp: off('signup-ip'),
    },
    ...overrides,
  };
}

export type TestApp = ReturnType<typeof createApp>;

export function buildApp(options: TestAppOptions): TestApp {
  const { db } = options;
  const production = options.production ?? false;
  const cookie = sessionCookie(production);
  const guard = testGuard(options.guard);
  const events = options.events ?? new MemoryEventBus();
  const entries = new EntryStore(db, silentLogger);
  const providers = new ProviderStore(db, randomBytes(32));
  const upstream = new UpstreamClient({
    timeoutMs: 1_000,
    maxRetries: options.maxRetries ?? 0,
    sleep: async () => {},
    ...(options.fetch && { fetch: options.fetch }),
  });
  const cache = new CacheManager(
    options.cache ?? new MemoryCache(),
    entries,
    new Embedder(upstream, silentLogger),
    silentLogger,
  );
  return createApp({
    logger: silentLogger,
    webOrigin: WEB_ORIGIN,
    checks: options.checks ?? {},
    loadWorkspace: createWorkspaceLoader(db, providers),
    chat: {
      resolveTenant: createTenantResolver(db, providers, silentLogger),
      cache,
      upstream,
      recorder: options.recorder ?? new RequestRecorder(db, events, silentLogger),
      guard,
    },
    dashboard: {
      db,
      providers,
      cookie,
      sessionTtlDays: 30,
      production,
      gatewayUrl: 'https://gateway.test/v1',
      guard,
    },
    analytics: {
      db,
      cookie,
      events,
      shutdown: options.shutdown ?? new AbortController().signal,
      heartbeatMs: 50,
    },
    cacheAdmin: { db, cookie, entries, cache },
    ...(options.healthTimeoutMs !== undefined && { healthTimeoutMs: options.healthTimeoutMs }),
  });
}

/** Drives the dashboard API like a browser on the dashboard origin: keeps the session cookie. */
export class Browser {
  cookie: string | undefined;

  constructor(private readonly app: TestApp) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.request(path, {
      method,
      headers: {
        origin: WEB_ORIGIN,
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(this.cookie && { cookie: this.cookie }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') ? undefined : pair;
    }
    return res;
  }

  /** Calls the API and returns the parsed body, loosely typed for assertions. */
  async json(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    return readJson(await this.call(method, path, body, headers));
  }

  /** Signs up, connects the fake upstream provider and creates a gateway key. */
  async onboard(email: string, providerKey = `sk-provider-${email}`) {
    await this.call('POST', '/api/auth/signup', { email, password: 'correct horse battery' });
    await this.call('PUT', '/api/provider', { baseUrl: UPSTREAM_URL, apiKey: providerKey });
    const res = await this.call('POST', '/api/keys', { name: 'test' });
    const { key, id } = (await res.json()) as { key: string; id: string };
    return { gatewayKey: key, keyId: id };
  }
}

/** Test-only: response bodies are asserted on directly, so they are typed loosely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const readJson = (res: Response): Promise<any> => res.json();

export function gatewayPost(
  app: TestApp,
  key: string | undefined,
  payload: unknown,
  extra: Record<string, string> = {},
) {
  return app.request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key && { authorization: `Bearer ${key}` }),
      ...extra,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}
