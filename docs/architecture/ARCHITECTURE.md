---
title: "PFM-bot Architecture Overview"
document_type: Normative
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - path: ../system/system-spec-v1.md
    relation: "see also"
  - path: ../system/formulas-and-calculation-policy.md
    relation: "canonical formula reference"
---

# PFM-bot Architecture Overview

## 1. Overview

PFM-bot is a personal finance manager delivered as a Telegram Mini App. The core product is a single daily number — **S2S (Safe to Spend)** — that tells the user how much they can spend today while still covering all obligations, accelerating debt repayment, and building an emergency fund.

**Production status**: Live at [mytodaylimit.ru](https://mytodaylimit.ru) since early 2026. Single-tenant deployment on Timeweb VPS (147.45.213.51).

**Target users**: Russian-speaking users carrying debt who want a concrete daily spending limit, not abstract category budgets.

---

## 2. Monorepo Structure

```
PFM-bot/
├── apps/
│   ├── api/          Express API, port 3002
│   ├── bot/          Telegraf bot
│   └── web/          Next.js 14 mini-app, port 3003
├── packages/
│   ├── db/           Prisma client + schema
│   └── shared/       Shared types/utilities
├── docs/
│   ├── architecture/ ADRs + this file
│   ├── system/       Calculation specs
│   ├── api/          API reference
│   ├── product/      Product docs
│   ├── ops/          Operations runbooks
│   ├── security/     Security docs
│   └── delivery/     Templates
└── docker-compose.yml
```

All packages share a single `pnpm-workspace.yaml`. `packages/db` is imported directly by both `apps/api` and `apps/bot`, meaning there is no API contract drift between the schema and business logic.

---

## 3. Services

| Service | Technology | Port | Role |
|---------|-----------|------|------|
| api | Express.js + TypeScript + Prisma | 3002 | REST API for mini-app and bot |
| bot | Telegraf.js (long polling) | — | /start, chat ID capture, Telegram Stars payment webhooks |
| web | Next.js 14 standalone mode | 3003 | Telegram Mini App UI |
| db | PostgreSQL 15 | 5432 | Primary datastore |
| nginx | Nginx reverse proxy | 80/443 | TLS termination, routing |

**nginx routing:**
- `mytodaylimit.ru` → `web:3003`
- `mytodaylimit.ru/api/` (or `api.mytodaylimit.ru`) → `api:3002`
- Internal routes (`/internal/*`) are not proxied externally

---

## 4. Request Flow

```
User opens Telegram Mini App
    │
    ▼
apps/web (Next.js 14)
    │  calls /tg/* with header:
    │  X-TG-Init-Data: <telegram initData>
    ▼
apps/api (Express)
    │  1. validateTelegramInitData()
    │     → HMAC-SHA256 signature check
    │     → auth_date freshness check (< 1 hour)
    │  2. ensureUser() — upsert User row
    │  3. Business logic / engine
    ▼
packages/db (Prisma → PostgreSQL)
    │
    ▼
JSON response → apps/web → Telegram WebView
```

---

## 5. Authentication

All requests to `/tg/*` require a valid Telegram `initData` string in the `X-TG-Init-Data` header. Verification:

1. **Signature**: HMAC-SHA256 of sorted query params, using `secret = HMAC("WebAppData", BOT_TOKEN)`
2. **Freshness**: `Date.now()/1000 - auth_date < 3600` (1-hour window)

**Dev bypass**: In `NODE_ENV !== 'production'`, the `X-TG-Dev` header with a plain Telegram user ID skips initData validation. The production Dockerfile sets `NODE_ENV=production`, making this path unreachable in production.

**Internal routes**: `/internal/*` routes (called only by `apps/bot`) use `X-Internal-Key` checked against the `ADMIN_KEY` environment variable. These routes are not exposed externally through nginx.

**CORS**: In production, restricted to `https://mytodaylimit.ru`. In development, `cors()` allows all origins.

See [adr-005-auth-strategy.md](./adr-005-auth-strategy.md) for full rationale and implementation details.

---

## 6. Core Domain Logic

### 6.1 Key concepts

- **S2S** = Safe to Spend — the daily spending limit
- **Period** = time between consecutive paydays (not a calendar month)
- **Minor units** = all monetary values stored as `Int` (kopecks for RUB, cents for USD)

### 6.2 S2S Formula (summary)

```
afterFixed    = income - obligations - debtMinPayments
reserve       = afterFixed × 10%  (reduced to 5% or 0% if budget is tight)
freePool      = afterFixed - reserve
efContrib     = min(efDeficit/12, freePool × 20%)  [if EF target not met]
avalanchePool = investPool × 30-50%  [depending on EF status and APR]

s2sPeriod = income - obligations - debtMinPayments - reserve - efContrib - avalanchePool
s2sDaily  = (s2sPeriod - totalSpentThisPeriod) / daysLeft
```

Carry-over is automatic: underspending increases tomorrow's limit; overspending reduces it. The daily limit is never "reset" to a fixed amount.

Canonical formula reference: [../system/formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md)

### 6.3 Multi-payday income

For users with two paydays (e.g., `[1, 15]`), the engine determines which payday "triggered" the current period and counts only the income matching that payday. This prevents double-counting income sources across sub-periods.

### 6.4 Period status

| Status | Condition |
|--------|-----------|
| `ACTIVE` | Current open period |
| `COMPLETED` | Period ended, rolled over |
| `DEFICIT` | `residual < 0` — obligations exceed income |

---

## 7. Cron Jobs (in apps/api)

| Schedule | Job | Description |
|----------|-----|-------------|
| Every minute | Notification dispatch | Checks each user's local time; fires morning/evening notifications |
| `55 23 * * *` (23:55 UTC) | DailySnapshot | Saves today's S2S snapshot for history |
| `5 0 * * *` (00:05 UTC) | Period rollover | Marks expired periods COMPLETED, creates new periods |
| `0 9 * * *` (09:00 UTC) | Payment alerts | Alerts for obligations/debts due tomorrow |

Cron jobs are implemented as HTTP calls to `/internal/cron/*` from within the API process itself, scheduled via `node-cron`.

---

## 8. Infrastructure (Production)

| Component | Detail |
|-----------|--------|
| VPS | Timeweb, IP 147.45.213.51 |
| Orchestration | Docker Compose (`docker-compose.yml`) |
| TLS | Let's Encrypt via nginx certbot |
| Backups | `pg_dump` via cron on host, stored locally |
| Monitoring | None (planned) |

All four services (api, bot, web, db) run in a single Docker Compose stack on the same machine. The nginx container terminates TLS and proxies to the service containers over the `pfm-network` Docker bridge.

---

## 9. Known Architecture Limitations

These are documented honestly for future reference:

1. **Notification dedup is in-memory**: The `notifLog` Map is cleared on API process restart. A restart at exactly 09:00 local time could send duplicate morning notifications. A `NotificationLog` DB table would fix this.

2. **Period rollover at 00:05 UTC, not user's local midnight**: For a Vladivostok user (UTC+10), rollover happens at 10:05 AM local time. Expenses between midnight and 10:05 AM on payday day land in the old period.

3. **"Today's expenses" uses UTC midnight**: A Moscow user's app-day starts at 03:00 AM Moscow time, not midnight. Late-night expenses appear as "yesterday."

4. **No rate limiting on the API**: All authenticated `/tg/*` endpoints are rate-limit-free. A misbehaving client can flood the API.

5. **No structured logging or distributed tracing**: Errors are logged to stdout (`console.error`). No Sentry, no structured JSON logs, no request IDs.

6. **Single-node, no horizontal scaling**: One VPS failure takes down all services. No load balancer, no replica.

7. **PostgreSQL `Int` ceiling**: 32-bit signed Int caps at ~21 million rubles. Mortgage balances over 21M ₽ would overflow. Large debts may need `BigInt`.

8. **Bot uses X-TG-Dev for internal API calls**: `apps/bot` bypasses initData verification when calling the API. Should use an internal service account instead.

---

## 10. ADR Index

All architectural decisions are recorded in this directory:

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](./adr-001-monolith-web-first.md) | Monorepo Monolith, Web-First via Telegram Mini App | Accepted |
| [ADR-002](./adr-002-money-in-minor-units.md) | All Monetary Values Stored as Int in Minor Units | Accepted |
| [ADR-003](./adr-003-s2s-formula.md) | Safe-to-Spend (S2S) Formula | Accepted |
| [ADR-004](./adr-004-debt-avalanche.md) | Debt Repayment via Avalanche Method | Accepted |
| [ADR-005](./adr-005-auth-strategy.md) | Authentication via Telegram initData HMAC-SHA256 | Accepted |
| [ADR-006](./adr-006-idempotent-expense-model.md) | Immutable Expense Model | Accepted |
| [ADR-007](./adr-007-timezone-and-period-boundaries.md) | Timezone Handling and Period Boundary Strategy | Accepted |

---

## 11. Related Docs

- [../system/system-spec-v1.md](../system/system-spec-v1.md) — Full system specification
- [../system/formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md) — Canonical formula definitions (source of truth for calculations)
- [../api/](../api/) — API endpoint reference
- [../ops/](../ops/) — Operations runbooks (deploy, backup, rollback)
