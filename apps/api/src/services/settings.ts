import { eq } from 'drizzle-orm';
import {
  DEFAULT_CACHE_SETTINGS,
  type CacheSettings,
  type CacheSettingsUpdate,
} from '@twynn/shared';
import type { Database } from '../db/client';
import { workspaceSettings } from '../db/schema';

export async function getCacheSettings(db: Database, workspaceId: string): Promise<CacheSettings> {
  const [row] = await db
    .select({
      semanticEnabled: workspaceSettings.semanticEnabled,
      twinThreshold: workspaceSettings.twinThreshold,
      ttlSeconds: workspaceSettings.ttlSeconds,
      embeddingModel: workspaceSettings.embeddingModel,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return row ?? { ...DEFAULT_CACHE_SETTINGS };
}

export async function updateCacheSettings(
  db: Database,
  workspaceId: string,
  patch: CacheSettingsUpdate,
): Promise<CacheSettings> {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const next: CacheSettings = { ...(await getCacheSettings(db, workspaceId)), ...defined };
  await db
    .insert(workspaceSettings)
    .values({ workspaceId, ...next })
    .onConflictDoUpdate({
      target: workspaceSettings.workspaceId,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}
