# CM FIM System — multi-stage Dockerfile.
#
# Two runtime images come out of this file: `web` (the Next.js app) and
# `worker` (the BullMQ worker process). Build each with:
#   docker build --target web -t cm-fim-web .
#   docker build --target worker -t cm-fim-worker .
# docker-compose.yml does this automatically.

FROM node:22-alpine AS base
# Prisma's CLI (schema-engine, used by `generate`/`migrate`) needs libssl.
# The query engine itself is NOT used at runtime here — we use the `pg`
# driver adapter (@prisma/adapter-pg), which talks to Postgres directly, so
# there's no Rust query-engine binary to worry about at request time.
RUN apk add --no-cache libc6-compat openssl

# ---- deps: install once, reused by later stages ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compiles the Next.js app and generates the Prisma client ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholder only: `prisma generate` needs a syntactically valid
# DATABASE_URL but never opens a connection. The real value is supplied to
# the containers at runtime via docker-compose/.env.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
RUN npx prisma generate
RUN npm run build

# ---- web: minimal Next.js standalone runtime ----
FROM base AS web
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]

# ---- worker: BullMQ worker process ----
# Runs the worker's TypeScript directly via tsx rather than adding a second
# bundling pipeline — the worker is I/O-bound background job processing,
# not a hot path, so the startup-time transpile cost is a fine trade-off for
# not maintaining a separate build step. Revisit if worker cold-start time
# ever actually matters.
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
CMD ["npx", "tsx", "workers/index.ts"]
