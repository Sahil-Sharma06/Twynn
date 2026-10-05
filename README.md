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

## Layout

| Path              | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `apps/api`        | Hono gateway and API, Drizzle schema/migrations |
| `apps/web`        | React + Vite frontend                           |
| `packages/shared` | Product constants, vocabulary, shared types     |

Environment variables use the `TWYNN_` prefix and are validated at startup in `apps/api/src/config.ts`; see `.env.example`.
