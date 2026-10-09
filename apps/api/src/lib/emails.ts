import { PRODUCT_NAME } from '@twynn/shared';
import type { Email } from './mailer';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A plain, readable email: one paragraph, one link, a short footer. */
function layout(
  to: string,
  subject: string,
  intro: string,
  action: string,
  link: string,
  footer: string,
): Email {
  const text = `${intro}\n\n${action}:\n${link}\n\n${footer}\n\n${PRODUCT_NAME}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf9f6;font-family:system-ui,sans-serif;color:#1b1a24">
<div style="max-width:480px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e7e3d9;border-radius:12px">
<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${escape(intro)}</p>
<p style="margin:0 0 16px"><a href="${escape(link)}" style="display:inline-block;padding:10px 16px;background:#4b3ccc;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600">${escape(action)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5b5768">If the button does not work, paste this link into your browser:<br>${escape(link)}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#5b5768">${escape(footer)}</p>
</div></body></html>`;
  return { to, subject, text, html };
}

export function verificationEmail(to: string, link: string): Email {
  return layout(
    to,
    `Verify your email for ${PRODUCT_NAME}`,
    `Confirm that ${to} is your email address so ${PRODUCT_NAME} can reach you about your account.`,
    'Verify email',
    link,
    'The link works once and expires in 48 hours. If you did not create an account, you can ignore this email.',
  );
}

export function passwordResetEmail(to: string, link: string): Email {
  return layout(
    to,
    `Reset your ${PRODUCT_NAME} password`,
    `Someone asked to reset the password for the ${PRODUCT_NAME} account ${to}.`,
    'Choose a new password',
    link,
    'The link works once and expires in 1 hour. Resetting signs you out everywhere. If you did not ask for this, ignore this email and your password stays the same.',
  );
}
