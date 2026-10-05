import { GatewayError } from '../lib/errors';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 250;
const MAX_RETRY_AFTER_MS = 5_000;

export interface UpstreamOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface UpstreamRequest {
  path: string;
  body: string;
  headers: Record<string, string>;
  /** Aborts the upstream call when the caller disconnects. */
  signal?: AbortSignal;
}

export interface BufferedResponse {
  status: number;
  headers: Headers;
  text: string;
}

export class ClientAbortedError extends Error {
  constructor() {
    super('client closed the request');
    this.name = 'ClientAbortedError';
  }
}

export function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return BASE_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * 100);
}

export class UpstreamClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: UpstreamOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Sends a request and reads the whole body inside the timeout. */
  async postBuffered(request: UpstreamRequest): Promise<BufferedResponse> {
    return this.send(request, async (res) => ({
      status: res.status,
      headers: res.headers,
      text: await res.text(),
    }));
  }

  /** Sends a request; the timeout covers only the wait for response headers. */
  async postStream(request: UpstreamRequest): Promise<Response> {
    return this.send(request, async (res) => res);
  }

  private async send<T>(request: UpstreamRequest, read: (res: Response) => Promise<T>): Promise<T> {
    const url = `${this.baseUrl}${request.path}`;
    const { timeoutMs, maxRetries } = this.options;

    for (let attempt = 0; ; attempt++) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), timeoutMs);
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeout.signal])
        : timeout.signal;

      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          body: request.body,
          headers: request.headers,
          signal,
        });
        if (attempt < maxRetries && RETRYABLE_STATUS.has(res.status)) {
          await res.body?.cancel();
          clearTimeout(timer);
          await this.sleep(backoffMs(attempt, res.headers.get('retry-after')));
          continue;
        }
        const result = await read(res);
        clearTimeout(timer);
        return result;
      } catch {
        clearTimeout(timer);
        if (request.signal?.aborted) throw new ClientAbortedError();
        if (timeout.signal.aborted) {
          // Not retried: a slow provider would multiply the caller's wait.
          throw new GatewayError(
            504,
            'timeout_error',
            `The upstream provider did not respond within ${timeoutMs}ms.`,
            'upstream_timeout',
          );
        }
        if (attempt < maxRetries) {
          await this.sleep(backoffMs(attempt, null));
          continue;
        }
        throw new GatewayError(
          502,
          'upstream_error',
          'Could not reach the upstream provider.',
          'upstream_unreachable',
          null,
        );
      }
    }
  }
}
