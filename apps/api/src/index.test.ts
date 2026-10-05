import { describe, it, expect } from 'vitest';
import { PRODUCT_NAME } from '@twynn/shared';

describe('Health Endpoint / Shared Package', () => {
  it('should have the correct product name', () => {
    expect(PRODUCT_NAME).toBe('Twynn');
  });
});
