import { Link } from 'react-router';
import { CodeBlock, CodeTabs } from '../../components/CodeBlock';
import { PageHeader, Panel } from '../../components/Ui';
import { useConfig } from '../../lib/queries';
import styles from './Docs.module.css';

const SNIPPET_NODE = `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.TWYNN_GATEWAY_URL, // your gateway URL, shown above
  apiKey: process.env.TWYNN_API_KEY,      // twynn_sk_...
});

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
});
console.log(response.choices[0].message.content);`;

const SNIPPET_PYTHON = `import os

from openai import OpenAI

client = OpenAI(
    base_url=os.environ["TWYNN_GATEWAY_URL"],
    api_key=os.environ["TWYNN_API_KEY"],
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "What is the capital of France?"}],
)
print(response.choices[0].message.content)`;

const snippetCurl = (gateway: string) => `curl ${gateway}/chat/completions \\
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

const snippetNoCache = (gateway: string) => `curl ${gateway}/chat/completions \\
  -H 'Authorization: Bearer twynn_sk_...' \\
  -H 'X-Twynn-Cache-Control: no-cache' \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"gpt-4o-mini","messages":[...]}'`;

const HEADERS = [
  ['X-Twynn-Cache', 'HIT · MISS · BYPASS', 'Whether the cache answered this request'],
  ['X-Twynn-Cache-Layer', 'exact · twin · upstream', 'Which layer answered'],
  ['X-Twynn-Match-Score', '0.0–1.0 (twin only)', 'Cosine similarity to the stored prompt'],
  ['X-Twynn-Request-Id', 'UUID', 'The request’s id in the log; search for it in Requests'],
  ['X-RateLimit-Limit', 'integer', 'Requests per minute allowed on this key'],
  ['X-RateLimit-Remaining', 'integer', 'Remaining requests in the current window'],
  ['X-RateLimit-Reset', 'seconds', 'Seconds until the window resets'],
] as const;

/** In-app documentation: how developers adopt and use Twynn. */
export function Docs() {
  // Examples use this workspace's real gateway URL once it has loaded.
  const config = useConfig();
  const gateway = config.data?.gatewayUrl ?? 'https://your-twynn-host/v1';
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
            tabs={{ node: SNIPPET_NODE, python: SNIPPET_PYTHON, curl: snippetCurl(gateway) }}
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
        <CodeBlock code={snippetNoCache(gateway)} label="Copy no-cache example" />
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
              <Link to="/app/settings">Settings, under Twin threshold</Link>. The preview shows how
              your last 7 days of traffic would be affected before you save.
            </li>
            <li>
              <strong>Label borderline pairs</strong> in <Link to="/app/evaluate">Evaluate</Link>{' '}
              and Twynn recommends the safest threshold for your own traffic.
            </li>
          </ul>
        </div>
      </Panel>

      {/* ── Multi-key setup ───────────────────────────────────────── */}
      <Panel title="Keys and environments">
        <div className={styles.prose}>
          <p>
            Create one key per environment, for example <em>dev</em> and <em>prod</em>, in{' '}
            <Link to="/app/keys">Keys</Link>. Each key has its own rate limit and appears separately
            in the request log. All keys in a workspace share the same cache, so a miss in
            development can become a hit in production.
          </p>
          <p>
            Revoking a key takes effect on the next request. Twynn stores only a SHA-256 fingerprint
            of each gateway key, so a key is shown once, when it is created. Your provider key is
            encrypted at rest and never displayed again.
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
            code={`// HTTP 429, with Retry-After and X-RateLimit-* headers
{
  "error": {
    "message": "Rate limit of 600 requests per minute reached for this key. Retry after the time in the Retry-After header.",
    "type": "rate_limit_error",
    "param": null,
    "code": "rate_limit_exceeded"
  }
}

// HTTP 401: the key is wrong or has been revoked
{
  "error": {
    "message": "Invalid or revoked API key.",
    "type": "authentication_error",
    "param": null,
    "code": "invalid_api_key"
  }
}`}
            label="Copy error shape example"
          />
        </div>
      </Panel>
    </div>
  );
}
