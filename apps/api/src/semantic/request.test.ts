import { describe, expect, it } from 'vitest';
import type { ChatCompletionRequest } from '../proxy/schema';
import { MAX_SEMANTIC_PROMPT_CHARS, semanticQuery } from './request';

const BASE = 'https://api.example.com/v1';
const EMBED = 'text-embedding-3-small';

const req = (overrides: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  model: 'gpt-test',
  messages: [
    { role: 'system', content: 'You are terse.' },
    { role: 'user', content: 'What is the capital of France?' },
  ],
  temperature: 0,
  ...overrides,
});

const query = (r: ChatCompletionRequest, base = BASE, embed = EMBED) =>
  semanticQuery(r, base, embed);
const withLast = (content: unknown) =>
  req({
    messages: [{ role: 'system', content: 'You are terse.' }, { role: 'user', content } as never],
  });

describe('semanticQuery', () => {
  it('compares only the final user message', () => {
    expect(query(req())?.text).toBe('What is the capital of France?');
  });

  it('gives rewordings of the final message the same scope', () => {
    expect(query(withLast('Name the capital city of France.'))?.scopeHash).toBe(
      query(req())?.scopeHash,
    );
  });

  it('joins text parts and trims', () => {
    const q = query(
      withLast([
        { type: 'text', text: ' Hello ' },
        { type: 'text', text: 'world ' },
      ]),
    );
    expect(q?.text).toBe('Hello \nworld');
  });

  it.each([
    ['the model', req({ model: 'gpt-other' })],
    ['temperature', req({ temperature: 0.7 })],
    ['tools', req({ tools: [{ type: 'function', function: { name: 'f' } }] })],
    ['response_format', req({ response_format: { type: 'json_object' } })],
    [
      'the system prompt',
      req({
        messages: [
          { role: 'system', content: 'You are verbose.' },
          { role: 'user', content: 'What is the capital of France?' },
        ],
      }),
    ],
    [
      'earlier turns',
      req({
        messages: [
          { role: 'system', content: 'You are terse.' },
          { role: 'user', content: 'Talk about Texas.' },
          { role: 'assistant', content: 'Texas is large.' },
          { role: 'user', content: 'What is the capital of France?' },
        ],
      }),
    ],
    [
      'the final message name',
      req({
        messages: [
          { role: 'system', content: 'You are terse.' },
          { role: 'user', content: 'What is the capital of France?', name: 'alice' },
        ],
      }),
    ],
  ])('changes scope when %s differs', (_, other) => {
    expect(query(other)?.scopeHash).not.toBe(query(req())?.scopeHash);
  });

  it('changes scope with the provider and the embeddings model', () => {
    const base = query(req())?.scopeHash;
    expect(query(req(), 'https://other.example.com/v1')?.scopeHash).not.toBe(base);
    expect(query(req(), BASE, 'other-embedding')?.scopeHash).not.toBe(base);
  });

  it('ignores fields that do not affect output', () => {
    expect(query(req({ stream: true, user: 'u' }))?.scopeHash).toBe(query(req())?.scopeHash);
  });

  it.each([
    [
      'the last message is not from the user',
      req({ messages: [{ role: 'assistant', content: 'Hi' }] }),
    ],
    [
      'the content has an image',
      withLast([
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'x' } },
      ]),
    ],
    ['the content is empty', withLast('   ')],
    ['the content is null', withLast(null)],
    ['the prompt is too long', withLast('x'.repeat(MAX_SEMANTIC_PROMPT_CHARS + 1))],
  ])('skips the twin layer when %s', (_, r) => {
    expect(query(r)).toBeNull();
  });
});
