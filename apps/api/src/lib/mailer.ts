import type { Logger } from 'pino';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends transactional email. Throws when the message could not be handed off. */
export interface Mailer {
  send(email: Email): Promise<void>;
}

const RESEND_URL = 'https://api.resend.com/emails';

/** Sends through Resend's HTTP API. The API key is only ever sent to Resend. */
export function createResendMailer({
  apiKey,
  from,
  fetch: fetchImpl = fetch,
  timeoutMs = 10_000,
}: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Mailer {
  return {
    async send({ to, subject, text, html }) {
      const res = await fetchImpl(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // The response body may describe the account, so only the status is reported.
        throw new Error(`Resend rejected the email (HTTP ${res.status})`);
      }
    },
  };
}

/**
 * Development only: writes each email, including its link, to the log instead of sending
 * it, so the flows can be tried without an email provider.
 */
export function createLogMailer(logger: Logger): Mailer {
  return {
    async send({ to, subject, text }) {
      logger.info({ to, subject, text }, 'email (development: logged, not sent)');
    },
  };
}

/** Production without TWYNN_RESEND_API_KEY: nothing can be sent, and the log says so. */
export function createDisabledMailer(logger: Logger): Mailer {
  return {
    async send({ subject }) {
      logger.warn({ subject }, 'email not sent: set TWYNN_RESEND_API_KEY to enable email');
    },
  };
}

/** Collects emails in memory; used by tests. */
export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email): Promise<void> {
    this.sent.push(email);
  }
  /** The first URL in the most recent email to an address. */
  linkTo(address: string): string | null {
    const email = this.sent.filter((e) => e.to === address).at(-1);
    return email?.text.match(/https?:\/\/\S+/)?.[0] ?? null;
  }
}
