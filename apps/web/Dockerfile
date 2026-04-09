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

# 2) Build-time public URL baked into the Next.js bundle.
ARG NEXT_PUBLIC_API_URL=https://mytodaylimit.ru/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# 3) Sources for shared + web.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# 4) Persistent Next.js build cache between deploys.
RUN --mount=type=cache,id=next-cache,target=/app/apps/web/.next/cache \
    pnpm --filter @pfm/shared build \
 && pnpm --filter @pfm/web build

# ── Runner stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3003

# Copy standalone server + static assets (Next.js "standalone" output).
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3003

CMD ["node", "apps/web/server.js"]
