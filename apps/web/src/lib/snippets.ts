export type SnippetLanguage = 'curl' | 'node' | 'python';

export interface SnippetInput {
  gatewayUrl: string;
  apiKey: string;
  model: string;
}

/** Single quotes for a shell string, safely escaping any embedded single quotes. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Ready-to-run examples that send one real request through the user's gateway. */
export function buildSnippets({
  gatewayUrl,
  apiKey,
  model,
}: SnippetInput): Record<SnippetLanguage, string> {
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Say hello to Twynn in five words.' }],
  });
  return {
    curl: [
      `curl ${gatewayUrl}/chat/completions \\`,
      `  -H ${shellQuote(`Authorization: Bearer ${apiKey}`)} \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d ${shellQuote(body)}`,
    ].join('\n'),
    node: [
      `import OpenAI from 'openai';`,
      ``,
      `const client = new OpenAI({`,
      `  baseURL: ${JSON.stringify(gatewayUrl)},`,
      `  apiKey: ${JSON.stringify(apiKey)},`,
      `});`,
      ``,
      `const completion = await client.chat.completions.create({`,
      `  model: ${JSON.stringify(model)},`,
      `  messages: [{ role: 'user', content: 'Say hello to Twynn in five words.' }],`,
      `});`,
      `console.log(completion.choices[0].message.content);`,
    ].join('\n'),
    python: [
      `from openai import OpenAI`,
      ``,
      `client = OpenAI(`,
      `    base_url=${JSON.stringify(gatewayUrl)},`,
      `    api_key=${JSON.stringify(apiKey)},`,
      `)`,
      ``,
      `completion = client.chat.completions.create(`,
      `    model=${JSON.stringify(model)},`,
      `    messages=[{"role": "user", "content": "Say hello to Twynn in five words."}],`,
      `)`,
      `print(completion.choices[0].message.content)`,
    ].join('\n'),
  };
}
