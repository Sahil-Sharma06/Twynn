/**
 * Streaming support for OpenAI-style Server-Sent Events:
 * - replaying a stored chat completion as a chunked stream (cache hits), and
 * - passing an upstream stream through while reassembling it into a completion
 *   that can be cached once it finishes cleanly.
 */

interface ToolCall {
  id?: string;
  type?: string;
  function: { name: string; arguments: string };
}

interface Message {
  role?: string;
  content?: string | null;
  refusal?: string | null;
  tool_calls?: ToolCall[];
}

interface Choice {
  index: number;
  message?: Message;
  finish_reason?: string | null;
  logprobs?: unknown;
}

interface Completion {
  id?: string;
  created?: number;
  model?: string;
  system_fingerprint?: string;
  choices: Choice[];
  usage?: unknown;
}

const DONE = 'data: [DONE]\n\n';
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/** Splits text into word-sized pieces (keeping whitespace) so replays stream naturally. */
export function contentPieces(text: string): string[] {
  return text.match(/\s*\S+\s*/g) ?? (text ? [text] : []);
}

/** Renders a stored chat.completion as the SSE body a streaming client expects. */
export function completionToSse(
  completionText: string,
  { includeUsage }: { includeUsage: boolean },
): string {
  const completion = JSON.parse(completionText) as Completion;
  const base = {
    id: completion.id,
    object: 'chat.completion.chunk',
    created: completion.created,
    model: completion.model,
    ...(completion.system_fingerprint && { system_fingerprint: completion.system_fingerprint }),
  };
  const chunk = (choice: Record<string, unknown>) => event({ ...base, choices: [choice] });

  let out = '';
  for (const choice of completion.choices) {
    const message = choice.message ?? {};
    const index = choice.index;
    out += chunk({
      index,
      delta: { role: message.role ?? 'assistant', content: message.content === null ? null : '' },
      finish_reason: null,
    });
    for (const piece of contentPieces(message.content ?? '')) {
      out += chunk({ index, delta: { content: piece }, finish_reason: null });
    }
    if (message.refusal) {
      out += chunk({ index, delta: { refusal: message.refusal }, finish_reason: null });
    }
    if (message.tool_calls?.length) {
      out += chunk({
        index,
        delta: { tool_calls: message.tool_calls.map((call, i) => ({ index: i, ...call })) },
        finish_reason: null,
      });
    }
    out += chunk({ index, delta: {}, finish_reason: choice.finish_reason ?? 'stop' });
  }
  if (includeUsage && completion.usage) {
    out += event({ ...base, choices: [], usage: completion.usage });
  }
  return out + DONE;
}

interface ChunkChoice {
  index?: number;
  delta?: {
    role?: string;
    content?: string | null;
    refusal?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface Chunk {
  id?: string;
  created?: number;
  model?: string;
  system_fingerprint?: string;
  choices?: ChunkChoice[];
  usage?: unknown;
}

/** Rebuilds a chat.completion from streamed chunks. */
export class CompletionAccumulator {
  private id: string | undefined;
  private created: number | undefined;
  private model: string | undefined;
  private systemFingerprint: string | undefined;
  private usage: unknown;
  private readonly choices = new Map<
    number,
    {
      role: string;
      content: string | null;
      refusal: string | null;
      toolCalls: Map<number, ToolCall>;
      finishReason: string | null;
    }
  >();

  add(chunk: Chunk): void {
    this.id ??= chunk.id;
    this.created ??= chunk.created;
    this.model ??= chunk.model;
    this.systemFingerprint ??= chunk.system_fingerprint;
    if (chunk.usage) this.usage = chunk.usage;
    for (const c of chunk.choices ?? []) {
      const index = c.index ?? 0;
      const choice = this.choices.get(index) ?? {
        role: 'assistant',
        content: null,
        refusal: null,
        toolCalls: new Map<number, ToolCall>(),
        finishReason: null,
      };
      const delta = c.delta ?? {};
      if (delta.role) choice.role = delta.role;
      if (typeof delta.content === 'string')
        choice.content = (choice.content ?? '') + delta.content;
      if (typeof delta.refusal === 'string')
        choice.refusal = (choice.refusal ?? '') + delta.refusal;
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const call = choice.toolCalls.get(i) ?? { function: { name: '', arguments: '' } };
        if (tc.id) call.id = tc.id;
        if (tc.type) call.type = tc.type;
        call.function.name += tc.function?.name ?? '';
        call.function.arguments += tc.function?.arguments ?? '';
        choice.toolCalls.set(i, call);
      }
      if (c.finish_reason) choice.finishReason = c.finish_reason;
      this.choices.set(index, choice);
    }
  }

  /** The assembled completion, or null if any choice did not finish. */
  build(): string | null {
    if (this.choices.size === 0) return null;
    const choices: Choice[] = [];
    for (const [index, c] of [...this.choices.entries()].sort(([a], [b]) => a - b)) {
      if (!c.finishReason) return null;
      const toolCalls = [...c.toolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call);
      choices.push({
        index,
        message: {
          role: c.role,
          content: c.content,
          ...(c.refusal !== null && { refusal: c.refusal }),
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        logprobs: null,
        finish_reason: c.finishReason,
      });
    }
    return JSON.stringify({
      id: this.id,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      ...(this.systemFingerprint && { system_fingerprint: this.systemFingerprint }),
      choices,
      ...(this.usage !== undefined && { usage: this.usage }),
    });
  }
}

export interface InterceptOptions {
  /** Forward the usage-only chunk to the client (it asked for usage itself). */
  forwardUsage: boolean;
  /**
   * Called exactly once: with the assembled completion when the stream ended
   * cleanly with [DONE], otherwise with null (client disconnect, upstream error,
   * truncated stream).
   */
  onEnd: (completion: string | null) => void;
}

/**
 * Passes an upstream SSE stream through event by event, reassembling the
 * completion as it goes. Only the usage-only chunk may be withheld.
 */
export function interceptSse(
  source: ReadableStream<Uint8Array>,
  { forwardUsage, onEnd }: InterceptOptions,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const acc = new CompletionAccumulator();
  let buffer = '';
  let sawDone = false;
  let ended = false;
  const end = (clean: boolean) => {
    if (ended) return;
    ended = true;
    onEnd(clean && sawDone ? acc.build() : null);
  };

  /** Returns whether the event should reach the client. */
  const process = (block: string): boolean => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return true;
    if (data === '[DONE]') {
      sawDone = true;
      return true;
    }
    try {
      const chunk = JSON.parse(data) as Chunk;
      acc.add(chunk);
      const usageOnly = Array.isArray(chunk.choices) && chunk.choices.length === 0 && chunk.usage;
      return forwardUsage || !usageOnly;
    } catch {
      return true; // not ours to judge; forward untouched
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Keep reading until there is something to send, so pull always makes progress.
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.trim() && process(buffer)) controller.enqueue(encoder.encode(buffer));
            controller.close();
            end(true);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let out = '';
          for (let m = /\r?\n\r?\n/.exec(buffer); m; m = /\r?\n\r?\n/.exec(buffer)) {
            const block = buffer.slice(0, m.index);
            buffer = buffer.slice(m.index + m[0].length);
            if (process(block)) out += `${block}\n\n`;
          }
          if (out) {
            controller.enqueue(encoder.encode(out));
            return;
          }
        }
      } catch (err) {
        end(false);
        controller.error(err);
      }
    },
    async cancel(reason) {
      end(false);
      await reader.cancel(reason);
    },
  });
}
