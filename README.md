# Twynn

An OpenAI-compatible gateway that caches LLM responses in two layers: an exact-match cache in Redis and a semantic cache in pgvector.

## Local development

Requires Node 22+ and Docker.

```sh
npm install
npm run setup   # creates .env, starts Postgres + Redis, runs migrations
npm run dev     # API on :3000, web on :5173
```

`npm run check` runs typecheck, lint, format check, and tests.

## Using the gateway

Sign up, connect an OpenAI-compatible provider (base URL and key), and create a gateway key through the dashboard API (`/api/auth/signup`, `/api/provider`, `/api/keys`). Then point any OpenAI client at Twynn:

```ts
const client = new OpenAI({ baseURL: 'http://localhost:3000/v1', apiKey: 'twynn_sk_…' });
```

Each response carries `X-Twynn-Cache` (`HIT`, `MISS`, `BYPASS`) and `X-Twynn-Cache-Layer` (`exact`, `twin`, `upstream`). Twin hits also carry `X-Twynn-Match-Score`, the cosine similarity to the stored prompt. Twin threshold, TTL, embeddings model and the twin-layer switch are per-workspace settings (`/api/settings`).

Streaming requests are cached too: misses stream straight through and are stored once complete, and hits are replayed as a stream. Send `X-Twynn-Cache-Control: no-cache` to skip the cache for one request (the fresh answer replaces the stored one). Cached entries can be browsed and deleted via `/api/cache`, or invalidated in bulk by model or age via `POST /api/cache/invalidate`.

## Analytics

Every gateway request is recorded with its cache layer, latency, provider-reported token counts and match score. Cost saved is an **estimate** computed from those token counts and the pricing table in `packages/shared/src/pricing.ts` (edit it to match your provider; unpriced models are reported, never counted as free). The dashboard API exposes `/api/analytics/{summary,timeseries,models}`, `/api/requests` and a live stream at `/api/events` (Server-Sent Events).

## Layout

| Path              | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `apps/api`        | Hono gateway and API, Drizzle schema/migrations |
| `apps/web`        | React + Vite frontend                           |
| `packages/shared` | Product constants, vocabulary, shared types     |

Environment variables use the `TWYNN_` prefix and are validated at startup in `apps/api/src/config.ts`; see `.env.example`.

## Third-party assets

The visual identity (logo mark, palette, layouts and copy) is original to Twynn. Fonts and icons are open-licensed and self-hosted:

| Asset                                                                                                             | Use       | License                   |
| ----------------------------------------------------------------------------------------------------------------- | --------- | ------------------------- |
| [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) (via `@fontsource-variable/bricolage-grotesque`) | Headings  | SIL Open Font License 1.1 |
| [Instrument Sans](https://github.com/Instrument/instrument-sans) (via `@fontsource-variable/instrument-sans`)     | Body text | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (via `@fontsource-variable/jetbrains-mono`)          | Code      | SIL Open Font License 1.1 |
| [Lucide](https://lucide.dev) (via `lucide-react`)                                                                 | Icons     | ISC                       |
