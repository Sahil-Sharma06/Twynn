import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseSse, type PlaygroundResult } from '../../lib/playground';
import { renderWithProviders } from '../../test/utils';
import { compareRuns, Playground } from './Playground';

const settings = {
  semanticEnabled: true,
  twinThreshold: 0.95,
  ttlSeconds: 86_400,
  embeddingModel: 'text-embedding-3-small',
};
const provider = { baseUrl: 'https://api.example.com/v1', apiKeyHint: '…abcd', updatedAt: 'x' };

type Reply = { body: BodyInit; headers: Record<string, string>; status?: number };

/** Stubs the dashboard API plus the playground endpoint, which answers from `replies` in order. */
function stubApi(replies: Reply[], extra: Record<string, unknown> = {}) {
  const sent: Array<{ body: unknown; headers: Headers }> = [];
  const jsonRes = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path =
        String(input)
          .replace(/^\/api/, '')
          .split('?')[0] ?? '';
      if (path === '/playground/chat/completions') {
        sent.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
        const reply = replies.shift();
        if (!reply) throw new Error('no reply queued');
        return new Response(reply.body, { status: reply.status ?? 200, headers: reply.headers });
      }
      if (path in extra) return jsonRes(extra[path]);
      if (path === '/provider') return jsonRes({ provider });
      if (path === '/settings') return jsonRes({ settings });
      if (path === '/analytics/models') return jsonRes({ models: [] });
      throw new Error(`Unexpected API call: ${path}`);
    }),
  );
  return sent;
}

const completion = (text: string) => JSON.stringify({ choices: [{ message: { content: text } }] });
const headers = (status: string, layer: string, extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  'X-Twynn-Cache': status,
  'X-Twynn-Cache-Layer': layer,
  'X-Twynn-Request-Id': crypto.randomUUID(),
  ...extra,
});

const result = (totalMs: number, overrides: Partial<PlaygroundResult> = {}): PlaygroundResult => ({
  httpStatus: 200,
  status: 'MISS',
  layer: 'upstream',
  matchScore: null,
  requestId: null,
  firstByteMs: totalMs,
  totalMs,
  text: 'x',
  error: null,
  ...overrides,
});

describe('playground helpers', () => {
  it('splits SSE into complete data payloads and keeps the unfinished rest', () => {
    expect(parseSse('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b"')).toEqual({
      data: ['{"a":1}', '[DONE]'],
      rest: 'data: {"b"',
    });
    expect(parseSse(': comment\r\n\r\n')).toEqual({ data: [], rest: '' });
  });

  it('compares measured timings in plain words', () => {
    expect(compareRuns(result(800), result(20))).toBe('B was 40.0× faster (20 ms vs 800 ms).');
    expect(compareRuns(result(100), result(120))).toBe('A was 20 ms faster (100 ms vs 120 ms).');
    expect(compareRuns(result(100, { error: 'x' }), result(5))).toBeNull();
  });
});

describe('Playground', () => {
  it('sends a prompt through the gateway and labels the layer that answered', async () => {
    const sent = stubApi([{ body: completion('Paris.'), headers: headers('MISS', 'upstream') }]);
    const user = userEvent.setup();
    renderWithProviders(<Playground />);
    const a = await screen.findByRole('region', { name: 'A' });
    await user.type(within(a).getByLabelText('Prompt'), 'Capital of France?');
    await user.click(within(a).getByRole('button', { name: 'Send A' }));
    expect(await within(a).findByText('Paris.')).toBeInTheDocument();
    expect(within(a).getByText('Miss')).toBeInTheDocument();
    expect(within(a).getByRole('link', { name: 'View request' })).toBeInTheDocument();
    expect(sent[0]?.body).toEqual({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Capital of France?' }],
      stream: false,
    });
  });

  it('sends A then B, and shows the twin B matched', async () => {
    const twinId = crypto.randomUUID();
    const sent = stubApi(
      [
        { body: completion('Paris.'), headers: headers('MISS', 'upstream') },
        {
          body: completion('Paris.'),
          headers: {
            ...headers('HIT', 'twin', { 'X-Twynn-Match-Score': '0.9712' }),
            'X-Twynn-Request-Id': twinId,
          },
        },
      ],
      { [`/requests/${twinId}`]: { request: { id: twinId, matchedPrompt: 'Capital of France?' } } },
    );
    const user = userEvent.setup();
    renderWithProviders(<Playground />);
    const a = await screen.findByRole('region', { name: 'A' });
    const b = screen.getByRole('region', { name: 'B' });
    await user.type(within(a).getByLabelText('Prompt'), 'Capital of France?');
    await user.type(within(b).getByLabelText('Prompt'), 'Which city is the capital of France?');
    await user.type(screen.getByLabelText(/System prompt/), 'Be brief.');
    await user.click(screen.getByRole('button', { name: 'Send both' }));

    expect(await within(b).findByText('Twin hit')).toBeInTheDocument();
    expect(within(b).getByText(/0.971/)).toBeInTheDocument();
    expect(await within(b).findByText('Capital of France?')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/faster/);
    expect(
      sent.map(
        (s) => (s.body as { messages: Array<{ content: string }> }).messages.at(-1)?.content,
      ),
    ).toEqual(['Capital of France?', 'Which city is the capital of France?']);
    expect((sent[0]?.body as { messages: unknown[] }).messages[0]).toEqual({
      role: 'system',
      content: 'Be brief.',
    });
  });

  it('streams the answer as it arrives and honours "skip the cache"', async () => {
    const encoder = new TextEncoder();
    const chunk = (content: string) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk('Par')));
        controller.enqueue(encoder.encode(chunk('is.') + 'data: [DONE]\n\n'));
        controller.close();
      },
    });
    const sent = stubApi([
      { body, headers: { ...headers('BYPASS', 'upstream'), 'content-type': 'text/event-stream' } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Playground />);
    const a = await screen.findByRole('region', { name: 'A' });
    await user.click(screen.getByLabelText('Stream responses'));
    await user.click(within(a).getByLabelText('Skip the cache'));
    await user.type(within(a).getByLabelText('Prompt'), 'Capital?');
    await user.click(within(a).getByRole('button', { name: 'Send A' }));
    expect(await within(a).findByText('Paris.')).toBeInTheDocument();
    expect(within(a).getByText('Bypass')).toBeInTheDocument();
    expect(sent[0]?.headers.get('X-Twynn-Cache-Control')).toBe('no-cache');
    expect((sent[0]?.body as { stream: boolean }).stream).toBe(true);
  });

  it('shows the gateway error instead of an answer', async () => {
    stubApi([
      {
        status: 400,
        body: JSON.stringify({ error: { message: 'The model does not exist.' } }),
        headers: { 'content-type': 'application/json' },
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<Playground />);
    const a = await screen.findByRole('region', { name: 'A' });
    await user.type(within(a).getByLabelText('Prompt'), 'Hi');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await within(a).findByText('The model does not exist.')).toBeInTheDocument();
  });

  it('asks for a provider before anything can be sent', async () => {
    stubApi([], { '/provider': { provider: null } });
    renderWithProviders(<Playground />);
    expect(await screen.findByText('Connect a provider first')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send A' })).toBeDisabled());
  });
});
