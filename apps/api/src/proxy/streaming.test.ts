import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { requestLogs } from '../db/schema';
import { MemoryEventBus } from '../lib/events';
import { RequestRecorder } from '../metering/recorder';
import {
  Browser,
  buildApp,
  completion,
  createTestDb,
  fakeFetch,
  gatewayPost,
  json,
  MemoryCache,
  silentLogger,
  type RecordedCall,
} from '../test/helpers';
import { CompletionAccumulator } from './stream';

/** End-to-end streaming: real gateway and database, fake provider that streams SSE. */
let db: Database;
beforeAll(async () => {
  db = await createTestDb();
});

const USAGE = { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 };
const chunk = (choices: unknown[], extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ id: 'chatcmpl-s', object: 'chat.completion.chunk', created: 1, model: 'gpt-test', choices, ...extra })}\n\n`;

function sseBody(text: string, { usage = true, done = true } = {}) {
  return [
    chunk([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]),
    ...text
      .split(' ')
      .map((w, i) =>
        chunk([{ index: 0, delta: { content: i ? ` ${w}` : w }, finish_reason: null }]),
      ),
    chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]),
    ...(usage ? [chunk([], { usage: USAGE })] : []),
    ...(done ? ['data: [DONE]\n\n'] : []),
  ].join('');
}

/** Answers streaming requests with SSE and buffered requests with JSON. */
const provider =
  (text: string, opts?: { usage?: boolean; done?: boolean }) => (call: RecordedCall) =>
    call.body.stream
      ? new Response(sseBody(text, opts), { headers: { 'content-type': 'text/event-stream' } })
      : json(completion(text, { usage: USAGE }));

const ask = (content: string, extra: Record<string, unknown> = {}) => ({
  model: 'gpt-test',
  messages: [{ role: 'user', content }],
  ...extra,
});

async function tenant(
  responder = provider('Paris is the capital.'),
  opts?: { cache?: MemoryCache },
) {
  const f = fakeFetch(responder);
  const cache = opts?.cache ?? new MemoryCache();
  const recorder = new RequestRecorder(db, new MemoryEventBus(), silentLogger);
  const app = buildApp({ db, fetch: f.impl, cache, recorder });
  const browser = new Browser(app);
  const { gatewayKey, keyId } = await browser.onboard(`${randomUUID()}@example.com`);
  const send = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await gatewayPost(app, gatewayKey, body, headers);
    const text = await res.text();
    await recorder.flush();
    return {
      res,
      text,
      cache: res.headers.get('x-twynn-cache'),
      layer: res.headers.get('x-twynn-cache-layer'),
    };
  };
  return { f, cache, browser, send, keyId };
}

const events = (sse: string) =>
  sse
    .split('\n\n')
    .filter(Boolean)
    .map((b) => b.replace(/^data: /, ''));

function content(sse: string) {
  const acc = new CompletionAccumulator();
  for (const data of events(sse)) if (data !== '[DONE]') acc.add(JSON.parse(data));
  return JSON.parse(acc.build()!).choices[0].message.content as string;
}

describe('streaming', () => {
  it('streams a miss through, caches it, and replays it as a stream on the next request', async () => {
    const t = await tenant();
    const first = await t.send(ask('Capital of France?', { stream: true }));
    expect([first.cache, first.layer]).toEqual(['MISS', 'upstream']);
    expect(first.res.headers.get('content-type')).toContain('text/event-stream');
    expect(content(first.text)).toBe('Paris is the capital.');

    const replay = await t.send(ask('Capital of France?', { stream: true }));
    expect([replay.cache, replay.layer]).toEqual(['HIT', 'exact']);
    expect(replay.res.headers.get('content-type')).toContain('text/event-stream');
    expect(events(replay.text).at(-1)).toBe('[DONE]');
    expect(content(replay.text)).toBe('Paris is the capital.');
    expect(t.f.calls).toHaveLength(1);
  });

  it('serves a streamed answer to a non-streaming request and vice versa', async () => {
    const t = await tenant();
    await t.send(ask('A?', { stream: true }));
    const json1 = await t.send(ask('A?'));
    expect(json1.layer).toBe('exact');
    expect(JSON.parse(json1.text).choices[0].message.content).toBe('Paris is the capital.');

    await t.send(ask('B?'));
    const stream = await t.send(ask('B?', { stream: true }));
    expect(stream.layer).toBe('exact');
    expect(content(stream.text)).toBe('Paris is the capital.');
    expect(t.f.calls).toHaveLength(2);
  });

  it('asks the provider for usage, and withholds it from callers who did not ask', async () => {
    const t = await tenant();
    const res = await t.send(ask('Q?', { stream: true }));
    expect(t.f.calls[0]?.body.stream_options).toEqual({ include_usage: true });
    expect(res.text).not.toContain('"usage"');
  });

  it('forwards usage to callers who asked, on misses and on replays', async () => {
    const t = await tenant();
    const opts = { stream: true, stream_options: { include_usage: true } };
    expect((await t.send(ask('Q?', opts))).text).toContain('"usage"');
    const replay = await t.send(ask('Q?', opts));
    expect(replay.layer).toBe('exact');
    expect(replay.text).toContain('"prompt_tokens":12');
  });

  it('meters streamed misses with the provider token counts', async () => {
    const t = await tenant();
    await t.send(ask('Metered?', { stream: true }));
    await t.send(ask('Metered?', { stream: true }));
    const rows = await db.select().from(requestLogs).where(eq(requestLogs.keyId, t.keyId));
    expect(rows.map((r) => [r.layer, r.status, r.promptTokens, r.completionTokens])).toEqual([
      ['upstream', 'MISS', 12, 6],
      ['exact', 'HIT', 12, 6],
    ]);
  });

  it('does not cache a stream that ends without [DONE]', async () => {
    const t = await tenant(provider('Cut off', { done: false }));
    await t.send(ask('Truncated?', { stream: true }));
    expect(t.cache.store.size).toBe(0);
    expect((await t.send(ask('Truncated?', { stream: true }))).cache).toBe('MISS');
  });

  it('replays twin hits as streams', async () => {
    const t = await tenant();
    t.f.embed = (text) =>
      text.startsWith('What') ? [1, 0, 0] : [0.99, Math.sqrt(1 - 0.99 ** 2), 0];
    await t.send(ask('What is the capital of France?', { stream: true }));
    const twin = await t.send(ask('Which city is the capital of France?', { stream: true }));
    expect(twin.layer).toBe('twin');
    expect(twin.res.headers.get('x-twynn-match-score')).toBe('0.9900');
    expect(content(twin.text)).toBe('Paris is the capital.');
  });

  it('passes streaming upstream errors through in OpenAI shape', async () => {
    const t = await tenant(() =>
      json({ error: { message: 'bad model', type: 'invalid_request_error' } }, 404),
    );
    const res = await t.send(ask('Q?', { stream: true }));
    expect(res.res.status).toBe(404);
    expect(JSON.parse(res.text)).toMatchObject({ error: { message: 'bad model' } });
  });
});
