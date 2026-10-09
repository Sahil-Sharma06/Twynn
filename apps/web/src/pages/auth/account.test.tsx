import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppLayout } from '../../layouts/AppLayout';
import { mockApi, renderWithProviders } from '../../test/utils';
import { ForgotPassword } from './ForgotPassword';
import { Login } from './Login';
import { ResetPassword } from './ResetPassword';
import { VerifyEmail } from './VerifyEmail';

const TOKEN = 'a'.repeat(43);
const session = (emailVerified: boolean) => ({
  user: { id: 'u1', email: 'a@example.com', emailVerified },
  workspace: { id: 'w1', name: 'Acme' },
});

describe('password reset pages', () => {
  it('links to the reset flow from log in', () => {
    renderWithProviders(<Login />);
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('asks for a link and confirms without saying whether the account exists', async () => {
    const calls = mockApi({ 'POST /auth/password-reset': () => ({ status: 202 }) });
    const user = userEvent.setup();
    renderWithProviders(<ForgotPassword />);
    await user.type(screen.getByLabelText('Email'), 'someone@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(
      await screen.findByText(/If someone@example.com has a Twynn account/),
    ).toBeInTheDocument();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: 'someone@example.com' });
  });

  it('sets a new password from the link, then sends you to log in', async () => {
    const calls = mockApi({ 'POST /auth/password-reset/confirm': () => ({ status: 204 }) });
    const user = userEvent.setup();
    renderWithProviders(
      null,
      [{ path: '/reset-password', element: <ResetPassword /> }],
      `/reset-password?token=${TOKEN}`,
    );
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'a much better passphrase');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      token: TOKEN,
      password: 'a much better passphrase',
    });
  });

  it('explains an expired link', async () => {
    mockApi({
      'POST /auth/password-reset/confirm': () => ({
        status: 400,
        body: {
          error: {
            message: 'This link is invalid or has expired. Ask for a new one.',
            param: 'token',
            code: 'invalid_token',
          },
        },
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      null,
      [{ path: '/reset-password', element: <ResetPassword /> }],
      `/reset-password?token=${TOKEN}`,
    );
    await user.type(screen.getByLabelText('New password'), 'a much better passphrase');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask again' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});

describe('email verification', () => {
  it('verifies the link once when the page opens', async () => {
    const calls = mockApi({
      'POST /auth/verify-email': () => ({ status: 204 }),
      'GET /auth/me': () => ({ status: 200, body: session(true) }),
    });
    renderWithProviders(
      null,
      [{ path: '/verify-email', element: <VerifyEmail /> }],
      `/verify-email?token=${TOKEN}`,
    );
    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/auth/verify-email')).toHaveLength(1);
  });

  it('shows a banner with a resend button until the email is verified', async () => {
    const calls = mockApi({
      'GET /auth/me': () => ({ status: 200, body: session(false) }),
      'POST /auth/verify-email/resend': () => ({ status: 202 }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      null,
      [{ path: '/app', element: <AppLayout />, children: [{ index: true, element: <p>home</p> }] }],
      '/app',
    );
    expect(await screen.findByRole('region', { name: 'Email verification' })).toHaveTextContent(
      'Verify a@example.com',
    );
    await user.click(screen.getByRole('button', { name: 'Send it again' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/auth/verify-email/resend')).toBe(true),
    );
  });

  it('shows no banner once verified', async () => {
    mockApi({ 'GET /auth/me': () => ({ status: 200, body: session(true) }) });
    renderWithProviders(
      null,
      [{ path: '/app', element: <AppLayout />, children: [{ index: true, element: <p>home</p> }] }],
      '/app',
    );
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Email verification' })).toBeNull();
  });
});
