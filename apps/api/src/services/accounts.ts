import { eq } from 'drizzle-orm';
import type { SignupInput } from '@twynn/shared';
import { isUniqueViolation, type Database } from '../db/client';
import { memberships, users, workspaces } from '../db/schema';
import { GatewayError } from '../lib/errors';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../lib/password';

const DEFAULT_WORKSPACE_NAME = 'My workspace';

/** Creates a user and their workspace atomically. Returns the new user id. */
export async function signup(db: Database, input: SignupInput): Promise<string> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, passwordHash })
        .returning({ id: users.id });
      const [workspace] = await tx
        .insert(workspaces)
        .values({ name: input.workspaceName ?? DEFAULT_WORKSPACE_NAME })
        .returning({ id: workspaces.id });
      if (!user || !workspace) throw new Error('insert returned no row');
      await tx
        .insert(memberships)
        .values({ userId: user.id, workspaceId: workspace.id, role: 'owner' });
      return user.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new GatewayError(
        409,
        'invalid_request_error',
        'An account with this email already exists.',
        'email_taken',
        'email',
      );
    }
    throw err;
  }
}

/** Returns the user id when the credentials are valid, otherwise null. Constant-ish time. */
export async function authenticate(
  db: Database,
  email: string,
  password: string,
): Promise<string | null> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));
  if (!user) return verifyAgainstDummy(password).then(() => null);
  return (await verifyPassword(user.passwordHash, password)) ? user.id : null;
}
