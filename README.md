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

## Layout

| Path              | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `apps/api`        | Hono gateway and API, Drizzle schema/migrations |
| `apps/web`        | React + Vite frontend                           |
| `packages/shared` | Product constants, vocabulary, shared types     |

Environment variables use the `TWYNN_` prefix and are validated at startup in `apps/api/src/config.ts`; see `.env.example`.
