import type { CacheSettings, InvalidateInput } from '@twynn/shared';
import type { Logger } from 'pino';
import type { ChatCompletionRequest } from '../proxy/schema';
import type { Embedder, Embedding } from '../semantic/embeddings';
import { finalMessageText, semanticQuery, type SemanticQuery } from '../semantic/request';
import type { ProviderCredentials } from '../services/providers';
import type { EntryStore } from './entries';
import type { ExactCache } from './exact';
import { exactCacheKey } from './key';
import { sha256 } from '../lib/crypto';

export interface CacheContext {
  workspaceId: string;
  provider: ProviderCredentials;
  settings: CacheSettings;
  request: ChatCompletionRequest;
  signal?: AbortSignal;
}

export type CacheHit =
  | { layer: 'exact'; response: string }
  | { layer: 'twin'; response: string; score: number; matchedPrompt: string | null };

/** Everything learned while looking up a request, reused to store the answer on a miss. */
export interface Lookup {
  hit: CacheHit | null;
  exactKey: string;
  query: SemanticQuery | null;
  embedding: Embedding | null;
}

/**
 * Cache entries are scoped to the workspace and to the provider URL, so switching
 * providers never serves answers produced by the previous one.
 */
export function cacheScope(workspaceId: string, baseUrl: string): string {
  return `${workspaceId}:${sha256(baseUrl).slice(0, 16)}`;
}

/** A successful completion worth caching: valid JSON with at least one message choice. */
export function isCacheableCompletion(text: string): boolean {
  try {
    const body = JSON.parse(text) as { choices?: unknown };
    return (
      Array.isArray(body.choices) &&
      body.choices.length > 0 &&
      body.choices.every((choice: { message?: unknown }) => typeof choice?.message === 'object')
    );
  } catch {
    return false;
  }
}

/** Coordinates both layers: Redis (exact) and the Postgres catalogue with twin search. */
export class CacheManager {
  constructor(
    private readonly exact: ExactCache,
    private readonly entries: EntryStore,
    private readonly embedder: Embedder,
    private readonly logger: Logger,
  ) {}

  /**
   * Looks the request up in Layer 1, then Layer 2. With `read: false` (the bypass
   * header) nothing is served, but the key and embedding are still prepared so the
   * fresh answer can be stored.
   */
  async lookup(ctx: CacheContext, { read }: { read: boolean }): Promise<Lookup> {
    const { workspaceId, provider, settings, request, signal } = ctx;
    const exactKey = exactCacheKey(cacheScope(workspaceId, provider.baseUrl), request);

    if (read) {
      const cached = await this.exact.get(exactKey);
      if (cached !== null) {
        this.track(this.entries.recordHit({ exactKey }));
        return {
          hit: { layer: 'exact', response: cached },
          exactKey,
          query: null,
          embedding: null,
        };
      }
    }

    const query = settings.semanticEnabled
      ? semanticQuery(request, provider.baseUrl, settings.embeddingModel)
      : null;
    const embedding = query
      ? await this.embedder.embed({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: settings.embeddingModel,
          text: query.text,
          ...(signal && { signal }),
        })
      : null;

    if (read && query && embedding) {
      const twin = await this.entries.findTwin({
        workspaceId,
        scopeHash: query.scopeHash,
        embedding: embedding.vector,
        threshold: settings.twinThreshold,
      });
      if (twin) {
        this.track(this.entries.recordHit({ id: twin.id }));
        return {
          hit: {
            layer: 'twin',
            response: twin.response,
            score: twin.score,
            matchedPrompt: twin.prompt,
          },
          exactKey,
          query,
          embedding,
        };
      }
    }
    return { hit: null, exactKey, query, embedding };
  }

  /** Stores a fresh answer in both layers, if it is a cacheable completion. */
  async store(ctx: CacheContext, lookup: Lookup, response: string): Promise<void> {
    if (!isCacheableCompletion(response)) return;
    const { workspaceId, settings, request } = ctx;
    await this.exact.set(lookup.exactKey, response, settings.ttlSeconds);
    await this.entries.upsert({
      workspaceId,
      exactKey: lookup.exactKey,
      model: request.model,
      prompt: finalMessageText(request) ?? null,
      twin:
        lookup.query && lookup.embedding
          ? { scopeHash: lookup.query.scopeHash, embedding: lookup.embedding.vector }
          : null,
      response,
      ttlSeconds: settings.ttlSeconds,
    });
  }

  /** Deletes one entry. Returns false if it does not exist in the workspace. */
  async remove(workspaceId: string, id: string): Promise<boolean> {
    return (await this.delete(workspaceId, { id })) > 0;
  }

  /** Deletes all matching entries in the workspace. Returns how many were deleted. */
  async invalidate(workspaceId: string, criteria: InvalidateInput): Promise<number> {
    return this.delete(workspaceId, criteria);
  }

  /** Redis first: if it fails, the catalogue row survives and the delete can be retried. */
  private async delete(workspaceId: string, target: { id: string } | InvalidateInput) {
    const found = await this.entries.findForDeletion(workspaceId, target);
    await this.exact.del(found.map((e) => e.exactKey));
    await this.entries.deleteByIds(
      workspaceId,
      found.map((e) => e.id),
    );
    return found.length;
  }

  private track(task: Promise<void>): void {
    task.catch((err) => this.logger.warn({ err }, 'failed to record cache hit'));
  }
}
