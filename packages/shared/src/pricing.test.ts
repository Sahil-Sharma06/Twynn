import { describe, expect, it } from 'vitest';
import { chatCostUsd, embeddingCostUsd, PRICING } from './pricing';

describe('pricing', () => {
  it('prices a chat completion per million tokens', () => {
    const { input, output } = PRICING.chat['gpt-4o-mini']!;
    expect(chatCostUsd('gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(input + output, 10);
    expect(chatCostUsd('gpt-4o-mini', 1000, 500)).toBeCloseTo(
      (1000 * input + 500 * output) / 1e6,
      12,
    );
  });

  it('matches dated snapshots by prefix', () => {
    expect(chatCostUsd('gpt-4o-2024-08-06', 1000, 0)).toBe(chatCostUsd('gpt-4o', 1000, 0));
  });

  it('prefers the longest matching name', () => {
    expect(chatCostUsd('gpt-4o-mini-2024-07-18', 1000, 0)).toBe(
      chatCostUsd('gpt-4o-mini', 1000, 0),
    );
    expect(chatCostUsd('gpt-4o-mini', 1000, 0)).not.toBe(chatCostUsd('gpt-4o', 1000, 0));
  });

  it('does not match a name that merely shares leading characters', () => {
    expect(chatCostUsd('gpt-4omega', 1000, 0)).toBeNull();
  });

  it('returns null for unpriced models instead of zero', () => {
    expect(chatCostUsd('my-local-llama', 1000, 1000)).toBeNull();
    expect(embeddingCostUsd('my-embedder', 1000)).toBeNull();
  });

  it('prices embeddings', () => {
    expect(embeddingCostUsd('text-embedding-3-small', 1_000_000)).toBeCloseTo(
      PRICING.embeddings['text-embedding-3-small']!,
      10,
    );
  });
});
