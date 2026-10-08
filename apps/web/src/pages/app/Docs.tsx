import { CodeBlock, CodeTabs } from '../../components/CodeBlock';
import { PageHeader, Panel } from '../../components/Ui';
import styles from './Docs.module.css';

const SNIPPET_NODE = `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.TWYNN_GATEWAY_URL, // e.g. https://your-twynn-host/v1
  apiKey: process.env.TWYNN_API_KEY,      // twynn_sk_...
});

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
});
console.log(response.choices[0].message.content);`;

const SNIPPET_PYTHON = `from openai import OpenAI

client = OpenAI(
    base_url=os.environ["TWYNN_GATEWAY_URL"],
    api_key=os.environ["TWYNN_API_KEY"],
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is the capital of France?"}],
)
print(response.choices[0].message.content)`;

const SNIPPET_CURL = `curl https://your-twynn-host/v1/chat/completions \\
  -H 'Authorization: Bearer twynn_sk_...' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "What is the capital of France?"}]
  }'`;

const SNIPPET_STREAM = `const stream = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Tell me a story.' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}`;

const SNIPPET_NO_CACHE = `curl https://your-twynn-host/v1/chat/completions \\
  -H 'Authorization: Bearer twynn_sk_...' \\
  -H 'X-Twynn-Cache-Control: no-cache' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"gpt-4o-mini","messages":[...]}'`;

const HEADERS = [
  ['X-Twynn-Cache', 'HIT · MISS · BYPASS', 'Whether the cache answered this request'],
  ['X-Twynn-Cache-Layer', 'exact · twin · upstream', 'Which layer answered'],
  ['X-Twynn-Match-Score', '0.0–1.0 (twin only)', 'Cosine similarity to the stored prompt'],
  ['X-Twynn-Request-Id', 'UUID', 'Request ID — find it in the Requests explorer'],
  ['X-RateLimit-Limit', 'integer', 'Requests per minute allowed on this key'],
  ['X-RateLimit-Remaining', 'integer', 'Remaining requests in the current window'],
  ['X-RateLimit-Reset', 'seconds', 'Seconds until the window resets'],
] as const;

/** In-app documentation: how developers adopt and use Twynn. */
export function Docs() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Developer guide"
        description="How to point your existing OpenAI client at Twynn and what you get in return."
      />

      {/* ── Adoption ─────────────────────────────────────────────── */}
      <Panel
        title="One line change"
        description="Keep your SDK, your prompts and your provider. Change only the base URL and the key."
      >
        <div className={styles.diffBlock}>
          <pre className={styles.diff}>
            <code>
              <span className={styles.ln}>{'const client = new OpenAI({'}</span>
              <span className={`${styles.ln} ${styles.del}`}>
                {"  baseURL: 'https://api.openai.com/v1',"}
              </span>
              <span className={`${styles.ln} ${styles.add}`}>
                {'  baseURL: process.env.TWYNN_GATEWAY_URL,'}
              </span>
              <span className={`${styles.ln} ${styles.del}`}>
                {'  apiKey: process.env.OPENAI_API_KEY,'}
              </span>
              <span className={`${styles.ln} ${styles.add}`}>
                {'  apiKey: process.env.TWYNN_API_KEY,'}
              </span>
              <span className={styles.ln}>{'});'}</span>
            </code>
          </pre>
          <p className={styles.diffNote}>
            Responses keep the exact shape your code already expects. Streaming, tools and response
            formats all work unchanged.
          </p>
        </div>
      </Panel>

      {/* ── SDK examples ──────────────────────────────────────────── */}
      <Panel title="Ready-to-run examples">
        <div className={styles.section}>
          <CodeTabs<'node' | 'python' | 'curl'>
            initial="node"
            labels={{ node: 'Node.js', python: 'Python', curl: 'curl' }}
            tabs={{ node: SNIPPET_NODE, python: SNIPPET_PYTHON, curl: SNIPPET_CURL }}
          />
        </div>
      </Panel>

      {/* ── Streaming ─────────────────────────────────────────────── */}
      <Panel
        title="Streaming"
        description="stream: true works transparently. Streamed responses are stored once complete, and cached answers stream back to clients that request a stream."
      >
        <CodeBlock code={SNIPPET_STREAM} label="Copy streaming example" />
      </Panel>

      {/* ── Response headers ──────────────────────────────────────── */}
      <Panel
        title="Response headers"
        description="Every response carries these headers so you can observe exactly what happened."
      >
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Header</th>
                <th scope="col">Values</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {HEADERS.map(([header, values, meaning]) => (
                <tr key={header}>
                  <td>
                    <code>{header}</code>
                  </td>
                  <td className={styles.values}>{values}</td>
                  <td className={styles.meaning}>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Cache control ─────────────────────────────────────────── */}
      <Panel
        title="Skipping the cache"
        description="Send X-Twynn-Cache-Control: no-cache to bypass the cache for a single request. The fresh answer replaces the stored one."
      >
        <CodeBlock code={SNIPPET_NO_CACHE} label="Copy no-cache example" />
      </Panel>

      {/* ── Twin matching ─────────────────────────────────────────── */}
      <Panel title="How twin matching works">
        <div className={styles.prose}>
          <p>
            Twynn embeds the <strong>final user message</strong> and compares it with prompts it has
            already answered using cosine similarity. The result is the <strong>match score</strong>{' '}
            shown in <code>X-Twynn-Match-Score</code>.
          </p>
          <p>
            Two requests are twins if their match score is at or above your workspace's{' '}
            <strong>twin threshold</strong> (default 0.95) <em>and</em> they share the same model,
            system prompt, earlier turns and provider URL.
          </p>
          <ul>
            <li>
              <strong>Adjust the threshold</strong> in{' '}
              <a href="/app/settings">Settings → Twin threshold</a>. The preview shows how your last
              7 days of traffic would be affected before you save.
            </li>
            <li>
              <strong>Label borderline pairs</strong> in <a href="/app/evaluate">Evaluate</a> and
              Twynn recommends the safest threshold for your own traffic.
            </li>
          </ul>
        </div>
      </Panel>

      {/* ── Multi-key setup ───────────────────────────────────────── */}
      <Panel title="Keys and environments">
        <div className={styles.prose}>
          <p>
            Create one key per environment — <em>dev</em>, <em>staging</em>, <em>prod</em> — in{' '}
            <a href="/app/keys">Keys</a>. Each key has its own rate limit and appears separately in
            the request log. All keys in a workspace share the same cache, so a miss in development
            can become a hit in production.
          </p>
          <p>
            Revoke a key instantly from the dashboard. Your provider credentials are never exposed —
            Twynn stores only a SHA-256 fingerprint of each key and encrypts your provider key at
            rest.
          </p>
        </div>
      </Panel>

      {/* ── Errors ────────────────────────────────────────────────── */}
      <Panel
        title="Error handling"
        description="Errors use the OpenAI error shape, so existing client error handling works unchanged."
      >
        <div className={styles.section}>
          <CodeBlock
            code={`// Rate limit (HTTP 429) — includes Retry-After header
{
  "error": {
    "type": "rate_limit_error",
    "message": "Rate limit exceeded. Try again in 1 second.",
    "code": "rate_limit_exceeded"
  }
}

// Authentication failure (HTTP 401)
{
  "error": {
    "type": "authentication_error",
    "message": "Invalid API key."
  }
}`}
            label="Copy error shape example"
          />
        </div>
      </Panel>
    </div>
  );
}
