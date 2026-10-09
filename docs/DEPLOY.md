# Deploying Twynn

This guide runs Twynn on a single host with Docker Compose: Postgres (with pgvector), Redis, the API and the dashboard. The dashboard container (nginx) also proxies the gateway, so everything is served from one origin.

## What you need

- A Linux host with Docker Engine 24+ and the Compose plugin. 2 vCPU and 4 GB of memory is a comfortable start.
- A domain name pointing at the host, and a TLS-terminating reverse proxy or load balancer in front of it (see [TLS](#tls)). Session cookies are `Secure` in production, so the dashboard must be served over HTTPS.

## 1. Configure

Create `.env.production` next to `docker-compose.prod.yml`. Keep it out of version control.

```sh
POSTGRES_PASSWORD=<long random string>
TWYNN_ENCRYPTION_KEY=<32 random bytes, base64>
TWYNN_PUBLIC_ORIGIN=https://twynn.example.com
TWYNN_HTTP_PORT=8080
```

Generate the secrets:

```sh
openssl rand -hex 24          # POSTGRES_PASSWORD
openssl rand -base64 32       # TWYNN_ENCRYPTION_KEY
```

`TWYNN_PUBLIC_ORIGIN` is the URL people open in a browser, with no trailing slash. It is used as the only origin allowed to make dashboard changes (CSRF protection) and to show the gateway URL (`<origin>/v1`) in onboarding snippets.

Optional settings and their defaults:

| Variable                                 | Default                         | Meaning                                                         |
| ---------------------------------------- | ------------------------------- | --------------------------------------------------------------- |
| `TWYNN_KEY_RATE_LIMIT_PER_MINUTE`        | 600                             | Requests per minute per gateway key (0 disables)                |
| `TWYNN_PLAYGROUND_RATE_LIMIT_PER_MINUTE` | 30                              | Playground requests per minute per workspace                    |
| `TWYNN_DAILY_REQUEST_QUOTA`              | 0                               | Requests per workspace per UTC day (0 means unlimited)          |
| `TWYNN_LOG_RETENTION_DAYS`               | 90                              | Request logs (and evaluation labels) older than this are purged |
| `TWYNN_LOG_LEVEL`                        | info                            | `fatal` … `trace`                                               |
| `TWYNN_RESEND_API_KEY`                   | (unset)                         | Resend API key for verification and password-reset emails       |
| `TWYNN_EMAIL_FROM`                       | `Twynn <onboarding@resend.dev>` | Sender address; its domain must be verified in Resend           |

> **Email.** Without `TWYNN_RESEND_API_KEY`, production sends no email: new users still see the reminder to verify but the email never arrives (they keep full access), and password reset links are never delivered. Create a key at resend.com, verify your sending domain, and set `TWYNN_EMAIL_FROM` to an address on it. Resend's `onboarding@resend.dev` sender only delivers to your own Resend account address, so it is for testing only.

> **Keep `TWYNN_ENCRYPTION_KEY` safe and stable.** It encrypts every workspace's provider key. If it is lost or changed, stored provider keys cannot be decrypted and every workspace must re-enter its provider key.

## 2. Start

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --wait
```

This builds both images, starts Postgres and Redis, runs migrations once (`migrate` exits when done), then starts the API and the dashboard. Check it:

```sh
curl -s http://localhost:8080/health
# {"status":"ok","product":"Twynn","checks":{"postgres":"ok","redis":"ok"}}
```

Open your public origin, create the first account, and follow onboarding.

## TLS

Terminate TLS in front of the `web` container and forward to `TWYNN_HTTP_PORT`. With Caddy, for example:

```
twynn.example.com {
  reverse_proxy localhost:8080
}
```

Requirements for whatever you put in front:

- **Do not buffer responses.** Streamed completions and the live dashboard feed use Server-Sent Events. Caddy streams by default; for nginx use `proxy_buffering off`, and allow long-lived connections (an hour is enough).
- **Client addresses.** The web container overwrites `X-Forwarded-For` with the address it sees, and the API trusts that header (`TWYNN_TRUST_PROXY=true` in the compose file). Behind another proxy, the address the API sees is that proxy's, so sign-in limits apply per proxy rather than per client. If your proxy is trusted, change `proxy_set_header X-Forwarded-For` in `apps/web/nginx/default.conf.template` to `$proxy_add_x_forwarded_for` and make sure the outer proxy strips client-supplied values.
- **Body size.** Allow request bodies of at least 5 MB.

## Upgrading

```sh
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --wait
```

Migrations run automatically before the new API starts. The API shuts down gracefully on `SIGTERM`: it stops accepting connections, ends open event streams, and writes pending request logs (up to `TWYNN_SHUTDOWN_TIMEOUT_MS`, 10 s by default; Compose waits 15 s).

## Backups

Postgres holds everything that matters: accounts, keys, encrypted provider keys, settings, the cache catalogue (including twin embeddings) and request logs. Back it up regularly:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_dump -U twynn -Fc twynn > twynn-$(date +%F).dump
```

Restore into a fresh volume with `pg_restore -U twynn -d twynn --clean`. Redis holds only the exact-cache copies and rate-limit counters; losing it costs some exact hits until answers are re-stored, nothing more. Back up `.env.production` (above all the encryption key) separately.

## Operations

- **Logs**: the API writes JSON logs to stdout (`docker compose logs -f api`). Secrets and cookies are redacted.
- **Health**: `GET /health` reports `postgres` and `redis`; it returns 503 when either is down. Both containers have Docker healthchecks.
- **Housekeeping**: every 10 minutes the API deletes expired cache entries and request logs past retention.
- **Scaling**: the API is stateless apart from Postgres and Redis, so you can run several `api` replicas behind the web container. Rate limits, the exact cache and live events all go through Redis, so they stay consistent across replicas.
- **Resource use**: twin search uses pgvector HNSW indexes. Memory grows with the number of cached entries (about 6 KB per 1536-dimension embedding plus index overhead); expiry keeps it bounded.

## Running without Compose

The images can run on any container platform:

- `twynn-api` (`apps/api/Dockerfile`): needs `TWYNN_DB_URL`, `TWYNN_REDIS_URL`, `TWYNN_ENCRYPTION_KEY`, `TWYNN_WEB_ORIGIN`, `TWYNN_PUBLIC_GATEWAY_URL`, `NODE_ENV=production`. Run `node dist/db/migrate.js` once per release before starting it. Listens on 3000.
- `twynn-web` (`apps/web/Dockerfile`): set `TWYNN_API_UPSTREAM` to the API's address (default `http://api:3000`). Listens on 80.

Postgres must have the `vector` extension available (pgvector 0.8 or later); the first migration enables it.
