import { chatCostUsd, type CacheLayer, type CacheStatus, type RequestLogView } from '@twynn/shared';
import type { Logger } from 'pino';
import type { Database } from '../db/client';
import { requestLogs } from '../db/schema';
import type { EventBus } from '../lib/events';

export const PREVIEW_CHARS = 280;

/** Filled in by the gateway route while handling a request. */
export interface MeterDraft {
  workspaceId?: string;
  keyId?: string;
  model?: string;
  promptPreview?: string;
  promptTokens?: number;
  completionTokens?: number;
  embeddingModel?: string;
  embeddingTokens?: number;
  matchScore?: number;
  /** Score of the closest stored prompt the twin search found, whether or not it was served. */
  nearestScore?: number;
  /** That closest stored prompt (the match itself, for twin hits). */
  matchedPrompt?: string;
  /** For streamed responses: resolves once the stream ends, so late token counts are included. */
  settled?: Promise<void>;
}

export interface MeterRecord extends MeterDraft {
  workspaceId: string;
  layer: CacheLayer | null;
  status: CacheStatus | null;
  statusCode: number;
  latencyMs: number;
}

const truncate = (text: string | undefined) =>
  text === undefined
    ? null
    : text.length > PREVIEW_CHARS
      ? `${text.slice(0, PREVIEW_CHARS)}…`
      : text;

/** Token counts from a chat completion body, as reported by the provider. */
export function usageFrom(text: string): { promptTokens?: number; completionTokens?: number } {
  try {
    const usage = (JSON.parse(text) as { usage?: Record<string, unknown> }).usage;
    const count = (v: unknown) =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;
    const promptTokens = count(usage?.prompt_tokens);
    const completionTokens = count(usage?.completion_tokens);
    return {
      ...(promptTokens !== undefined && { promptTokens }),
      ...(completionTokens !== undefined && { completionTokens }),
    };
  } catch {
    return {};
  }
}

type LogRow = typeof requestLogs.$inferSelect;

export function toLogView(row: LogRow): RequestLogView {
  const isHit = (row.layer === 'exact' || row.layer === 'twin') && row.statusCode === 200;
  const costSavedUsd =
    isHit && row.model && row.promptTokens !== null && row.completionTokens !== null
      ? chatCostUsd(row.model, row.promptTokens, row.completionTokens)
      : null;
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    keyId: row.keyId,
    model: row.model,
    layer: row.layer,
    status: row.status,
    statusCode: row.statusCode,
    latencyMs: row.latencyMs,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    matchScore: row.matchScore,
    promptPreview: row.promptPreview,
    costSavedUsd,
  };
}

/** Persists request records and publishes them live. Never throws. */
export class RequestRecorder {
  private pending = new Set<Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly events: EventBus,
    private readonly logger: Logger,
  ) {}

  /** Records in the background so the response is never delayed by metering. */
  record(record: MeterRecord | Promise<MeterRecord>): void {
    const task = Promise.resolve(record)
      .then((r) => this.write(r))
      .catch((err) => this.logger.error({ err }, 'failed to record request'))
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  /** Resolves once every queued record is written (used on shutdown and in tests). */
  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }

  private async write(record: MeterRecord): Promise<void> {
    try {
      const [row] = await this.db
        .insert(requestLogs)
        .values({
          workspaceId: record.workspaceId,
          keyId: record.keyId ?? null,
          model: record.model ?? null,
          layer: record.layer,
          status: record.status,
          statusCode: record.statusCode,
          latencyMs: record.latencyMs,
          promptTokens: record.promptTokens ?? null,
          completionTokens: record.completionTokens ?? null,
          embeddingModel: record.embeddingModel ?? null,
          embeddingTokens: record.embeddingTokens ?? null,
          matchScore: record.matchScore ?? null,
          nearestScore: record.nearestScore ?? null,
          promptPreview: truncate(record.promptPreview),
          matchedPrompt: truncate(record.matchedPrompt),
        })
        .returning();
      if (!row) return;
      await this.events
        .publish(record.workspaceId, { type: 'request', request: toLogView(row) })
        .catch((err) => this.logger.warn({ err }, 'failed to publish request event'));
    } catch (err) {
      this.logger.error({ err }, 'failed to record request');
    }
  }
}
