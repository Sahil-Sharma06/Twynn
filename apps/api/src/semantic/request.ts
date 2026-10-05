import { canonicalRequest } from '../cache/key';
import { sha256 } from '../lib/crypto';
import type { ChatCompletionRequest } from '../proxy/schema';

/** Longer prompts skip the twin layer: they exceed typical embedding input limits. */
export const MAX_SEMANTIC_PROMPT_CHARS = 16_000;

export interface SemanticQuery {
  /** The final user message, the only part compared by meaning. */
  text: string;
  /** Hash of everything that must match exactly for a twin hit. */
  scopeHash: string;
}

/** Text of a message, or null when it contains anything but text (images, audio, files). */
function textContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content as Array<{ type?: unknown; text?: unknown }>) {
    if (part.type !== 'text' || typeof part.text !== 'string') return null;
    parts.push(part.text);
  }
  return parts.join('\n');
}

/** Human-readable text of the final message (text parts only), for request logs. */
export function finalMessageText(request: ChatCompletionRequest): string | undefined {
  const content = request.messages.at(-1)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n');
  return text || undefined;
}

/**
 * Describes how a request may be matched semantically, or returns null when it
 * must not be. Only the final user message is compared by meaning. The provider,
 * embeddings model, every output-affecting parameter (including the model) and
 * the entire earlier conversation must match exactly, so a reworded question is
 * never matched to an answer given in a different context.
 */
export function semanticQuery(
  request: ChatCompletionRequest,
  baseUrl: string,
  embeddingModel: string,
): SemanticQuery | null {
  const last = request.messages.at(-1);
  if (!last || last.role !== 'user') return null;
  const text = textContent(last.content)?.trim();
  if (!text || text.length > MAX_SEMANTIC_PROMPT_CHARS) return null;

  const { content, ...lastWithoutContent } = last;
  const scope = {
    baseUrl,
    embeddingModel,
    request: canonicalRequest({ ...request, messages: request.messages.slice(0, -1) }),
    last: canonicalRequest({ messages: [lastWithoutContent] }),
  };
  return { text, scopeHash: sha256(JSON.stringify(scope)) };
}
