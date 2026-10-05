import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { pino } from 'pino';
import { createApp, type AppDeps } from '../app';
import { sessionCookie } from '../auth/middleware';
import type { ExactCache } from '../cache/exact';
import type { Database } from '../db/client';
import * as schema from '../db/schema';
import { Embedder } from '../semantic/embeddings';
import { createSemanticStore } from '../semantic/store';
import { ProviderStore } from '../services/providers';
import { createTenantResolver } from '../services/tenancy';
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
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

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
        ? json({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: vector }] })
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
}

export type TestApp = ReturnType<typeof createApp>;

export function buildApp(options: TestAppOptions): TestApp {
  const { db } = options;
  const production = options.production ?? false;
  const providers = new ProviderStore(db, randomBytes(32));
  const upstream = new UpstreamClient({
    timeoutMs: 1_000,
    maxRetries: options.maxRetries ?? 0,
    sleep: async () => {},
    ...(options.fetch && { fetch: options.fetch }),
  });
  return createApp({
    logger: silentLogger,
    webOrigin: WEB_ORIGIN,
    checks: options.checks ?? {},
    chat: {
      resolveTenant: createTenantResolver(db, providers, silentLogger),
      cache: options.cache ?? new MemoryCache(),
      semantic: createSemanticStore(db, silentLogger),
      embedder: new Embedder(upstream, silentLogger),
      upstream,
    },
    dashboard: {
      db,
      providers,
      cookie: sessionCookie(production),
      sessionTtlDays: 30,
      production,
    },
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
