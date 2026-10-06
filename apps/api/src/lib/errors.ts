import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'not_found_error'
  | 'upstream_error'
  | 'timeout_error'
  | 'rate_limit_error'
  | 'api_error';

/** Error body in the shape OpenAI clients already know how to parse. */
export interface OpenAIErrorBody {
  error: { message: string; type: string; param: string | null; code: string | null };
}

export class GatewayError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly type: ErrorType,
    message: string,
    readonly code: string | null = null,
    readonly param: string | null = null,
    /** Extra response headers, e.g. Retry-After on a 429. */
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'GatewayError';
  }

  toBody(): OpenAIErrorBody {
    return {
      error: { message: this.message, type: this.type, param: this.param, code: this.code },
    };
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Normalises a non-2xx upstream response into the OpenAI error shape. Provider
 * errors that already follow it keep their message and status; anything else
 * becomes a generic 502 so raw provider bodies are never echoed back.
 */
export function normalizeUpstreamError(status: number, text: string): GatewayError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const error = (parsed as { error?: unknown } | null)?.error;
  const message =
    typeof error === 'object' && error !== null
      ? str((error as { message?: unknown }).message)
      : null;
  const validStatus = status >= 400 && status <= 599 ? (status as ContentfulStatusCode) : 502;

  if (message === null) {
    return new GatewayError(
      502,
      'upstream_error',
      `The upstream provider returned an unexpected response (HTTP ${status}).`,
      'upstream_bad_response',
    );
  }
  const e = error as Record<string, unknown>;
  return new GatewayError(
    validStatus,
    (str(e.type) ?? 'upstream_error') as ErrorType,
    message,
    str(e.code),
    str(e.param),
  );
}
