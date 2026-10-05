import { describe, expect, it } from 'vitest';
import { CACHE_STATUS, PRODUCT_NAME, VOCABULARY } from './index';

describe('shared constants', () => {
  it('names the product Twynn', () => {
    expect(PRODUCT_NAME).toBe('Twynn');
  });

  it('pairs every vocabulary term with its technical term', () => {
    for (const term of Object.values(VOCABULARY)) {
      expect(term.label).not.toHaveLength(0);
      expect(term.technical).not.toHaveLength(0);
    }
  });

  it('exposes the three cache statuses', () => {
    expect(CACHE_STATUS).toEqual(['HIT', 'MISS', 'BYPASS']);
  });
});
