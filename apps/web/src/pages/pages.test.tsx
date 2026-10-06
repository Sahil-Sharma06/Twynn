import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { RequestLogView } from '@twynn/shared';
import { RequireAuth } from '../layouts/RequireAuth';
import { FakeEventSource, installEventSource, mockApi, renderWithProviders } from '../test/utils';
import { Signup } from './auth/Signup';
import { Onboarding } from './onboarding/Onboarding';
import { WaitingStep } from './onboarding/WaitingStep';

const session = {
  user: { id: 'u1', email: 'a@example.com' },
  workspace: { id: 'w1', name: 'Acme' },
};

const request = (overrides: Partial<RequestLogView> = {}): RequestLogView => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  keyId: 'k1',
  source: 'api',
  model: 'gpt-4o-mini',
  layer: 'upstream',
  status: 'MISS',
  statusCode: 200,
  latencyMs: 420,
  promptTokens: 10,
  completionTokens: 5,
  matchScore: null,
  promptPreview: 'Say hello',
  costSavedUsd: null,
  ...overrides,
});

describe('RequireAuth', () => {
  it('sends signed-out visitors to log in, remembering where they were going', async () => {
    mockApi({
      'GET /auth/me': () => ({ status: 401, body: { error: { message: 'Please log in.' } } }),
    });
    renderWithProviders(
      null,
      [
        { path: '/app', element: <RequireAuth>secret dashboard</RequireAuth> },
        { path: '/login', element: <p>login page</p> },
      ],
      '/app',
    );
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('secret dashboard')).not.toBeInTheDocument();
  });

  it('renders the page for signed-in users', async () => {
    mockApi({ 'GET /auth/me': () => ({ status: 200, body: session }) });
    renderWithProviders(
      null,
      [{ path: '/app', element: <RequireAuth>secret dashboard</RequireAuth> }],
      '/app',
    );
    expect(await screen.findByText('secret dashboard')).toBeInTheDocument();
  });
});

describe('Signup', () => {
  it('validates on the client without calling the API', async () => {
    const calls = mockApi({});
    renderWithProviders(<Signup />);
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(calls).toHaveLength(0);
  });

  it('shows a server error on the field it belongs to', async () => {
    mockApi({
      'POST /auth/signup': () => ({
        status: 409,
        body: { error: { message: 'An account with this email already exists.', param: 'email' } },
      }),
    });
    renderWithProviders(<Signup />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument();
  });
});

describe('WaitingStep', () => {
  it('waits, then shows the first real request the moment it arrives', async () => {
    installEventSource();
    mockApi({ 'GET /requests': () => ({ status: 200, body: { requests: [], nextCursor: null } }) });
    renderWithProviders(<WaitingStep />);

    expect(await screen.findByText('Waiting for your first request…')).toBeInTheDocument();
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/events');

    act(() => source.emit('request', { type: 'request', request: request() }));
    expect(await screen.findByText('Your gateway is live')).toBeInTheDocument();
    expect(screen.getByText('Miss')).toBeInTheDocument();
    expect(screen.getByText(/Run the same snippet again/)).toBeInTheDocument();

    act(() =>
      source.emit('request', {
        type: 'request',
        request: request({ layer: 'exact', status: 'HIT', latencyMs: 4 }),
      }),
    );
    expect(await screen.findByText('Exact hit')).toBeInTheDocument();
    expect(
      screen.getByText(/answered from the cache, without calling your provider/),
    ).toBeInTheDocument();
  });

  it('counts requests that arrived before the page opened', async () => {
    installEventSource();
    mockApi({
      'GET /requests': () => ({ status: 200, body: { requests: [request()], nextCursor: null } }),
    });
    renderWithProviders(<WaitingStep />);
    expect(await screen.findByText('Your gateway is live')).toBeInTheDocument();
  });

  it('explains a failed first request instead of celebrating it', async () => {
    installEventSource();
    mockApi({
      'GET /requests': () => ({
        status: 200,
        body: {
          requests: [request({ statusCode: 401, layer: 'upstream', status: 'MISS' })],
          nextCursor: null,
        },
      }),
    });
    renderWithProviders(<WaitingStep />);
    expect(await screen.findByText(/it was not answered/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 401/, { selector: 'div' })).toBeInTheDocument();
  });
});

describe('Onboarding', () => {
  it('walks a new workspace from provider to snippet with the real gateway URL and new key', async () => {
    installEventSource();
    let provider: unknown = null;
    let keyList: unknown[] = [];
    mockApi({
      'GET /provider': () => ({ status: 200, body: { provider } }),
      'PUT /provider': (init) => {
        const body = JSON.parse(String(init?.body));
        provider = {
          baseUrl: body.baseUrl,
          apiKeyHint: '…1234',
          updatedAt: new Date().toISOString(),
        };
        return { status: 200, body: { provider } };
      },
      'GET /keys': () => ({ status: 200, body: { keys: keyList } }),
      'POST /keys': () => {
        const created = {
          id: 'k1',
          name: 'My first key',
          prefix: 'twynn_sk_abc123',
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          key: 'twynn_sk_abc123SECRET',
        };
        keyList = [created];
        return { status: 201, body: created };
      },
      'GET /config': () => ({ status: 200, body: { gatewayUrl: 'https://gw.example.com/v1' } }),
      'GET /requests': () => ({ status: 200, body: { requests: [], nextCursor: null } }),
    });
    renderWithProviders(<Onboarding />);

    // Step 1: provider (OpenAI preset is selected by default).
    await userEvent.type(await screen.findByLabelText('Provider API key'), 'sk-test-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Connect provider' }));

    // Step 2: the key is revealed once and stays visible after the key list refreshes.
    await userEvent.click(await screen.findByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('twynn_sk_abc123SECRET')).toBeInTheDocument();
    expect(screen.getByText('Copy this key now')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('twynn_sk_abc123SECRET')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'I have saved my key' }));

    // Step 3: the snippet uses the real gateway URL and the new key.
    const panel = await screen.findByRole('tabpanel');
    await waitFor(() =>
      expect(within(panel).getByText(/gw\.example\.com\/v1/)).toBeInTheDocument(),
    );
    expect(panel.textContent).toContain('twynn_sk_abc123SECRET');

    await userEvent.click(screen.getByRole('tab', { name: 'Python' }));
    expect(screen.getByRole('tabpanel').textContent).toContain(
      'base_url="https://gw.example.com/v1"',
    );

    // Step 4: waiting for traffic.
    await userEvent.click(screen.getByRole('button', { name: 'I have sent it' }));
    expect(await screen.findByText('Waiting for your first request…')).toBeInTheDocument();
  });
});
