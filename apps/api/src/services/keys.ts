import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { GATEWAY_KEY_PREFIX, type CreatedGatewayKey, type GatewayKeyView } from '@twynn/shared';
import type { Database } from '../db/client';
import { gatewayKeys } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';

/** Characters of the key kept for display: the prefix plus a few random characters. */
const DISPLAY_PREFIX_LENGTH = GATEWAY_KEY_PREFIX.length + 6;
/** last_used_at is written at most this often per key, to keep the hot path cheap. */
const LAST_USED_RESOLUTION_SECONDS = 60;

type KeyRow = typeof gatewayKeys.$inferSelect;

function toView(row: KeyRow): GatewayKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export async function createGatewayKey(
  db: Database,
  workspaceId: string,
  name: string,
): Promise<CreatedGatewayKey> {
  const key = `${GATEWAY_KEY_PREFIX}${randomToken(24)}`;
  const [row] = await db
    .insert(gatewayKeys)
    .values({
      workspaceId,
      name,
      prefix: key.slice(0, DISPLAY_PREFIX_LENGTH),
      keyHash: sha256(key),
    })
    .returning();
  if (!row) throw new Error('insert returned no row');
  return { ...toView(row), key };
}

export async function listGatewayKeys(
  db: Database,
  workspaceId: string,
): Promise<GatewayKeyView[]> {
  const rows = await db
    .select()
    .from(gatewayKeys)
    .where(eq(gatewayKeys.workspaceId, workspaceId))
    .orderBy(desc(gatewayKeys.createdAt));
  return rows.map(toView);
}

/** Revokes a key in the given workspace. Returns false if no such active key exists there. */
export async function revokeGatewayKey(
  db: Database,
  workspaceId: string,
  keyId: string,
): Promise<boolean> {
  const rows = await db
    .update(gatewayKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(gatewayKeys.id, keyId),
        eq(gatewayKeys.workspaceId, workspaceId),
        isNull(gatewayKeys.revokedAt),
      ),
    )
    .returning({ id: gatewayKeys.id });
  return rows.length > 0;
}

/** Resolves a raw gateway key to its active key row, or null. */
export async function findActiveKey(
  db: Database,
  rawKey: string,
): Promise<{ id: string; workspaceId: string } | null> {
  if (!rawKey.startsWith(GATEWAY_KEY_PREFIX)) return null;
  const [row] = await db
    .select({ id: gatewayKeys.id, workspaceId: gatewayKeys.workspaceId })
    .from(gatewayKeys)
    .where(and(eq(gatewayKeys.keyHash, sha256(rawKey)), isNull(gatewayKeys.revokedAt)));
  return row ?? null;
}

export async function touchKeyLastUsed(db: Database, keyId: string): Promise<void> {
  await db
    .update(gatewayKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(gatewayKeys.id, keyId),
        or(
          isNull(gatewayKeys.lastUsedAt),
          lt(
            gatewayKeys.lastUsedAt,
            sql`now() - make_interval(secs => ${LAST_USED_RESOLUTION_SECONDS})`,
          ),
        ),
      ),
    );
}
