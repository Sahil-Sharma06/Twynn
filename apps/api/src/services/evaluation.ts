import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { EVALUATION_MIN_SCORE, type EvaluationPair } from '@twynn/shared';
import type { Database } from '../db/client';
import { requestLogs, twinLabels } from '../db/schema';

const WINDOW_DAYS = 30;
const MAX_PAIRS = 200;

/**
 * Recent twin-search pairs worth reviewing, one per distinct (prompt, closest stored prompt),
 * with any label already given.
 */
export async function evaluationPairs(
  db: Database,
  workspaceId: string,
): Promise<EvaluationPair[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const rows = await db
    .selectDistinctOn([requestLogs.promptPreview, requestLogs.matchedPrompt], {
      requestId: requestLogs.id,
      createdAt: requestLogs.createdAt,
      score: requestLogs.nearestScore,
      prompt: requestLogs.promptPreview,
      matchedPrompt: requestLogs.matchedPrompt,
      label: twinLabels.same,
    })
    .from(requestLogs)
    .leftJoin(twinLabels, eq(twinLabels.requestId, requestLogs.id))
    .where(
      and(
        eq(requestLogs.workspaceId, workspaceId),
        gte(requestLogs.createdAt, since),
        gte(requestLogs.nearestScore, EVALUATION_MIN_SCORE),
        isNotNull(requestLogs.matchedPrompt),
      ),
    )
    // Within each distinct pair, prefer a labelled row, then the newest.
    .orderBy(
      requestLogs.promptPreview,
      requestLogs.matchedPrompt,
      sql`${twinLabels.same} is null`,
      desc(requestLogs.createdAt),
    )
    .limit(MAX_PAIRS);
  return rows
    .map((r) => ({
      ...r,
      score: r.score ?? 0,
      createdAt: r.createdAt.toISOString(),
      label: r.label ?? null,
    }))
    .sort((a, b) => b.score - a.score);
}

/** Labels a pair. Returns false if the request is not a twin search in this workspace. */
export async function setLabel(
  db: Database,
  workspaceId: string,
  requestId: string,
  same: boolean,
): Promise<boolean> {
  const [request] = await db
    .select({ id: requestLogs.id })
    .from(requestLogs)
    .where(
      and(
        eq(requestLogs.id, requestId),
        eq(requestLogs.workspaceId, workspaceId),
        isNotNull(requestLogs.nearestScore),
      ),
    );
  if (!request) return false;
  await db
    .insert(twinLabels)
    .values({ requestId, workspaceId, same })
    .onConflictDoUpdate({ target: twinLabels.requestId, set: { same, labelledAt: new Date() } });
  return true;
}

export async function clearLabel(db: Database, workspaceId: string, requestId: string) {
  const rows = await db
    .delete(twinLabels)
    .where(and(eq(twinLabels.requestId, requestId), eq(twinLabels.workspaceId, workspaceId)))
    .returning({ id: twinLabels.requestId });
  return rows.length > 0;
}
