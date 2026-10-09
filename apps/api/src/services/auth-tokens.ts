import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { authTokens } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';

export type TokenPurpose = 'verify_email' | 'reset_password';

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify_email: 48 * 3_600_000,
  reset_password: 3_600_000,
};

/**
 * Issues a single-use token and returns the raw value for the emailed link. Earlier unused
 * tokens for the same purpose are revoked, so only the newest link works.
 */
export async function issueToken(
  db: Database,
  userId: string,
  purpose: TokenPurpose,
): Promise<string> {
  const token = randomToken(32);
  await db.transaction(async (tx) => {
    await tx
      .delete(authTokens)
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
        ),
      );
    await tx.insert(authTokens).values({
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
    });
  });
  return token;
}

/**
 * Spends a token: returns its user once, atomically; null when unknown, expired, already
 * used or issued for another purpose.
 */
export async function consumeToken(
  db: Database,
  token: string,
  purpose: TokenPurpose,
): Promise<string | null> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: authTokens.userId });
  return row?.userId ?? null;
}
