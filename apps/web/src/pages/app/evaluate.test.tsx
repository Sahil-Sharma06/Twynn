import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { EvaluationPair } from '@twynn/shared';
import { mockApi, renderWithProviders } from '../../test/utils';
import { Evaluate } from './Evaluate';

const settings = {
  semanticEnabled: true,
  twinThreshold: 0.9,
  ttlSeconds: 86_400,
  embeddingModel: 'text-embedding-3-small',
};

const pair = (i: number, score: number, label: boolean | null): EvaluationPair => ({
  requestId: `r${i}`,
  createdAt: new Date().toISOString(),
  score,
  prompt: `Question ${i}`,
  matchedPrompt: `Stored ${i}`,
  label,
});

describe('Evaluate', () => {
  it('recommends a threshold from labels and applies it', async () => {
    // Nine reviewed already; one more pushes it over the minimum.
    const pairs = [
      ...[0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92].map((s, i) => pair(i, s, true)),
      pair(8, 0.915, false),
      pair(9, 0.91, null),
    ];
    const calls = mockApi({
      'GET /evaluation': () => ({ status: 200, body: { pairs } }),
      'GET /settings': () => ({ status: 200, body: { settings } }),
      'PUT /evaluation/labels/r9': () => ({ status: 204 }),
      'PATCH /settings': () => ({
        status: 200,
        body: { settings: { ...settings, twinThreshold: 0.92 } },
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<Evaluate />);
    expect(await screen.findByText(/Label a few more pairs/)).toBeInTheDocument();

    const card = screen.getByText('Question 9').closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'Different' }));
    expect(await screen.findByText('0.920')).toBeInTheDocument();
    expect(screen.getByText(/none of the 2 pairs you marked different/)).toBeInTheDocument();
    expect(screen.getByText(/2 false hits/)).toBeInTheDocument(); // at the current 0.900

    await user.click(screen.getByRole('button', { name: 'Use 0.920' }));
    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === 'PATCH');
      expect(JSON.parse(String(patch?.init?.body))).toEqual({ twinThreshold: 0.92 });
    });
    expect(calls.some((c) => c.path === '/evaluation/labels/r9' && c.init?.method === 'PUT')).toBe(
      true,
    );
  });

  it('explains what will appear before there is traffic', async () => {
    mockApi({
      'GET /evaluation': () => ({ status: 200, body: { pairs: [] } }),
      'GET /settings': () => ({ status: 200, body: { settings } }),
    });
    renderWithProviders(<Evaluate />);
    expect(await screen.findByText('Nothing to review yet')).toBeInTheDocument();
  });
});
