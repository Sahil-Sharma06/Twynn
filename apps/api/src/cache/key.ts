import { createHash } from 'node:crypto';

/**
 * Request fields that can change the model's output. This is an allowlist on
 * purpose: an unknown parameter can never make two different requests collide,
 * it can only cost a cache miss. Fields such as `stream`, `user`, `metadata`
 * and `store` are excluded because they do not change the answer.
 */
export const OUTPUT_AFFECTING_FIELDS = [
  'model',
  'messages',
  'temperature',
  'top_p',
  'n',
  'stop',
  'max_tokens',
  'max_completion_tokens',
  'presence_penalty',
  'frequency_penalty',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'seed',
  'response_format',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'functions',
  'function_call',
  'reasoning_effort',
  'modalities',
  'audio',
  'prediction',
] as const;

const CACHE_KEY_VERSION = 'v1';

/** Recursively sorts object keys and drops undefined values; array order is preserved. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, canonicalize((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** The output-affecting subset of a request, normalised so equivalent requests match. */
export function canonicalRequest(request: Record<string, unknown>): unknown {
  const picked: Record<string, unknown> = {};
  for (const field of OUTPUT_AFFECTING_FIELDS) {
    const value = request[field];
    // An explicit null means "use the default", the same as omitting the field.
    if (value === undefined || value === null) continue;
    picked[field] = field === 'stop' && typeof value === 'string' ? [value] : value;
  }
  return canonicalize(picked);
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Redis key for the exact layer, namespaced by an opaque per-caller scope. */
export function exactCacheKey(scope: string, request: Record<string, unknown>): string {
  const digest = sha256(JSON.stringify(canonicalRequest(request)));
  return `twynn:${CACHE_KEY_VERSION}:exact:${scope}:${digest}`;
}
