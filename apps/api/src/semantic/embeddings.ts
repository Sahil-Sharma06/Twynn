import type { Logger } from 'pino';
import type { UpstreamClient } from '../upstream/client';

/** pgvector supports more, but no mainstream embeddings model produces larger vectors. */
export const MAX_DIMENSIONS = 4_096;

export interface EmbedRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  text: string;
  signal?: AbortSignal;
}

export interface Embedding {
  vector: number[];
  /** Tokens billed for the call, when the provider reports them. */
  tokens: number | null;
}

/** Tokens reported in an embeddings response's usage block. */
export function embeddingTokens(text: string): number | null {
  try {
    const usage = (JSON.parse(text) as { usage?: Record<string, unknown> }).usage;
    const tokens = usage?.prompt_tokens ?? usage?.total_tokens;
    return typeof tokens === 'number' && Number.isInteger(tokens) && tokens >= 0 ? tokens : null;
  } catch {
    return null;
  }
}

/** Returns a usable embedding vector, or null when the response is not one. */
export function parseEmbedding(text: string): number[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const embedding = (body as { data?: Array<{ embedding?: unknown }> } | null)?.data?.[0]
    ?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0 || embedding.length > MAX_DIMENSIONS) {
    return null;
  }
  if (!embedding.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  // Cosine similarity is undefined for the zero vector.
  if (embedding.every((v) => v === 0)) return null;
  return embedding as number[];
}

/**
 * Calls the tenant's OpenAI-compatible /embeddings endpoint. Failures return null
 * so the request continues as an ordinary miss instead of failing.
 */
export class Embedder {
  constructor(
    private readonly upstream: UpstreamClient,
    private readonly logger: Logger,
  ) {}

  async embed({ baseUrl, apiKey, model, text, signal }: EmbedRequest): Promise<Embedding | null> {
    try {
      const res = await this.upstream.postBuffered({
        baseUrl,
        path: '/embeddings',
        body: JSON.stringify({ model, input: text }),
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        ...(signal && { signal }),
      });
      if (res.status !== 200) {
        this.logger.warn(
          { status: res.status, model },
          'embeddings request failed; skipping twin layer',
        );
        return null;
      }
      const vector = parseEmbedding(res.text);
      if (!vector) {
        this.logger.warn({ model }, 'embeddings response unusable; skipping twin layer');
        return null;
      }
      return { vector, tokens: embeddingTokens(res.text) };
    } catch (err) {
      if (signal?.aborted) throw err;
      this.logger.warn({ err, model }, 'embeddings request errored; skipping twin layer');
      return null;
    }
  }
}
