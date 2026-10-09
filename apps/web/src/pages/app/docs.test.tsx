import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderWithProviders } from '../../test/utils';
import { Docs } from './Docs';

describe('Docs', () => {
  it('uses the workspace gateway URL in its examples and links within the app', async () => {
    mockApi({
      'GET /config': () => ({ status: 200, body: { gatewayUrl: 'https://gw.example.com/v1' } }),
    });
    renderWithProviders(<Docs />);
    expect(
      await screen.findByText(/curl https:\/\/gw\.example\.com\/v1\/chat\/completions/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Evaluate' })).toHaveAttribute('href', '/app/evaluate');
    expect(screen.getByRole('link', { name: 'Keys' })).toHaveAttribute('href', '/app/keys');
  });

  it('shows the error messages the API actually returns, with no em dashes', () => {
    mockApi({
      'GET /config': () => ({ status: 200, body: { gatewayUrl: 'https://gw.example.com/v1' } }),
    });
    renderWithProviders(<Docs />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Invalid or revoked API key.');
    expect(text).toContain('"code": "invalid_api_key"');
    expect(text).toContain('requests per minute reached for this key');
    expect(text).not.toContain('—');
  });
});
