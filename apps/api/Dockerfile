# Twynn API. Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace @twynn/api --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace @twynn/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# Production dependencies of the API only; @twynn/shared is bundled into the build.
# PGlite (tests only) and type packages arrive as optional peers of drizzle-orm; drop them.
# (--omit=optional would also drop argon2's native binary.)
RUN npm ci --omit=dev --workspace @twynn/api \
  && rm -rf node_modules/@electric-sql node_modules/@types \
  && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1
# Migrations run as a separate one-off command: node dist/db/migrate.js
CMD ["node", "dist/index.js"]
