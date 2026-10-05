import { describe, expect, it } from 'vitest';
import { CompletionAccumulator, completionToSse, contentPieces, interceptSse } from './stream';

const completion = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1700000000,
  model: 'gpt-test',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Paris is the capital of France.' },
      logprobs: null,
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 },
};

const toolCompletion = {
  ...completion,
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'weather', arguments: '{"city":"Paris"}' },
          },
        ],
      },
      logprobs: null,
      finish_reason: 'tool_calls',
    },
  ],
};

/** Parses an SSE body into its data payloads. */
const payloads = (sse: string) =>
  sse
    .split('\n\n')
    .filter(Boolean)
    .map((block) => block.replace(/^data: /, ''));

const reassemble = (sse: string) => {
  const acc = new CompletionAccumulator();
  for (const data of payloads(sse)) if (data !== '[DONE]') acc.add(JSON.parse(data));
  return JSON.parse(acc.build()!);
};

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

const chunk = (choices: unknown[], extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1700000000, model: 'gpt-test', choices, ...extra })}\n\n`;

const upstreamSse = [
  chunk([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]),
  chunk([{ index: 0, delta: { content: 'Paris is ' }, finish_reason: null }]),
  chunk([{ index: 0, delta: { content: 'the capital of France.' }, finish_reason: null }]),
  chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]),
  chunk([], { usage: completion.usage }),
  'data: [DONE]\n\n',
];

describe('contentPieces', () => {
  it('splits into word pieces that join back exactly', () => {
    const text = '  Hello,  world!\nNew line ';
    expect(contentPieces(text).join('')).toBe(text);
    expect(contentPieces(text).length).toBeGreaterThan(2);
    expect(contentPieces('')).toEqual([]);
  });
});

describe('completionToSse', () => {
  it('replays a completion as chunks that reassemble to the original', () => {
    const sse = completionToSse(JSON.stringify(completion), { includeUsage: false });
    const data = payloads(sse);
    expect(data.at(-1)).toBe('[DONE]');
    expect(data.length).toBeGreaterThan(4);
    expect(JSON.parse(data[0]!)).toMatchObject({
      object: 'chat.completion.chunk',
      id: 'chatcmpl-1',
      choices: [{ delta: { role: 'assistant', content: '' }, finish_reason: null }],
    });
    const rebuilt = reassemble(sse);
    expect(rebuilt.choices).toEqual(completion.choices);
    expect(rebuilt.usage).toBeUndefined();
  });

  it('includes a usage chunk only when the caller asked for it', () => {
    const sse = completionToSse(JSON.stringify(completion), { includeUsage: true });
    const usageChunk = payloads(sse)
      .filter((d) => d !== '[DONE]')
      .map((d) => JSON.parse(d))
      .find((c) => c.choices.length === 0);
    expect(usageChunk?.usage).toEqual(completion.usage);
  });

  it('replays tool calls', () => {
    const rebuilt = reassemble(
      completionToSse(JSON.stringify(toolCompletion), { includeUsage: false }),
    );
    expect(rebuilt.choices).toEqual(toolCompletion.choices);
  });
});

describe('CompletionAccumulator', () => {
  it('merges tool call fragments by index', () => {
    const acc = new CompletionAccumulator();
    acc.add({
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              { index: 0, id: 'c1', type: 'function', function: { name: 'wea', arguments: '' } },
            ],
          },
        },
      ],
    });
    acc.add({
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { name: 'ther', arguments: '{"ci' } }] },
        },
      ],
    });
    acc.add({
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"P"}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(JSON.parse(acc.build()!).choices[0].message.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'weather', arguments: '{"city":"P"}' } },
    ]);
  });

  it('refuses to build until every choice has finished', () => {
    const acc = new CompletionAccumulator();
    acc.add({ choices: [{ index: 0, delta: { content: 'a' }, finish_reason: 'stop' }] });
    acc.add({ choices: [{ index: 1, delta: { content: 'b' } }] });
    expect(acc.build()).toBeNull();
    expect(new CompletionAccumulator().build()).toBeNull();
  });
});

describe('interceptSse', () => {
  it('forwards events unchanged and assembles the completion', async () => {
    let result: string | null | undefined;
    const out = await drain(
      interceptSse(streamOf(...upstreamSse), { forwardUsage: true, onEnd: (c) => (result = c) }),
    );
    expect(out).toBe(upstreamSse.join(''));
    const built = JSON.parse(result!);
    expect(built.choices[0].message.content).toBe('Paris is the capital of France.');
    expect(built.usage).toEqual(completion.usage);
  });

  it('withholds the usage-only chunk from callers who did not ask, but still meters it', async () => {
    let result: string | null | undefined;
    const out = await drain(
      interceptSse(streamOf(...upstreamSse), { forwardUsage: false, onEnd: (c) => (result = c) }),
    );
    expect(out).toBe(upstreamSse.filter((_, i) => i !== 4).join(''));
    expect(JSON.parse(result!).usage).toEqual(completion.usage);
  });

  it('handles events split across network chunks and CRLF line endings', async () => {
    const whole = upstreamSse.join('').replace(/\n/g, '\r\n');
    const parts = whole.match(/[\s\S]{1,7}/g)!;
    let result: string | null | undefined;
    await drain(
      interceptSse(streamOf(...parts), { forwardUsage: true, onEnd: (c) => (result = c) }),
    );
    expect(JSON.parse(result!).choices[0].message.content).toBe('Paris is the capital of France.');
  });

  it('reports null for a stream that ends without [DONE]', async () => {
    let result: string | null | undefined = 'unset';
    await drain(
      interceptSse(streamOf(...upstreamSse.slice(0, 3)), {
        forwardUsage: true,
        onEnd: (c) => (result = c),
      }),
    );
    expect(result).toBeNull();
  });

  it('reports null when the client disconnects', async () => {
    let result: string | null | undefined = 'unset';
    const stream = interceptSse(streamOf(...upstreamSse), {
      forwardUsage: true,
      onEnd: (c) => (result = c),
    });
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    expect(result).toBeNull();
  });

  it('reports null when the upstream errors mid-stream', async () => {
    let result: string | null | undefined = 'unset';
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(upstreamSse[0]!));
        controller.error(new Error('connection reset'));
      },
    });
    await expect(
      drain(interceptSse(failing, { forwardUsage: true, onEnd: (c) => (result = c) })),
    ).rejects.toThrow();
    expect(result).toBeNull();
  });
});
