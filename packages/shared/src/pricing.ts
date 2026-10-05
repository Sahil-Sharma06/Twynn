/**
 * Pricing table used to ESTIMATE cost saved. This is the single place to edit
 * prices. Values are USD per 1M tokens, copied from providers' public list
 * prices on the date below; check them against your provider before relying on
 * the numbers, and add the models you use. Models missing here are reported as
 * unpriced rather than counted as free.
 */
export const PRICING = {
  asOf: '2025-06-01',
  currency: 'USD',
  /** Chat models: input and output price per 1M tokens. Matched by longest name prefix. */
  chat: {
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4.1': { input: 2, output: 8 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'o3-mini': { input: 1.1, output: 4.4 },
  } as Record<string, { input: number; output: number }>,
  /** Embeddings models: price per 1M input tokens. */
  embeddings: {
    'text-embedding-3-small': 0.02,
    'text-embedding-3-large': 0.13,
  } as Record<string, number>,
} as const;

const PER_TOKEN = 1 / 1_000_000;

/** Longest key that `model` equals or starts with followed by "-", so dated snapshots match. */
function lookup<T>(table: Record<string, T>, model: string): T | undefined {
  let best: string | undefined;
  for (const name of Object.keys(table)) {
    if ((model === name || model.startsWith(`${name}-`)) && name.length > (best?.length ?? 0)) {
      best = name;
    }
  }
  return best === undefined ? undefined : table[best];
}

/** Estimated USD cost of a chat completion, or null when the model has no price. */
export function chatCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const price = lookup(PRICING.chat, model);
  if (!price) return null;
  return (promptTokens * price.input + completionTokens * price.output) * PER_TOKEN;
}

/** Estimated USD cost of an embeddings call, or null when the model has no price. */
export function embeddingCostUsd(model: string, tokens: number): number | null {
  const price = lookup(PRICING.embeddings, model);
  return price === undefined ? null : tokens * price * PER_TOKEN;
}
