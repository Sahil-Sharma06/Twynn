import { describe, expect, it } from 'vitest';
import { MAX_DIMENSIONS, parseEmbedding } from './embeddings';

const body = (embedding: unknown) => JSON.stringify({ data: [{ embedding }] });

describe('parseEmbedding', () => {
  it('returns the vector from an OpenAI-shaped response', () => {
    expect(parseEmbedding(body([0.1, -0.2, 0.3]))).toEqual([0.1, -0.2, 0.3]);
  });

  it.each([
    ['invalid JSON', '{'],
    ['no data', JSON.stringify({})],
    ['an empty vector', body([])],
    ['non-numbers', body([0.1, 'x'])],
    ['non-finite values', JSON.stringify({ data: [{ embedding: [1, null] }] })],
    ['the zero vector', body([0, 0, 0])],
    ['too many dimensions', body(Array(MAX_DIMENSIONS + 1).fill(0.1))],
  ])('rejects %s', (_, text) => {
    expect(parseEmbedding(text)).toBeNull();
  });
});
