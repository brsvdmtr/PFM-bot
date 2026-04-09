# syntax=docker/dockerfile:1.7

# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# 1) Copy ONLY manifests first so the install layer is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

# 2) Install full dep tree (dev + prod) with a persistent pnpm store cache.
#    This layer is only invalidated when a package.json / lockfile changes.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 3) Copy Prisma schema so `prisma generate` can run from a cache-friendly step.
COPY packages/db/prisma packages/db/prisma
RUN pnpm --filter @pfm/db generate

# 4) Copy sources only for the packages we actually build here.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db/src packages/db/src
COPY packages/db/tsconfig.json packages/db/
COPY apps/api apps/api

RUN pnpm --filter @pfm/shared build \
 && pnpm --filter @pfm/db build \
 && pnpm --filter @pfm/api build

# 5) pnpm deploy produces a self-contained production tree at /prod/api:
#    only runtime deps (no dev deps, no other workspaces).
RUN pnpm --filter @pfm/api --prod --legacy deploy /prod/api

# 6) Copy Prisma schema + migrations into the deployed tree and regenerate
#    the client so its engines live next to the runtime @prisma/client.
RUN cp -r packages/db/prisma /prod/api/prisma \
 && cd /prod/api \
 && npx prisma generate --schema=./prisma/schema.prisma

# ── Runner stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy the slim deployed tree: package.json, dist/, node_modules/ (prod only)
COPY --from=builder /prod/api ./

EXPOSE 3002

CMD ["sh", "-c", "node_modules/.bin/prisma db push --schema=./prisma/schema.prisma --accept-data-loss && node dist/index.js"]
