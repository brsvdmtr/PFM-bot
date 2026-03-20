# PFM Bot — System Specification v1

> Last updated: 2026-03-20
> Stack: pnpm monorepo · Express · Telegraf · Next.js 14 · PostgreSQL + Prisma · Docker Compose

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Service Descriptions](#2-service-descriptions)
3. [API Module Breakdown](#3-api-module-breakdown)
4. [Data Flows](#4-data-flows)
5. [Auth Flow](#5-auth-flow)
6. [Environment Variables](#6-environment-variables)
7. [Deployment Topology](#7-deployment-topology)
8. [Known Limitations and TODOs](#8-known-limitations-and-todos)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  External                                                           │
│                                                                     │
│   Telegram App ──────────────────────────────────────────────────► │
│   (sends initData                                           Bot     │
│    in Mini App                                          (Telegraf)  │
│    header)          ┌──────── Nginx (443/80) ──────────┐           │
│                     │  mytodaylimit.ru                 │           │
│   Browser / TMA ──► │  /miniapp  → :3003 (Next.js)    │           │
│                     │  /api/*    → :3002 (Express API) │           │
│                     │  /_next/   → :3003               │           │
│                     └─────────────┬───────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┴──────────────────────┐
              │                                            │
              ▼                                            ▼
     ┌─────────────────┐                        ┌──────────────────┐
     │   API (Express) │                        │   Web (Next.js)  │
     │   port 3002     │                        │   port 3003      │
     │                 │◄──── internal HTTP ────│  (Mini App UI)   │
     │  routes/        │     (X-TG-INIT-DATA    └──────────────────┘
     │  engine.ts      │      in headers)
     │  avalanche.ts   │
     │  cron.ts        │
     │  notify.ts      │
     └────────┬────────┘
              │ Prisma Client
              ▼
     ┌─────────────────┐
     │  PostgreSQL 16  │
     │  (Docker vol.)  │
     │  pfm_pg_data    │
     └─────────────────┘

              ▲
              │ HTTP (internal only — X-Internal-Key)
     ┌─────────────────┐
     │   Bot (Telegraf)│
     │   (no port)     │
     │  Webhook / Poll │
     └─────────────────┘
```

**Request path — Mini App user:**

```
User opens TMA in Telegram
  → Telegram injects window.Telegram.WebApp.initData
  → Next.js frontend reads initData, attaches as X-TG-INIT-DATA header
  → Nginx receives HTTPS request at /api/*
  → Nginx rewrites: strips /api prefix, proxies to :3002
  → Express API validates HMAC-SHA256 on initData
  → Handler queries PostgreSQL via Prisma
  → JSON response
```

**Request path — Bot → API (internal):**

```
Telegram sends update to Bot
  → Bot identifies telegramId / chatId
  → Bot calls POST /internal/store-chat-id with X-Internal-Key: $ADMIN_KEY
  → API stores telegramChatId on User record
  → Cron can now send push notifications to that chatId
```

---

## 2. Service Descriptions

### 2.1 api (`apps/api`)

Express 4 HTTP server. Entry point: `src/index.ts`.

- Listens on `API_PORT` (default `3002`).
- Exposes `/tg/*` routes (Telegram Mini App auth) and `/internal/*` routes (bot-to-API, internal key auth).
- Launches cron jobs after startup via dynamic `import('./cron')`.
- Sends Telegram push notifications directly via Bot API (does not use Telegraf).
- All money arithmetic uses integer minor units (kopecks for RUB, cents for USD). Values are `Math.round()`-ed at entry points.

### 2.2 bot (`apps/bot`)

Telegraf bot. Handles incoming Telegram updates (webhook or long poll, depending on environment). Responsible for:

- Onboarding conversation flow via Telegram chat.
- Storing `telegramChatId` by calling `POST /internal/store-chat-id`.
- Activating PRO subscriptions after Telegram Stars payment confirmation via `POST /internal/activate-subscription`.

<!-- TODO: verify bot entry point and handler list -->

### 2.3 web (`apps/web`)

Next.js 14 (App Router). Serves the Telegram Mini App UI at `/miniapp`.

- Communicates with the API exclusively via `NEXT_PUBLIC_API_URL` (baked in at build time).
- All API calls attach `X-TG-INIT-DATA: window.Telegram.WebApp.initData` header.
- Port 3003 internally; Nginx proxies `/miniapp` and `/_next/` to it.

### 2.4 postgres

PostgreSQL 16 Alpine in Docker. Persists data in named volume `pfm_pg_data`. Schema managed by Prisma (`packages/db/prisma/schema.prisma`). Access via `DATABASE_URL` env var.

---

## 3. API Module Breakdown

### `src/index.ts` — Application bootstrap + route handlers

Contains all Express route handlers inline (not split into files). Responsibilities:

- Telegram HMAC auth middleware (`tgAuth`)
- Dev bypass middleware (only active when `NODE_ENV !== 'production'`)
- `ensureUser` middleware: upserts User record on first request, sets `req.userId`
- All `/tg/*` route handlers
- All `/internal/*` route handlers
- Starts cron after listen

### `src/engine.ts` — S2S calculation engine

Pure functions, no DB access, no side effects.

**`calculatePeriodBounds(paydays, fromDate)`**

Determines `startDate`, `endDate`, `daysTotal`, `fullPeriodDays`, and `isProratedStart` for a period given sorted payday array and a reference date.

- 1 payday: monthly period from payday to next month's same day
- 2 paydays `[a, b]`: half-month periods — `a→b` and `b→a(next month)`
- 3+ paydays: falls back to monthly from `fromDate` (rare/unsupported case)
- `isProratedStart = true` when `fromDate` is not exactly on a payday (mid-period start during onboarding)

**`calculateS2S(input)`**

Computes the full Safe-to-Spend breakdown for a period. Returns `S2SResult`.

Steps (in order):
1. Determine `triggerPayday`: the payday that opened this period (previous payday before `endDate.getDate()` in sorted allPaydays list)
2. Sum income: only incomes whose `paydays` array includes `triggerPayday`; divide by `paydays.length` for multi-payday single records
3. Prorate `totalObligations` and `totalDebtPayments` if `isProratedStart`
4. Calculate EF deficit: `target = monthlyObligations × targetMonths`
5. Calculate `reserve` at 10%; fall back to 5% or 0 if `afterFixed` is negative
6. Calculate `efContribution`: `min(efDeficit/12, freePool×0.20, efDeficit)`
7. Calculate `avalanchePool` based on APR tier and EF funding status (see S2S formula below)
8. `s2sPeriod = max(0, totalIncome - obligations - debtPayments - reserve - efContribution - avalanchePool)`
9. `s2sDaily = round((s2sPeriod - totalExpensesInPeriod) / daysLeft)` — carry-over on every recalculation
10. `s2sToday = max(0, s2sDaily - todayExpenses)`

**S2S formula reference:**

```
triggerPayday = prev payday before endDate.getDate() in sorted allPaydays

totalIncome = Σ incomes where paydays.includes(triggerPayday)
              each income: amount / paydays.length

afterFixed = totalIncome - prorated(obligations) - prorated(minPayments)

reserveRate = 10%  →  fallback 5%  →  fallback 0% (if afterFixed ≤ 0)
reserve = round(afterFixed × reserveRate)

freePool = max(0, afterFixed - reserve)

efContribution = min(efDeficit/12, freePool×0.20, efDeficit)   [if efDeficit > 0]

investPool = freePool - efContribution

avalanchePool:
  if focusDebt && APR ≥ 18% && EF funded:  investPool × 0.50
  if focusDebt && APR ≥ 18% && EF deficit: investPool × 0.30
  if focusDebt && APR <  18%:               investPool × 0.25
  capped at focusDebt.balance

s2sPeriod = max(0, afterFixed - reserve - efContribution - avalanchePool)

s2sDaily  = round((s2sPeriod - totalExpensesInPeriod) / daysLeft)   [carry-over]
s2sToday  = max(0, s2sDaily - todayExpenses)
```

### `src/avalanche.ts` — Debt avalanche strategy

**`determineFocusDebt(debts)`**

Returns ID of the debt that should receive extra payments. Sort order: highest APR first; on tie, smallest balance first.

**`buildAvalanchePlan(debts, monthlyExtra)`**

Simulates month-by-month payoff for all debts in avalanche order. Returns `AvalanchePlan` with per-debt `estimatedMonths`, `totalInterest`, and aggregate `estimatedDebtFreeMonths` (sequential sum, simplified), `estimatedTotalInterest`, `totalDebt`, `totalMinPayments`.

### `src/cron.ts` — Scheduled jobs

All four jobs start when `cron.ts` is imported after API listen.

| Schedule | Job | Description |
|---|---|---|
| `* * * * *` | Notification dispatcher | Iterates all users with `telegramChatId` and `onboardingDone`. For each user, checks local time (via `Intl.DateTimeFormat`) against `morningNotifyTime` / `eveningNotifyTime`. Fires at exact minute match. In-memory dedup (`notifLog` Map) prevents double-send within same UTC day. |
| `55 23 * * *` | Daily snapshot | Upserts a `DailySnapshot` record for every active period capturing `s2sPlanned`, `s2sActual`, `totalExpenses`, `isOverspent`. |
| `0 9 * * *` | Debt payment alerts | Finds debts with `dueDay` equal to today or tomorrow; sends `sendPaymentAlert`. Deduped per payment per day. |
| `5 0 * * *` | Period rollover | Finds active periods where `endDate <= today`. Marks each COMPLETED, creates new ACTIVE period by recalculating bounds + S2S, sends `sendNewPeriodNotification`. |

### `src/notify.ts` — Push notification senders

Sends messages via `https://api.telegram.org/bot{BOT_TOKEN}/sendMessage`. All messages are in Russian, use Markdown parse mode, and include an inline keyboard button opening the Mini App (`MINI_APP_URL`).

Functions: `sendMorningNotification`, `sendEveningNotification`, `sendPaymentAlert`, `sendNewPeriodNotification`, `sendDeficitAlert`.

---

## 4. Data Flows

### 4.1 User adds an expense (end-to-end)

```
1. User taps "Add expense" in Mini App
2. Mini App calls POST https://mytodaylimit.ru/api/tg/expenses
   Headers: X-TG-INIT-DATA: <telegram initData>
   Body: { amount: 15000, note: "Coffee" }   ← kopecks

3. Nginx receives POST /api/tg/expenses
   → rewrites to /tg/expenses, proxies to :3002

4. API: tgAuth middleware
   → reads X-TG-INIT-DATA header
   → validates HMAC-SHA256 against BOT_TOKEN
   → parses user JSON from "user" param
   → sets req.tgUser

5. API: ensureUser middleware
   → finds or creates User record (telegramId = String(tgUser.id))
   → sets req.userId

6. API: POST /tg/expenses handler
   → validates amount > 0
   → finds active Period for userId
   → creates Expense: { userId, periodId, amount: round(15000), note: "Coffee", currency }

7. Returns 201 { id, userId, periodId, amount: 15000, note, spentAt, currency, source }

8. Mini App receives response
   → re-fetches GET /tg/dashboard to get updated s2sToday
   → dashboard recalculates: s2sDaily = round((s2sPeriod - totalSpent) / daysLeft)
```

### 4.2 Cron period rollover (end-to-end)

```
1. Cron job `5 0 * * *` fires

2. Query: periods WHERE status=ACTIVE AND endDate <= today
   → for each expired period, load user + incomes + obligations + debts + emergencyFund

3. For each expired period:
   a. Aggregate totalSpent for period (expense SUM)
   b. UPDATE period SET status = COMPLETED
   c. calculatePeriodBounds(incomes[0].paydays, now)
      → new start/end dates
   d. calculateS2S({ all current incomes, obligations, debts, ef, new bounds, totalExpenses=0 })
      → new s2sPeriod, s2sDaily, breakdown
   e. INSERT new Period (status=ACTIVE)
   f. If user has telegramChatId:
      → sendNewPeriodNotification(chatId, s2sDaily, daysTotal, currency, prevSaved)
      → Bot API POST /sendMessage with inline keyboard

4. Next morning notification will use the new period's s2sPeriod
```

---

## 5. Auth Flow

### 5.1 Telegram Mini App auth (X-TG-INIT-DATA)

Telegram injects `initData` as a URL-encoded query string into the Mini App. The web frontend reads `window.Telegram.WebApp.initData` and sends it as the `X-TG-INIT-DATA` request header on every API call.

The API validates it as follows:

```
1. Parse initData as URLSearchParams
2. Extract and remove the "hash" param
3. Sort remaining params alphabetically
4. Build data-check-string: "key=value\nkey=value\n..."
5. secretKey = HMAC-SHA256("WebAppData", BOT_TOKEN)
6. computed  = HMAC-SHA256(secretKey, dataCheckString).hexdigest()
7. If computed !== hash → 401 Unauthorized
8. Parse "user" param as JSON → TelegramUser { id, first_name, last_name?, username?, language_code? }
```

Reference: [Telegram Mini App docs — validating data](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)

### 5.2 Dev bypass (X-TG-DEV)

Only active when `NODE_ENV !== 'production'`. Sending `X-TG-DEV: <telegramId>` skips HMAC validation and creates a synthetic `TelegramUser { id, first_name: "Dev" }`. This header is ignored in production.

### 5.3 Internal auth (X-Internal-Key)

Applied to all `/internal/*` routes. The `X-Internal-Key` header must equal the `ADMIN_KEY` environment variable exactly. Returns 401 if missing or wrong. Used by the bot process to call `store-chat-id` and `activate-subscription`.

---

## 6. Environment Variables

| Name | Service(s) | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | api, db migrations | Yes | PostgreSQL connection string, e.g. `postgresql://user:pass@postgres:5432/pfm` |
| `BOT_TOKEN` | api, bot | Yes | Telegram Bot API token from @BotFather. Used for HMAC auth validation and sending notifications. |
| `ADMIN_KEY` | api, bot | Yes | Secret key for internal route auth (`X-Internal-Key`). |
| `API_PORT` | api | No | Port for Express server. Default: `3002`. |
| `MINI_APP_URL` | api | No | URL of the Mini App, appended to notification inline keyboards. Default: `https://localhost:3003/miniapp`. |
| `NEXT_PUBLIC_API_URL` | web | Yes | Base URL for API calls from Next.js frontend. Baked in at Docker build time. Example: `https://mytodaylimit.ru/api`. |
| `NODE_ENV` | api | No | Set to `production` to disable X-TG-DEV bypass. |
| `GOD_MODE_TELEGRAM_IDS` | api | No | Comma-separated Telegram IDs that receive `godMode: true` and are treated as PRO without subscription. |
| `POSTGRES_USER` | postgres | Yes | PostgreSQL username (used in Docker Compose). |
| `POSTGRES_PASSWORD` | postgres | Yes | PostgreSQL password. |
| `POSTGRES_DB` | postgres | Yes | PostgreSQL database name. |

---

## 7. Deployment Topology

### 7.1 Server

- **Provider**: Timeweb Cloud (VDS)
- **IP**: 147.45.213.51
- **OS**: Ubuntu
- **Domain**: mytodaylimit.ru

### 7.2 Docker Compose (`docker-compose.prod.yml`)

Four services on a shared bridge network `pfm-network`:

```
┌─────────────────────────────────┐
│  pfm-network (bridge)           │
│                                 │
│  postgres:5432  (healthcheck)   │
│  api:3002       (→ host :3002)  │
│  web:3000       (→ host :3003)  │
│  bot            (no port)       │
└─────────────────────────────────┘
```

- `api` and `bot` depend on `postgres` (condition: service_healthy)
- `web` depends on `api`
- All services share `.env` file
- PostgreSQL data is in named volume `pfm_pg_data`

### 7.3 Nginx (`nginx/pfm.conf`)

- HTTP (port 80): redirects all traffic to HTTPS; handles Let's Encrypt ACME challenge at `/.well-known/acme-challenge/`
- HTTPS (port 443): TLS 1.2/1.3, cert from Certbot at `/etc/letsencrypt/live/mytodaylimit.ru/`

| Location | Proxy target | Notes |
|---|---|---|
| `/miniapp` | `http://127.0.0.1:3003` | WebSocket upgrade headers set |
| `/_next/` | `http://127.0.0.1:3003` | Next.js static assets |
| `/api/` | `http://127.0.0.1:3002` | Rewrite strips `/api` prefix: `/api/tg/dashboard` → `/tg/dashboard` |
| `= /` | redirect 301 `/miniapp` | Root redirects to Mini App |

### 7.4 SSL / Certbot

Certificates managed by Certbot. Renewal handled via ACME challenge through Nginx `/.well-known/` location. Cert path: `/etc/letsencrypt/live/mytodaylimit.ru/fullchain.pem`.

### 7.5 Deploy script

`deploy.sh` in project root handles: pull, build Docker images, run migrations, restart containers.

<!-- TODO: verify exact deploy.sh steps -->

---

## 8. Known Limitations and TODOs

### Correctness

- **Period rollover uses `incomes[0].paydays`** (`cron.ts:311`): when a user has multiple income records, only the first income's paydays are used to calculate new period bounds during rollover. The onboarding and recalculate endpoints correctly merge all paydays via `flatMap`. This is a bug.
- **`daysLeft` calculation uses UTC midnight**, not user's timezone. A user in UTC+3 who adds an expense at 23:30 local time (20:30 UTC) will see their `daysLeft` count down at midnight UTC, not midnight local.
- **Notification dedup is in-memory**: the `notifLog` Map in `cron.ts` is reset on process restart. If the API restarts at 09:00, morning notifications may be sent twice.

### Features not yet implemented

- Weekly digest notification (`weeklyDigest` setting exists in DB but no cron handler sends it)
- `sendDeficitAlert` function exists in `notify.ts` but is never called by any cron job
- Expense import (`source: IMPORT` enum value exists in schema but no import route)
- Multi-currency support: schema supports `USD`; `primaryCurrency` is stored, but S2S engine does not convert between currencies
- `UserProfile.avatarUrl` field exists but no endpoint to set it
- Subscription cancellation / `cancelAtPeriodEnd` logic not implemented in routes
- `DEFICIT` PeriodStatus enum value exists but periods are never set to DEFICIT status (they roll over or stay ACTIVE)

### Infrastructure

- No health-check alerting; `/health/deep` is not monitored externally
- No database backup automation
- Nginx config does not set `client_max_body_size`; default (1MB) applies
- `X-TG-INIT-DATA` validation does not check the `auth_date` timestamp; theoretically allows replaying old initData indefinitely
