import { pino } from 'pino';
import { createApp, type AppDeps } from '../app';
import type { ExactCache } from '../cache/exact';
import { UpstreamClient } from '../upstream/client';

export const silentLogger = pino({ level: 'silent' });

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

/** A fetch stand-in that records calls and answers from a queue of responders. */
export function fakeFetch(
  ...responders: Array<(call: RecordedCall) => Response | Promise<Response>>
) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (!responder) throw new Error('fakeFetch has no responder');
    return responder(call);
  }) as typeof fetch;
  return { impl, calls };
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

export function buildApp(
  options: {
    fetch?: typeof fetch;
    cache?: ExactCache;
    maxRetries?: number;
    timeoutMs?: number;
  } & Partial<Pick<AppDeps, 'checks' | 'healthTimeoutMs'>> = {},
) {
  const cache = options.cache ?? new MemoryCache();
  const upstream = new UpstreamClient({
    baseUrl: 'https://upstream.test/v1/',
    timeoutMs: options.timeoutMs ?? 1_000,
    maxRetries: options.maxRetries ?? 0,
    sleep: async () => {},
    ...(options.fetch && { fetch: options.fetch }),
  });
  return createApp({
    logger: silentLogger,
    checks: options.checks ?? {},
    chat: { cache, upstream, cacheTtlSeconds: 60 },
    ...(options.healthTimeoutMs !== undefined && { healthTimeoutMs: options.healthTimeoutMs }),
  });
}
