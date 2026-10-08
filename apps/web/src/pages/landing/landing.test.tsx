import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { NotFound } from '../NotFound';
import { Journey } from './Journey';
import { Landing } from './Landing';

describe('Landing', () => {
  it('leads with the headline and one primary action, and falls back to the still hero without WebGL', () => {
    renderWithProviders(<Landing />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Answer each question once.' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Get started' })[0]).toHaveAttribute(
      'href',
      '/signup',
    );
    // jsdom has no WebGL, so the static frame stands in for the 3D scene.
    expect(screen.getAllByText('Cached answer').length).toBeGreaterThan(0);
    expect(screen.getByText(/two differently worded questions/)).toBeInTheDocument();
  });

  it('makes no unmeasured claims', () => {
    renderWithProviders(<Landing />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\d+\s?%/); // no savings percentages
    expect(text).not.toMatch(/\b\d+\s?x faster\b/i);
    expect(text).not.toMatch(
      /seamless|supercharge|unlock|empower|revolutioni[sz]e|effortless|next-gen|cutting-edge|game-changing/i,
    );
    expect(text).not.toContain('—');
  });
});

describe('Journey', () => {
  it('walks a request down to the lane that answers it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Journey />);
    await user.click(screen.getByRole('button', { name: 'A new question' }));
    expect(screen.getByText('How tall is Mont Blanc?')).toBeInTheDocument();
    expect(
      await screen.findByText(/^Sent to your provider/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/below 0\.95\.$/)).toBeInTheDocument();
  });

  it('shows the outcome at once when motion is reduced', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderWithProviders(<Journey />);
    expect(screen.getByText(/^Closest stored prompt scores 0\.97/)).toBeInTheDocument();
  });
});

describe('NotFound', () => {
  it('explains the missing page and offers a way back', () => {
    renderWithProviders(<NotFound />);
    expect(screen.getByRole('heading', { name: 'This page has no twin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
