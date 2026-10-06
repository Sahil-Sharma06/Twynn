import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  AnalyticsSummary,
  CacheSettings,
  RequestDetailView,
  RequestLogView,
  ThresholdPreview,
  Timeseries,
  TimeseriesPoint,
} from '@twynn/shared';
import { describePoint, layerSegments, niceCeiling, TimeChart } from '../../components/TimeChart';
import { hasActiveFilters, readFilters, toRequestQuery, writeFilters } from '../../lib/filters';
import { formatDuration } from '../../lib/format';
import { bucketWindow } from '../../lib/range';
import {
  FakeEventSource,
  installEventSource,
  mockApi,
  renderWithProviders,
} from '../../test/utils';
import { answerText, Cache } from './Cache';
import { Keys } from './Keys';
import { Overview } from './Overview';
import { RequestDetail } from './RequestDetail';
import { Requests } from './Requests';
import { Settings, settingsPatch } from './Settings';
import { describeThreshold } from './ThresholdPreview';

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

const latency = { avgMs: 5, p50Ms: 4, p95Ms: 9 };
const summary = (overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary => ({
  from: '2026-10-04T00:00:00.000Z',
  to: '2026-10-05T00:00:00.000Z',
  requests: 10,
  exactHits: 3,
  twinHits: 2,
  misses: 5,
  bypassed: 0,
  errors: 0,
  hitRate: 0.5,
  tokensSaved: 1234,
  latency: { exact: latency, twin: latency, upstream: latency },
  cost: {
    savedUsd: 0.5,
    embeddingUsd: 0.01,
    netUsd: 0.49,
    unpricedModels: [],
    pricingAsOf: '2025-06-01',
  },
  ...overrides,
});

const point = (t: string, overrides: Partial<TimeseriesPoint> = {}): TimeseriesPoint => ({
  t,
  requests: 4,
  exactHits: 1,
  twinHits: 1,
  misses: 2,
  errors: 0,
  avgLatencyMs: 100,
  costSavedUsd: 0,
  ...overrides,
});

const series: Timeseries = {
  from: '2026-10-05T00:00:00.000Z',
  to: '2026-10-05T03:00:00.000Z',
  bucket: 'hour',
  points: [
    point('2026-10-05T00:00:00.000Z'),
    point('2026-10-05T01:00:00.000Z', {
      requests: 0,
      exactHits: 0,
      twinHits: 0,
      misses: 0,
      avgLatencyMs: null,
    }),
    point('2026-10-05T02:00:00.000Z', { requests: 6 }),
  ],
};

const settings: CacheSettings = {
  semanticEnabled: true,
  twinThreshold: 0.95,
  ttlSeconds: 86_400,
  embeddingModel: 'text-embedding-3-small',
};

const ok = (body: unknown) => () => ({ status: 200, body });

describe('dashboard helpers', () => {
  it('round-trips explorer filters through the URL, leaving defaults out', () => {
    const filters = readFilters(new URLSearchParams('result=twin&q=paris&bogus=1'));
    expect(filters).toMatchObject({ result: 'twin', q: 'paris', model: '' });
    expect(writeFilters(filters).toString()).toBe('result=twin&q=paris');
    expect(readFilters(new URLSearchParams('result=nonsense')).result).toBe('all');
    expect(hasActiveFilters(readFilters(new URLSearchParams()))).toBe(false);
  });

  it('maps result filters onto API filters', () => {
    const base = readFilters(new URLSearchParams());
    expect(toRequestQuery({ ...base, result: 'twin' }, 50)).toMatchObject({
      layer: 'twin',
      status: 'HIT',
      limit: 50,
    });
    expect(toRequestQuery({ ...base, result: 'errors' }, 50)).toMatchObject({ errorsOnly: 'true' });
    expect(toRequestQuery({ ...base, q: '  ' }, 50).q).toBeUndefined();
  });

  it('rounds chart axes up to a clean number', () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(23)).toBe(25);
    expect(niceCeiling(180)).toBe(200);
  });

  it('stacks every request in exactly one segment', () => {
    const p = point('2026-10-05T00:00:00.000Z', { requests: 9 });
    const segments = layerSegments(p);
    expect(segments.reduce((n, s) => n + s.value, 0)).toBe(9);
    expect(segments.find((s) => s.key === 'other')?.value).toBe(5);
  });

  it('gives each bucket its own window', () => {
    expect(bucketWindow('2026-10-05T02:00:00.000Z', 'hour')).toEqual({
      from: '2026-10-05T02:00:00.000Z',
      to: '2026-10-05T03:00:00.000Z',
    });
  });

  it('sends only the settings that changed', () => {
    expect(settingsPatch(settings, settings)).toEqual({});
    expect(settingsPatch(settings, { ...settings, twinThreshold: 0.9 })).toEqual({
      twinThreshold: 0.9,
    });
  });

  it('warns about loose thresholds', () => {
    expect(describeThreshold(0.99).tone).toBe('info');
    expect(describeThreshold(0.95).tone).toBe('info');
    expect(describeThreshold(0.88).tone).toBe('warning');
    expect(describeThreshold(0.6).text).toMatch(/wrong stored answer/);
  });

  it('formats durations and stored answers', () => {
    expect(formatDuration(86_400)).toBe('1 day');
    expect(formatDuration(7200)).toBe('2 hours');
    expect(formatDuration(90)).toBe('90 seconds');
    expect(answerText({ choices: [{ message: { content: 'Paris.' } }] })).toBe('Paris.');
    expect(answerText({ choices: [{ message: { content: null } }] })).toBeNull();
    expect(answerText('garbage')).toBeNull();
  });
});

describe('TimeChart', () => {
  it('moves between buckets with the keyboard and announces each one', async () => {
    const onPin = vi.fn();
    const { rerender } = renderWithProviders(
      <TimeChart
        points={series.points}
        bucket="hour"
        mode="layers"
        active={null}
        onHover={() => {}}
        onPin={onPin}
        label="Traffic"
      />,
    );
    const plot = screen.getByRole('group', { name: /Traffic/ });
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(onPin).toHaveBeenLastCalledWith(1); // from the latest bucket
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(onPin).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(onPin).toHaveBeenLastCalledWith(null);
    expect(describePoint(series.points[0]!, 'hour', 'layers')).toMatch(
      /4 requests, 1 exact hits, 1 twin hits, 2 misses/,
    );
    expect(describePoint(series.points[1]!, 'hour', 'latency')).toMatch(/no requests/);
    rerender(<></>);
  });
});

describe('Overview', () => {
  const routes = (overrides: Record<string, () => { status: number; body?: unknown }> = {}) =>
    mockApi({
      'GET /provider': ok({
        provider: { baseUrl: 'https://api.example.com/v1', apiKeyHint: '…abcd', updatedAt: 'x' },
      }),
      'GET /analytics/summary': ok(summary()),
      'GET /analytics/timeseries': ok(series),
      'GET /analytics/models': ok({ models: [] }),
      'GET /requests': ok({
        requests: [request({ promptPreview: 'First question' })],
        nextCursor: null,
      }),
      ...overrides,
    });

  it('shows real totals and puts live requests in the feed the moment they arrive', async () => {
    installEventSource();
    routes();
    renderWithProviders(<Overview />);
    expect(await screen.findByText('First question')).toBeInTheDocument();
    expect(screen.getByText('Requests', { selector: 'dt' })).toBeInTheDocument();
    expect(await screen.findAllByText('50%')).not.toHaveLength(0);
    const source = FakeEventSource.instances[0]!;
    act(() => source.emit('ready', {}));
    expect(screen.getByText('Live')).toBeInTheDocument();
    act(() =>
      source.emit('request', {
        type: 'request',
        request: request({
          promptPreview: 'Brand new question',
          layer: 'twin',
          status: 'HIT',
          matchScore: 0.97,
        }),
      }),
    );
    expect(await screen.findByText('Brand new question')).toBeInTheDocument();
    expect(screen.getByText('match 0.970')).toBeInTheDocument();
  });

  it('has a designed empty state before any traffic', async () => {
    installEventSource();
    routes({
      'GET /analytics/summary': ok(
        summary({ requests: 0, exactHits: 0, twinHits: 0, misses: 0, hitRate: null }),
      ),
      'GET /requests': ok({ requests: [], nextCursor: null }),
    });
    renderWithProviders(<Overview />);
    expect(await screen.findByText('No traffic yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ready-to-run snippet/ })).toHaveAttribute(
      'href',
      '/onboarding',
    );
  });

  it('reveals the requests behind a selected bucket', async () => {
    installEventSource();
    const calls = routes();
    renderWithProviders(<Overview />);
    const plot = await screen.findByRole('group', { name: /Requests by layer over time/ });
    fireEvent.keyDown(plot, { key: 'Home' });
    const link = await screen.findByRole('link', { name: /See all 4 in the explorer/ });
    expect(link.getAttribute('href')).toContain('from=2026-10-05T00%3A00%3A00.000Z');
    expect(
      calls.some(
        (c) => c.path.includes('from=2026-10-05T00%3A00%3A00.000Z') && c.path.includes('limit=5'),
      ),
    ).toBe(true);
  });
});

describe('Requests', () => {
  it('applies filters instantly and sends them to the API', async () => {
    const calls = mockApi({
      'GET /requests': ok({
        requests: [request({ promptPreview: 'Capital of France?' })],
        nextCursor: null,
      }),
      'GET /analytics/models': ok({ models: [] }),
      'GET /keys': ok({ keys: [] }),
    });
    const user = userEvent.setup();
    renderWithProviders(null, [{ path: '/app/requests', element: <Requests /> }], '/app/requests');
    expect(await screen.findByRole('link', { name: 'Capital of France?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Twin hits' }));
    expect(screen.getByRole('button', { name: 'Twin hits' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() =>
      expect(
        calls.some((c) => c.path.includes('layer=twin') && c.path.includes('status=HIT')),
      ).toBe(true),
    );
  });

  it('offers to clear filters when nothing matches', async () => {
    mockApi({
      'GET /requests': ok({ requests: [], nextCursor: null }),
      'GET /analytics/models': ok({ models: [] }),
      'GET /keys': ok({ keys: [] }),
    });
    renderWithProviders(
      null,
      [{ path: '/app/requests', element: <Requests /> }],
      '/app/requests?result=errors',
    );
    expect(await screen.findByText('No requests match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

describe('RequestDetail', () => {
  const detail = (overrides: Partial<RequestDetailView>): RequestDetailView => ({
    ...request(),
    matchedPrompt: null,
    nearestScore: null,
    embeddingModel: 'text-embedding-3-small',
    embeddingTokens: 8,
    ...overrides,
  });
  const render = (r: RequestDetailView) => {
    mockApi({
      [`GET /requests/${r.id}`]: ok({ request: r }),
      'GET /settings': ok({ settings }),
      'GET /keys': ok({ keys: [] }),
    });
    renderWithProviders(
      null,
      [{ path: '/app/requests/:id', element: <RequestDetail /> }],
      `/app/requests/${r.id}`,
    );
  };

  it('shows the stored prompt a twin hit matched, with its score', async () => {
    render(
      detail({
        layer: 'twin',
        status: 'HIT',
        matchScore: 0.972,
        nearestScore: 0.972,
        promptPreview: 'Which city is the capital of France?',
        matchedPrompt: 'What is the capital of France?',
      }),
    );
    expect(await screen.findByText('The twin it matched')).toBeInTheDocument();
    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument();
    expect(await screen.findByText(/meets the twin threshold of 0.950/)).toBeInTheDocument();
  });

  it('explains how close a miss came', async () => {
    render(detail({ nearestScore: 0.912, matchedPrompt: 'How tall is Everest?' }));
    expect(
      await screen.findByText('Closest stored prompt', { selector: 'h2' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/is below the twin threshold of 0.950/)).toBeInTheDocument();
    expect(screen.getByText(/At a twin threshold of 0.912 or lower/)).toBeInTheDocument();
  });

  it('says when a request does not exist', async () => {
    mockApi({
      'GET /requests/missing': () => ({
        status: 404,
        body: { error: { message: 'Request not found.' } },
      }),
      'GET /settings': ok({ settings }),
      'GET /keys': ok({ keys: [] }),
    });
    renderWithProviders(
      null,
      [{ path: '/app/requests/:id', element: <RequestDetail /> }],
      '/app/requests/missing',
    );
    expect(await screen.findByText('Request not found')).toBeInTheDocument();
  });
});

describe('Cache', () => {
  it('shows a stored answer and deletes an entry only after confirmation', async () => {
    const entry = {
      id: 'e1',
      model: 'gpt-4o-mini',
      prompt: 'What is the capital of France?',
      twinEligible: true,
      hitCount: 3,
      lastHitAt: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const calls = mockApi({
      'GET /cache': ok({ entries: [entry], nextCursor: null }),
      'GET /cache/e1': ok({
        entry: { ...entry, response: { choices: [{ message: { content: 'Paris.' } }] } },
      }),
      'DELETE /cache/e1': () => ({ status: 204 }),
      'GET /analytics/models': ok({ models: [] }),
    });
    const user = userEvent.setup();
    renderWithProviders(null, [{ path: '/app/cache', element: <Cache /> }], '/app/cache');
    await user.click(
      await screen.findByRole('button', { name: /What is the capital of France\?/ }),
    );
    expect(await screen.findByText('Paris.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete entry' }));
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
    await user.click(
      within(screen.getByRole('group', { name: 'Delete this cached response?' })).getByRole(
        'button',
        { name: 'Delete' },
      ),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.init?.method === 'DELETE' && c.path === '/cache/e1')).toBe(true),
    );
  });

  it('has a designed empty state', async () => {
    mockApi({
      'GET /cache': ok({ entries: [], nextCursor: null }),
      'GET /analytics/models': ok({ models: [] }),
    });
    renderWithProviders(null, [{ path: '/app/cache', element: <Cache /> }], '/app/cache');
    expect(await screen.findByText('The cache is empty')).toBeInTheDocument();
  });
});

describe('Keys', () => {
  it('revokes a key after confirmation', async () => {
    const key = {
      id: 'k1',
      name: 'Production',
      prefix: 'twynn_sk_abc',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    const calls = mockApi({
      'GET /keys': ok({ keys: [key] }),
      'DELETE /keys/k1': () => ({ status: 204 }),
    });
    const user = userEvent.setup();
    renderWithProviders(<Keys />);
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    await user.click(
      within(screen.getByRole('group', { name: /Revoke "Production"/ })).getByRole('button', {
        name: 'Revoke',
      }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.init?.method === 'DELETE' && c.path === '/keys/k1')).toBe(true),
    );
  });
});

describe('Settings', () => {
  const preview: ThresholdPreview = {
    days: 7,
    searches: 10,
    buckets: [
      { score: 0.4, count: 4 },
      { score: 0.91, count: 3 },
      { score: 0.96, count: 3 },
    ],
    examples: [
      {
        requestId: 'r1',
        createdAt: new Date().toISOString(),
        score: 0.91,
        prompt: 'Capital of France?',
        matchedPrompt: 'Capital of Germany?',
      },
    ],
  };

  it('previews a new threshold from real traffic before saving, then saves only the change', async () => {
    const calls = mockApi({
      'GET /settings': ok({ settings }),
      'GET /provider': ok({ provider: null }),
      'GET /analytics/threshold-preview': ok(preview),
      'PATCH /settings': (init) => ({
        status: 200,
        body: { settings: { ...settings, ...JSON.parse(String(init?.body)) } },
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    expect(
      await screen.findByText(/would have been answered from the cache at 0.950, the same as now/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider', { name: 'Twin threshold' }), {
      target: { value: '0.9' },
    });
    expect(await screen.findByText(/3 more than at your current 0.950/)).toBeInTheDocument();
    expect(screen.getByText(/Do they really ask the same thing/)).toBeInTheDocument();
    expect(screen.getByText('Capital of Germany?')).toBeInTheDocument();
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === 'PATCH')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === 'PATCH');
      expect(JSON.parse(String(patch?.init?.body))).toEqual({ twinThreshold: 0.9 });
    });
    expect(await screen.findByText(/Saved. New requests use these settings/)).toBeInTheDocument();
  });

  it('explains when there is no traffic to preview yet', async () => {
    mockApi({
      'GET /settings': ok({ settings }),
      'GET /provider': ok({ provider: null }),
      'GET /analytics/threshold-preview': ok({ days: 7, searches: 0, buckets: [], examples: [] }),
    });
    renderWithProviders(<Settings />);
    expect(await screen.findByText(/No twin searches in the last 7 days yet/)).toBeInTheDocument();
  });
});
