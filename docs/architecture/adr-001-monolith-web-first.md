---
title: "ADR-001: Monorepo Monolith, Web-First via Telegram Mini App"
document_type: ADR
status: Accepted
source_of_truth: NO
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./ARCHITECTURE.md
    relation: "parent document"
---

# ADR-001: Monorepo Monolith, Web-First via Telegram Mini App

## Status

Accepted

## Context

PFM Bot is a personal finance manager delivered inside Telegram. At the start of the project, several structural options existed:

- **Native mobile app** (iOS/Android): Requires App Store/Play Store distribution, separate build pipeline, review delays.
- **Separate microservices**: Isolates concerns but adds infrastructure overhead (multiple deploy targets, inter-service networking, auth propagation).
- **Standalone web SPA**: Viable, but would require separate user acquisition and auth flows outside Telegram.
- **Telegram Mini App (TMA)**: Runs inside Telegram's WebView. Distribution is instant — the bot itself is the install step. Auth is built in via `initData`.

The target audience (Russian-speaking users) is already inside Telegram. Acquiring them outside Telegram requires marketing spend and separate onboarding.

## Decision

Build as a **pnpm monorepo** with a monolith-style multi-service setup, web-first:

- `apps/web` — Next.js 14 frontend, deployed as a Telegram Mini App at `https://mytodaylimit.ru`
- `apps/api` — Express backend with all business logic (port 3002 internally)
- `apps/bot` — Telegraf bot process for Telegram commands and payment handling (long polling)
- `packages/db` — Prisma schema and generated client, shared across services
- `packages/shared` — TypeScript types shared across packages

All services share the same Docker Compose file and deploy to a single Timeweb VPS (147.45.213.51) with nginx reverse proxy.

The bot (`apps/bot`) was not eliminated: it handles `/start` (registers the user's `telegramChatId` for notification delivery), payment webhooks (Telegram Stars), and quick commands (`/today`, `/spend`). The web frontend is the primary UI; the bot is a supplementary channel.

## Consequences

### Positive

- **Zero distribution friction**: Users open the Mini App directly from the Telegram chat. No app stores.
- **Auth is free**: Telegram's `initData` HMAC-SHA256 replaces traditional auth entirely (see ADR-005).
- **Single deploy unit**: One `docker compose up` brings up the full stack. No inter-service networking outside the Docker bridge.
- **Shared types**: `packages/shared` and `packages/db` are imported directly in both `api` and `web` — no API contract drift.
- **Fast iteration**: Business logic changes in `apps/api/src/engine.ts` are immediately testable without touching mobile builds.

### Negative / Trade-offs

- **Telegram dependency**: The app is unusable outside Telegram. If Telegram changes TMA APIs, the UI breaks.
- **No offline support**: Telegram WebView has no service worker support for offline operation.
- **Mobile WebView limitations**: No native gestures, no deep-link routing outside Telegram, no push notifications independent of Telegram.
- **Single VPS is a SPOF**: The monolith deployment has no horizontal scaling. A VPS failure takes down all services simultaneously.
- **Long-polling bot**: `apps/bot` uses Telegraf long polling (not webhooks), which keeps an idle connection open. Restarts lose pending updates unless `dropPendingUpdates: true` is set (it is).

## Implementation Status

Implemented and in production at mytodaylimit.ru.

All four services (api, bot, web, db) run in Docker Compose on the Timeweb VPS. The web app is the primary interface; the bot handles `/start` for chat ID registration and processes Telegram Stars payment events.

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — deployment and infrastructure overview
- [ADR-005](./adr-005-auth-strategy.md) — Telegram initData auth strategy
