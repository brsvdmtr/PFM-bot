# syntax=docker/dockerfile:1.7

# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# 1) Manifests first for cache-friendly install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 2) Sources just for what bot actually needs to build.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/bot apps/bot

RUN pnpm --filter @pfm/shared build \
 && pnpm --filter @pfm/bot build

# 3) Slim production tree: only runtime deps for the bot workspace.
RUN pnpm --filter @pfm/bot --prod --legacy deploy /prod/bot

# ── Runner stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /prod/bot ./

CMD ["node", "dist/index.js"]
