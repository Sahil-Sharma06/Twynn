# Twynn

Twynn is an OpenAI-compatible gateway that answers repeated LLM requests from a cache, so you call your provider less often. You adopt it by changing your client's `baseURL`; nothing else in your code changes.

It has two cache layers:

- **Exact hit** (Layer 1): the identical request was answered before. Served from Redis.
- **Twin hit** (Layer 2): an earlier request _meant the same thing_, worded differently. Twynn embeds the final user message and finds the closest stored prompt in Postgres with pgvector; if its **match score** (cosine similarity) is at or above the workspace's **twin threshold**, the stored answer is reused.

Anything else goes to your own OpenAI-compatible provider, and the answer is stored for next time.

```ts
const client = new OpenAI({ baseURL: 'https://your-twynn-host/v1', apiKey: 'twynn_sk_…' });
```

## Contents

- [Running locally](#running-locally)
- [Using the gateway](#using-the-gateway)
- [The dashboard](#the-dashboard)
- [Architecture](#architecture)
- [Trade-offs](#trade-offs)
- [Security](#security)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deploying](#deploying)
- [Third-party assets](#third-party-assets)

## Running locally

Requires Node 22+ and Docker.

```sh
npm install
npm run setup   # writes .env (with a fresh encryption key), starts Postgres + Redis, runs migrations
npm run dev     # API on :3000, dashboard on :5173
```

Open http://localhost:5173, create an account, and onboarding walks you through connecting a provider, creating a gateway key and sending a first request.

## Using the gateway

`POST /v1/chat/completions` accepts the OpenAI chat completions request, buffered or streamed (`stream: true`), with your Twynn key as the bearer token. Every response carries:

| Header                | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `X-Twynn-Cache`       | `HIT`, `MISS` or `BYPASS`                                  |
| `X-Twynn-Cache-Layer` | `exact`, `twin` or `upstream`                              |
| `X-Twynn-Match-Score` | Twin hits only: the cosine similarity to the stored prompt |
| `X-Twynn-Request-Id`  | The request's id in the request log                        |
| `X-RateLimit-*`       | Limit, remaining and reset for the key's per-minute limit  |

Send `X-Twynn-Cache-Control: no-cache` to skip the cache for one request; the fresh answer replaces the stored one. Errors use the OpenAI error shape, so existing client error handling works; limits return `429` with `Retry-After`.

**What makes two requests "the same"**: the exact key covers the output-affecting fields (model, messages, temperature, tools, response format and so on), canonicalised so key order and explicit `null`s don't matter. A twin must match on everything _except_ the wording of the final user message: same model, same system prompt and earlier turns, same parameters, same provider URL. Only final user messages made entirely of text (up to 16,000 characters) are eligible for twin matching; images or other parts make a request exact-only.

## The dashboard

- **Overview**: live request counts, hit rate, estimated savings and a traffic chart. Hover or select a time bucket to see the requests in it. The live feed updates the moment a request is answered.
- **Requests**: every request with its layer, latency, tokens and match score; filters live in the URL. The detail view explains the outcome, and for twin hits shows the stored prompt that was matched.
- **Playground**: two prompts side by side through your real gateway, to watch a repeat become an exact hit and a rewording become a twin hit. It uses the dashboard session, so no key is handled in the browser; its requests are labelled `playground`.
- **Cache**: browse, inspect and delete stored answers, or clear them by model, age or entirely.
- **Keys**: create (shown once), see last use, revoke.
- **Settings**: twin matching on or off, the twin threshold, expiry, embedding model and provider. Moving the threshold previews its effect on your last 7 days of traffic before you save.
- **Evaluate**: label real borderline pairs from your traffic as "same meaning" or "different", and Twynn recommends the lowest threshold that would serve none of the pairs you marked different.

Cost figures are **estimates** from provider-reported token counts and the price table in `packages/shared/src/pricing.ts`; models without a price are listed, never counted as free.

## Architecture

```
            ┌───────────── nginx (web image) ─────────────┐
 browser ──▶│ /            static dashboard (React, Vite) │
 apps    ──▶│ /v1, /api    ─────────────▶ API (Hono, Node) │
            └──────────────────────────────┬──────────────┘
                                           │
             ┌─────────────┬───────────────┼──────────────────────┐
             ▼             ▼               ▼                      ▼
          Redis        Postgres        your provider          Redis pub/sub
   exact cache,       accounts, keys,  /chat/completions,     live dashboard
   rate limits        cache catalogue, /embeddings            events (SSE)
                      pgvector twins,
                      request log
```

How a request flows:

1. **Authenticate** the key (SHA-256 lookup), then apply the per-key rate limit and the workspace daily quota.
2. **Exact lookup** in Redis by a key scoped to workspace and provider URL.
3. **Twin lookup** on a miss: embed the final user message with the workspace's provider, then run an HNSW nearest-neighbour search restricted to the workspace and the request's scope.
4. **Upstream** on a miss, with timeouts and retries (408, 429, 5xx and network errors, honouring `Retry-After`). Streams pass straight through while being reassembled; complete answers are stored in both layers.
5. **Meter** off the response path: the request log row is written after the response is sent and published to the live feed.

Repository layout:

| Path              | Purpose                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `apps/api`        | Gateway and dashboard API (Hono), Drizzle schema and migrations      |
| `apps/web`        | Dashboard and public site (React 19, Vite, TanStack Query)           |
| `packages/shared` | Vocabulary, API contracts, pricing and threshold maths, shared types |
| `e2e`             | Playwright end-to-end and accessibility tests, mock provider         |

Config, pricing and design tokens each have one source: `apps/api/src/config.ts`, `packages/shared/src/pricing.ts` and `apps/web/src/styles/tokens.css`.

## Trade-offs

- **Only the final user message is embedded.** Everything else must match exactly (it is hashed into the twin scope). This keeps twins precise and embeddings cheap, but a conversation that differs in an earlier turn will never twin-match.
- **Twin hits can be wrong.** Two prompts can score close and still need different answers ("capital of Austria" vs "capital of Australia"). The default threshold (0.95) is conservative; the Settings preview and the Evaluate tool exist so you can choose a threshold from your own traffic rather than guess.
- **Every exact miss costs an embeddings call**, even when nothing similar is stored. The cost is shown in the dashboard and subtracted from savings. Turn twin matching off for workloads with little repetition.
- **Rate limits use fixed windows** in Redis: simple and cheap, but a burst straddling a window edge can briefly reach twice the per-minute limit. If Redis is unavailable, limits **fail open** and the exact cache reads as a miss, so a Redis outage degrades caching but never takes the gateway down.
- **Request logs are written asynchronously.** A crash between response and write can lose that log row; graceful shutdown flushes pending writes.
- **Embedding vectors of any size are supported**; 384, 512, 768, 1024 and 1536 dimensions have HNSW indexes, and other sizes fall back to an exact scan.
- **Cost is computed when analytics are read**, so editing the price table re-prices history.

## Security

- **Tenant isolation**: every cache key, vector search, query and route is scoped to the workspace; cross-tenant ids read as "not found". Tests cover isolation for the cache, analytics, request detail, playground and evaluation labels.
- **Gateway keys** are 24 random bytes, stored only as SHA-256 hashes with a short display prefix, and shown once at creation.
- **Provider keys** are encrypted at rest with AES-256-GCM (`TWYNN_ENCRYPTION_KEY`), with the workspace id as authenticated data, so a ciphertext cannot be moved between workspaces.
- **Passwords** are hashed with argon2id. Password reset uses a single-use link that expires in an hour, is stored only as a hash, and signs out every session when used. Asking for a reset never reveals whether an account exists.
- **Email verification** sends a single-use link at sign-up (expires in 48 hours). Verification is soft: unverified accounts keep full access and see a reminder.
- **Sessions** are opaque random tokens stored as SHA-256 hashes, in an `HttpOnly`, `SameSite=Lax` cookie, `__Host-` prefixed and `Secure` in production.
- **CSRF**: state-changing dashboard calls require an exact `Origin` match with `TWYNN_WEB_ORIGIN` and a JSON content type.
- **SSRF**: in production, provider URLs must be `https` and may not point at localhost, private, link-local or cloud metadata addresses, including IPv4-mapped IPv6 forms. Hostnames are resolved through DNS, and a host is rejected if any address it resolves to is private: when the provider is saved, and again before every upstream call (cached per host for 60 seconds), so a name whose DNS later changes to an internal address is blocked too.
- **Abuse limits**: per-key and per-workspace rate limits and quotas; sign-in limited per account and per address; sign-up, password-reset requests and verification resends limited too. Client addresses come from the socket unless `TWYNN_TRUST_PROXY=true`.
- **Logs** redact authorization headers, cookies and keys; prompts are not logged by the API logger (only the truncated preview in the request log).
- **Headers**: the web image sends a strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff` and a referrer policy.
- **Validation** at every boundary with zod; request bodies are capped at 4 MB; upstream errors are normalised so raw provider bodies are never echoed.

Known gap: sign-up still reveals whether an email is already registered, because a new account is signed in immediately (soft verification). It is mitigated by the per-address sign-up limit, and the message points to password reset. Closing it fully would mean blocking sign-in until the email is verified.

## Configuration

All settings are environment variables with the `TWYNN_` prefix, validated at start-up (`apps/api/src/config.ts`). `.env.example` documents each one. Per-workspace cache behaviour (twin threshold, expiry, embedding model, twin matching on or off) is set in the dashboard.

## Testing

```sh
npm run check      # typecheck, lint, format check, unit and integration tests
npm run test:e2e   # Playwright: needs `npm run setup` once, then starts the API, dashboard and a mock provider
```

API tests run against an in-process Postgres with pgvector (PGlite) using the real migrations. The end-to-end suite drives the real stack through sign-up, onboarding, exact and twin hits, the explorer, settings, the playground and the cache browser, and runs axe against every page in light and dark themes (WCAG 2.2 AA). First run: `npx playwright install chromium`.

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) for the Docker images, the production compose stack, TLS and operations.

## Third-party assets

The visual identity (logo mark, palette, layouts and copy) is original to Twynn. Fonts and icons are open-licensed and self-hosted:

| Asset                                                                                                             | Use       | License                   |
| ----------------------------------------------------------------------------------------------------------------- | --------- | ------------------------- |
| [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) (via `@fontsource-variable/bricolage-grotesque`) | Headings  | SIL Open Font License 1.1 |
| [Instrument Sans](https://github.com/Instrument/instrument-sans) (via `@fontsource-variable/instrument-sans`)     | Body text | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (via `@fontsource-variable/jetbrains-mono`)          | Code      | SIL Open Font License 1.1 |
| [Lucide](https://lucide.dev) (via `lucide-react`)                                                                 | Icons     | ISC                       |
