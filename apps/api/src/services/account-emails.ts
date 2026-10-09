import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import { passwordResetEmail, verificationEmail } from '../lib/emails';
import type { Mailer } from '../lib/mailer';
import { issueToken } from './auth-tokens';

/**
 * Sends account emails in the background, so responses never wait on the mail provider and a
 * reset request takes the same time whether or not the address has an account.
 */
export class AccountEmails {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly webOrigin: string,
    private readonly logger: Logger,
  ) {}

  sendVerification(userId: string, email: string): void {
    this.run('verification', async () => {
      const token = await issueToken(this.db, userId, 'verify_email');
      await this.mailer.send(verificationEmail(email, this.link('/verify-email', token)));
    });
  }

  /** Emails a reset link if the address has an account; otherwise does nothing, silently. */
  requestPasswordReset(email: string): void {
    this.run('password reset', async () => {
      const [user] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (!user) return;
      const token = await issueToken(this.db, user.id, 'reset_password');
      await this.mailer.send(passwordResetEmail(email, this.link('/reset-password', token)));
    });
  }

  /** Resolves once queued emails are handed off (used on shutdown and in tests). */
  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }

  private link(path: string, token: string): string {
    return `${this.webOrigin}${path}?${new URLSearchParams({ token }).toString()}`;
  }

  private run(kind: string, task: () => Promise<void>): void {
    const job: Promise<void> = task()
      .catch((err: unknown) => this.logger.error({ err, kind }, 'failed to send account email'))
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }
}
