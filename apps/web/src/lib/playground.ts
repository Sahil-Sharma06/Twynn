import {
  CACHE_CONTROL_HEADER,
  CACHE_CONTROL_NO_CACHE,
  CACHE_HEADERS,
  REQUEST_ID_HEADER,
  type CacheLayer,
  type CacheStatus,
} from '@twynn/shared';

export interface PlaygroundRequest {
  model: string;
  system: string;
  prompt: string;
  stream: boolean;
  skipCache: boolean;
}

export interface PlaygroundResult {
  httpStatus: number;
  status: CacheStatus | null;
  layer: CacheLayer | null;
  matchScore: number | null;
  /** Id of the request in the log, for linking to its detail. */
  requestId: string | null;
  /** Measured in the browser: until response headers, and until the answer was complete. */
  firstByteMs: number;
  totalMs: number;
  text: string;
  error: string | null;
}

/** Splits buffered SSE text into complete `data:` payloads and the unfinished remainder. */
export function parseSse(buffer: string): { data: string[]; rest: string } {
  const events = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = events.pop() ?? '';
  const data = events.flatMap((event) =>
    event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()),
  );
  return { data, rest };
}

const deltaText = (payload: string): string => {
  if (payload === '[DONE]') return '';
  try {
    const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown } }> };
    const content = chunk.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
};

const errorMessage = (body: unknown, status: number) =>
  (body as { error?: { message?: string } } | null)?.error?.message ??
  `The request failed (HTTP ${status}).`;

/**
 * Sends one chat completion through the workspace's gateway via the session-authenticated
 * playground endpoint. `onText` receives the answer so far while it streams.
 */
export async function runPlayground(
  input: PlaygroundRequest,
  { signal, onText }: { signal?: AbortSignal; onText?: (text: string) => void } = {},
): Promise<PlaygroundResult> {
  const messages = [
    ...(input.system.trim() ? [{ role: 'system', content: input.system }] : []),
    { role: 'user', content: input.prompt },
  ];
  const started = performance.now();
  const res = await fetch('/api/playground/chat/completions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(input.skipCache && { [CACHE_CONTROL_HEADER]: CACHE_CONTROL_NO_CACHE }),
    },
    body: JSON.stringify({ model: input.model, messages, stream: input.stream }),
    ...(signal && { signal }),
  });
  const firstByteMs = Math.round(performance.now() - started);
  const score = res.headers.get(CACHE_HEADERS.matchScore);
  const base = {
    httpStatus: res.status,
    status: res.headers.get(CACHE_HEADERS.status) as CacheStatus | null,
    layer: res.headers.get(CACHE_HEADERS.layer) as CacheLayer | null,
    matchScore: score === null ? null : Number(score),
    requestId: res.headers.get(REQUEST_ID_HEADER),
    firstByteMs,
  };

  const isStream = res.ok && res.headers.get('content-type')?.includes('text/event-stream');
  if (!isStream || !res.body) {
    const body = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    } | null;
    const content = body?.choices?.[0]?.message?.content;
    return {
      ...base,
      totalMs: Math.round(performance.now() - started),
      text: res.ok && typeof content === 'string' ? content : '',
      error: res.ok ? null : errorMessage(body, res.status),
    };
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parsed = parseSse(buffer + value);
    buffer = parsed.rest;
    const added = parsed.data.map(deltaText).join('');
    if (added) {
      text += added;
      onText?.(text);
    }
  }
  return { ...base, totalMs: Math.round(performance.now() - started), text, error: null };
}
