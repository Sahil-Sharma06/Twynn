import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { SessionView } from '@twynn/shared';
import type { Database } from '../db/client';
import { memberships, sessions, users, workspaces } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';

const DAY_MS = 86_400_000;

/** Creates a session and returns the raw token for the cookie. */
export async function createSession(
  db: Database,
  userId: string,
  ttlDays: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ttlDays * DAY_MS);
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

/** Resolves a cookie token to the user and their workspace, or null if invalid or expired. */
export async function resolveSession(db: Database, token: string): Promise<SessionView | null> {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    user: { id: row.userId, email: row.email, emailVerified: row.emailVerifiedAt !== null },
    workspace: { id: row.workspaceId, name: row.workspaceName },
  };
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Removes expired sessions for a user; called on login so the table does not grow unbounded. */
export async function pruneExpiredSessions(db: Database, userId: string): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, new Date())));
}
