import type { CacheSettings } from '@twynn/shared';
import type { Logger } from 'pino';
import type { Database } from '../db/client';
import { findActiveKey, touchKeyLastUsed } from './keys';
import type { ProviderCredentials, ProviderStore } from './providers';
import { getCacheSettings } from './settings';

export interface Tenant {
  workspaceId: string;
  /** Null for requests made from the dashboard playground, which use the session instead. */
  keyId: string | null;
  provider: ProviderCredentials | null;
  settings: CacheSettings;
}

/** Maps a raw gateway key to its tenant, or null when the key is unknown or revoked. */
export type TenantResolver = (rawKey: string) => Promise<Tenant | null>;

export function createTenantResolver(
  db: Database,
  providers: ProviderStore,
  logger: Logger,
): TenantResolver {
  return async (rawKey) => {
    const key = await findActiveKey(db, rawKey);
    if (!key) return null;
    // Bookkeeping only; never delay or fail the request for it.
    touchKeyLastUsed(db, key.id).catch((err) =>
      logger.warn({ err, keyId: key.id }, 'failed to update key last_used_at'),
    );
    const [provider, settings] = await Promise.all([
      providers.credentials(key.workspaceId),
      getCacheSettings(db, key.workspaceId),
    ]);
    return { workspaceId: key.workspaceId, keyId: key.id, provider, settings };
  };
}

/** Loads a workspace's tenant context directly, for session-authenticated playground calls. */
export type WorkspaceLoader = (workspaceId: string) => Promise<Tenant>;

export function createWorkspaceLoader(db: Database, providers: ProviderStore): WorkspaceLoader {
  return async (workspaceId) => {
    const [provider, settings] = await Promise.all([
      providers.credentials(workspaceId),
      getCacheSettings(db, workspaceId),
    ]);
    return { workspaceId, keyId: null, provider, settings };
  };
}
