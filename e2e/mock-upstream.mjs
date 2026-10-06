// A stand-in OpenAI-compatible provider for end-to-end tests: chat completions (buffered
// and streamed) and embeddings. Two phrasings of one question embed close together, so
// the twin layer can be exercised without a real provider.
import { createHash } from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const DIM = 1536;
const KNOWN = {
  'What is the capital of France?': [1, 0],
  'Which city is the capital of France?': [0.97, Math.sqrt(1 - 0.97 ** 2)],
};

function embed(text) {
  const v = new Array(DIM).fill(0);
  if (KNOWN[text]) KNOWN[text].forEach((x, i) => (v[i] = x));
  else {
    const h = createHash('sha256').update(text).digest();
    for (let i = 0; i < DIM; i++) v[i] = (h[i % 32] - 128) / 128;
  }
  return v;
}

let calls = 0;
const usage = { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 };

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.method === 'GET') return res.end(JSON.stringify({ ok: true, calls }));
      const input = JSON.parse(body || '{}');
      if (req.url.endsWith('/embeddings')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({
            data: [{ index: 0, embedding: embed(input.input) }],
            usage: { prompt_tokens: 7, total_tokens: 7 },
          }),
        );
      }
      calls++;
      const text = `Mock answer ${calls} to: ${input.messages?.at(-1)?.content}`;
      const base = { id: `mock-${calls}`, created: 1, model: input.model };
      if (input.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (o) =>
          res.write(
            `data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', ...o })}\n\n`,
          );
        send({
          choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
        });
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        send({ choices: [], usage });
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ...base,
          object: 'chat.completion',
          choices: [
            { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
          ],
          usage,
        }),
      );
    });
  })
  .listen(PORT, () => console.log(`mock upstream on :${PORT}`));
