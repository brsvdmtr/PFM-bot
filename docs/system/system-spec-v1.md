---
title: "PFM Bot — System Specification v1"
document_type: Normative
status: Active
source_of_truth: YES
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./formulas-and-calculation-policy.md
    relation: "delegates calculation details to"
  - path: ./numerical-source-of-truth.md
    relation: "delegates number-by-number reference to"
  - path: ./income-allocation-semantics.md
    relation: "delegates income allocation details to"
  - path: ./glossary.md
    relation: "delegates term definitions to"
  - path: ../api/api-v1.md
    relation: "delegates API schema to"
  - path: ../ops/runbook-deploy.md
    relation: "delegates deployment procedures to"
---

# PFM Bot — System Specification v1

> Stack: pnpm monorepo · Express · Telegraf · Next.js 14 · PostgreSQL + Prisma · Docker Compose

---

## Table of Contents

1. [Scope](#1-scope)
2. [Domain Concepts](#2-domain-concepts)
3. [Authoritative Invariants](#3-authoritative-invariants)
4. [Persisted vs Derived Data](#4-persisted-vs-derived-data)
5. [Data Model Overview](#5-data-model-overview)
6. [Active Period Selection](#6-active-period-selection)
7. [Calculation Engine Semantics](#7-calculation-engine-semantics)
8. [API Semantics](#8-api-semantics)
9. [Notification Semantics](#9-notification-semantics)
10. [Timezone Policy](#10-timezone-policy)
11. [Error Semantics](#11-error-semantics)
12. [Known Correctness Limitations](#12-known-correctness-limitations)
13. [Debugging Guide](#14-debugging-guide)

---

## 1. Scope

This document is the primary system reference for PFM Bot. It defines domain concepts, authoritative invariants, data model relationships, module responsibilities, notification semantics, and timezone policy.

**This document covers:**
- Domain concept definitions (canonical vocabulary)
- System-level invariants that must hold at all times
- Which data is persisted vs. derived at request time
- Data model structure and key relationships
- High-level description of each system module's responsibilities
- Notification and timezone policy
- Known correctness gaps and how to debug them

**This document delegates:**
- Exact S2S calculation formulas, step-by-step arithmetic, and worked examples → `./formulas-and-calculation-policy.md`
- Canonical number-by-number reference (what each displayed value comes from) → `./numerical-source-of-truth.md`
- Income allocation semantics (triggerPayday, multi-payday splitting) → `./income-allocation-semantics.md`
- Full API request/response schemas → `../api/api-v1.md`
- Deployment and operational procedures → `../ops/runbook-deploy.md`

---

## 2. Domain Concepts

For alphabetical definitions, see `./glossary.md`. This section provides the structural context.

### Period

A bounded time window from one payday to the next. Every user has at most one ACTIVE period at any time. Periods do not overlap. A period's `startDate` and `endDate` are stored in UTC calendar dates. Period end date equals the exact next payday date (midnight UTC server time). When a period expires it is marked COMPLETED and a new ACTIVE period is created by the rollover cron job (00:05 UTC).

A period has:
- A **canonical start**: the payday date that logically began it
- A **canonical end**: the next payday date
- An **actual start**: may differ from canonical start if the user joined mid-period (`isProratedStart = true`)

### Income

A recurring income source belonging to a user. Stored with a monthly `amount` in minor units and a `paydays` array (e.g., `[15]` or `[1, 15]`). One record may cover one or two paydays per month. The engine allocates income to a period based on which payday triggered that period (`triggerPayday`). A user may have multiple Income records.

### Obligation

A fixed recurring monthly expense (rent, utilities, subscriptions) deducted from income before computing Safe-to-Spend. Stored per user as a monthly `amount` in minor units. Prorated when the period is shorter than a full period (`isProratedStart = true`).

### Debt

A liability with a `balance`, `apr` (stored as decimal, e.g., `0.189` for 18.9%), and `minPayment`. Used by the avalanche engine to determine extra payment allocation. The focus debt (`isFocusDebt = true`) receives extra from the `avalanchePool`. Minimum payments are deducted from income before computing the discretionary budget.

### Emergency Fund (EF)

A savings target equal to `monthlyObligations × targetMonths` (default 3 months). The engine computes an `efContribution` each period to fill the gap between `currentAmount` and the target. The target always uses the full monthly obligation sum — it is never prorated.

### Expense

A single spending event entered by the user. Stored with `amount` (minor units, Int), `spentAt` timestamp (UTC), and linked to the active Period via `periodId`. The `expensesToday` query filters by `spentAt >= today 00:00:00 UTC`.

### DailySnapshot

A nightly record created at 23:55 UTC. Captures `s2sPlanned`, `s2sActual`, `totalExpenses`, and `isOverspent` for each active period. Used for historical reporting. Not used in real-time dashboard calculation. `s2sActual` is NOT floored at 0 (can be negative if overspent).

### S2S (Safe to Spend)

The product's core output. A three-layer value:
- **`s2sPeriod`**: total discretionary budget for the period. Persisted on the Period row at creation.
- **`dynamicS2sDaily`**: live-computed daily allocation accounting for carry-over. NOT the stored `Period.s2sDaily`.
- **`s2sToday`**: remaining today = `max(0, dynamicS2sDaily - expensesToday)`.

### Reserve

A buffer withheld from the S2S calculation. Starts at 10% of `afterFixed`; falls back to 5% or 0 in edge cases. Reduces `freePool` and therefore reduces `s2sPeriod`.

### freePool

`max(0, afterFixed - reserve)`. The discretionary pool before EF contribution and avalanche allocation.

### avalanchePool

Extra payment directed at the focus debt. Ranges from 25% to 50% of `investPool` depending on APR and EF funding status. Reduces `residual` and therefore `s2sPeriod`.

---

## 3. Authoritative Invariants

The following must hold at all times. Any code change that violates these is a correctness bug.

1. **All money stored in minor units only.** All `Int` fields representing money are kopecks (RUB) or cents (USD). No decimal money values are stored. Values are rounded with `Math.round()` at entry points (API handlers and engine).

2. **One ACTIVE period per user at any time.** The query `prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } })` returns at most one period. The rollover cron marks the old period COMPLETED before creating the new one.

3. **`daysLeft >= 1` always.** Enforced by `Math.max(1, ...)` in both the dashboard handler (`index.ts`) and the `computeS2S` cron helper (`cron.ts`). Prevents division by zero in `dynamicS2sDaily` calculation.

4. **`s2sToday >= 0` always.** Enforced by `Math.max(0, dynamicS2sDaily - expensesToday)` in the dashboard handler and engine.

5. **`s2sPeriod >= 0` always.** Enforced by `Math.max(0, residual)` in `calculateS2S`.

6. **`s2sActual` in `DailySnapshot` may be negative.** The cron computes `s2sPlanned - todayTotal` without flooring. Do not assume this field is non-negative.

7. **Period `endDate > startDate` always.** `calculatePeriodBounds` constructs `periodEnd` as the next occurrence of a payday after `fromDate`. Since `fromDate` is never on `periodEnd` itself, `endDate > startDate` holds.

8. **No cross-user data access.** Every database query touching user-owned records includes a `userId` filter. The `ensureUser` middleware sets `req.userId` from the validated Telegram identity before any handler runs.

9. **Calculation engine is pure.** `calculateS2S` and `calculatePeriodBounds` in `engine.ts` have no side effects, no DB access, and no randomness. Same inputs always produce same outputs.

10. **API is the single compute layer.** The frontend never re-implements S2S arithmetic. The `s2sColor()` function in `MiniApp.tsx` is a display-only color picker derived from API-returned values; it is not a financial calculation.

11. **`auth_date` freshness enforced.** `validateTelegramInitData` rejects `initData` older than 3600 seconds (`Date.now() / 1000 - authDate > 3600`).

12. **New period created on rollover within minutes.** The rollover cron runs at 00:05 UTC daily. In normal operation, the gap between a period expiring and a new period being created is at most 5 minutes (from 00:00 UTC to 00:05 UTC). If the API process is down at rollover time, the gap can be up to 24 hours.

13. **Deterministic calculations for same inputs.** The engine uses only its inputs, `Math.round()`, and integer arithmetic — no timestamps, no randomness. The same inputs always produce the same outputs regardless of when the calculation runs.

---

## 4. Persisted vs Derived Data

| Field | Table | Type | Persisted / Derived | Recomputed When |
|-------|-------|------|---------------------|-----------------|
| `Period.s2sPeriod` | Period | Int (kopecks) | Persisted | At period creation (onboarding / rollover / recalculate) |
| `Period.s2sDaily` | Period | Int (kopecks) | Persisted snapshot | At period creation — stale immediately as expenses accrue |
| `Period.startDate` | Period | DateTime | Persisted | At period creation |
| `Period.endDate` | Period | DateTime | Persisted | At period creation |
| `Period.daysTotal` | Period | Int | Persisted | At period creation |
| `Period.totalIncome` | Period | Int | Persisted | At period creation |
| `Period.totalObligations` | Period | Int | Persisted | At period creation |
| `Period.totalDebtPayments` | Period | Int | Persisted | At period creation |
| `Period.efContribution` | Period | Int | Persisted | At period creation |
| `Period.reserve` | Period | Int | Persisted | At period creation |
| `Period.isProratedStart` | Period | Boolean | Persisted | At period creation |
| `Period.status` | Period | Enum | Persisted | On rollover (ACTIVE → COMPLETED) |
| `Expense.amount` | Expense | Int | Persisted | Never (immutable after insert) |
| `Expense.spentAt` | Expense | DateTime | Persisted | Never (default: now()) |
| `EmergencyFund.currentAmount` | EmergencyFund | Int | Persisted | When user updates EF balance |
| `dashboard.dynamicS2sDaily` | — | Derived | Derived at request time | Each `GET /tg/dashboard` call |
| `dashboard.s2sToday` | — | Derived | Derived at request time | Each `GET /tg/dashboard` call |
| `dashboard.daysLeft` | — | Derived | Derived at request time | Each `GET /tg/dashboard` call |
| `dashboard.periodRemaining` | — | Derived | Derived at request time | Each `GET /tg/dashboard` call |
| `dashboard.todayTotal` | — | Derived | Derived at request time | Each `GET /tg/dashboard` call |
| `dashboard.s2sStatus` | — | Derived | Derived at request time | Each `GET /tg/dashboard` call |
| `DailySnapshot.s2sPlanned` | DailySnapshot | Int | Persisted snapshot | Nightly at 23:55 UTC |
| `DailySnapshot.s2sActual` | DailySnapshot | Int | Persisted snapshot | Nightly at 23:55 UTC |
| `DailySnapshot.totalExpenses` | DailySnapshot | Int | Persisted snapshot | Nightly at 23:55 UTC |
| `DailySnapshot.isOverspent` | DailySnapshot | Boolean | Persisted snapshot | Nightly at 23:55 UTC |

**Critical:** The `GET /tg/dashboard` endpoint reads `activePeriod.s2sPeriod` from DB but computes `dynamicS2sDaily` and `s2sToday` fresh every request. It does **not** read `Period.s2sDaily`. The stored `Period.s2sDaily` is used only in completed period summaries and new-period notifications.

---

## 5. Data Model Overview

### Entity Relationships

```
User (1)
 ├── UserProfile (0..1)
 ├── UserSettings (0..1)       ← notification times, flags
 ├── Income[] (0..n)           ← amount, paydays[], isActive
 ├── Obligation[] (0..n)       ← amount, type, isActive
 ├── Debt[] (0..n)             ← balance, apr, minPayment, isFocusDebt
 ├── EmergencyFund (0..1)      ← currentAmount, targetMonths
 ├── Period[] (0..n)
 │    ├── Expense[] (0..n)     ← amount, spentAt
 │    └── DailySnapshot[] (0..n)
 ├── Subscription (0..1)
 └── PaymentEvent[] (0..n)
```

### Key Field Notes

**User**
- `telegramId`: String, unique. Used to find/create the user on every request.
- `telegramChatId`: Required for push notifications. Populated when user interacts with the bot.
- `timezone`: IANA string (default `"Europe/Moscow"`). Used by the notification cron to dispatch at the user's local time.
- `onboardingDone`: Boolean. Gates access to dashboard. Must be `true` for notifications to fire.

**Period**
- `s2sPeriod`: The discretionary budget for the full period. Floored at 0. Persisted at creation.
- `s2sDaily`: Snapshot of daily limit at creation (`s2sPeriod / daysTotal`). Not used in live dashboard.
- `endDate`: The next payday date. Period expires when `endDate <= today UTC`.
- `isProratedStart`: True when the user started mid-period during onboarding.
- `currency`: Inherited from income currency at creation time.
- `status`: `ACTIVE` (current), `COMPLETED` (ended by rollover cron).

**Income**
- `paydays`: `Int[]`, days of month (e.g., `[15]` or `[1, 15]`).
- `amount`: Total monthly amount in minor units. Engine divides by `paydays.length` per period.
- `isActive`: Soft-delete flag. Only active incomes are used in calculations.

**Debt**
- `isFocusDebt`: Boolean. Set by `determineFocusDebt()` (highest APR, then smallest balance). Only this debt receives `avalanchePool`.
- `balance`: Remaining principal in minor units.
- `apr`: Stored as decimal fraction (e.g., `0.189` for 18.9%).
- Only debts with `balance > 0` are included in the engine's `activeDebts`.

**EmergencyFund**
- `targetMonths`: Default 3. Multiplied by monthly obligations to get the savings target.
- `currentAmount`: User-reported current savings. Not updated automatically by the engine.

**DailySnapshot**
- Unique constraint on `(periodId, date)`. Upserted nightly.
- `date` is UTC midnight of the snapshot day.
- `s2sActual = s2sPlanned - todayTotal` — can be negative if overspent. Not floored.

---

## 6. Active Period Selection

The active period for a user is found with:

```typescript
prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } })
```

There is no `orderBy` on this query. Invariant #2 (one ACTIVE period per user) makes this safe. If the invariant is violated (rollover bug), `findFirst` returns an arbitrary period and the results will be incorrect.

### Rollover Cron Behavior (Cron 4, `5 0 * * *`)

1. Finds all periods with `status: 'ACTIVE'` and `endDate <= today UTC midnight`
2. For each expired period:
   a. Marks it `COMPLETED`
   b. Fetches current incomes, obligations, debts, EF for the user
   c. Calls `calculatePeriodBounds` and `calculateS2S` with today's date
   d. Creates a new `ACTIVE` period
   e. Sends new-period notification

If the user has no active incomes at rollover time, the cron skips new period creation for that user (`if (incomes.length === 0) continue`). The old period is still marked COMPLETED. The user will have no active period until they add income and trigger a recalculate.

If the API process is down at 00:05 UTC, rollover does not run. The expired ACTIVE period remains active until the next day's cron fires.

---

## 7. Calculation Engine Semantics

The engine is implemented in `apps/api/src/engine.ts` as two pure functions:

- `calculatePeriodBounds(paydays, fromDate)` — determines start/end dates, `isProratedStart`, `daysTotal`, `fullPeriodDays`
- `calculateS2S(input)` — computes the full S2S breakdown

For exact formulas, rounding rules, step-by-step arithmetic, income allocation, and worked examples, see:

- **`./formulas-and-calculation-policy.md`** — canonical reference for all calculations
- **`./income-allocation-semantics.md`** — `triggerPayday` determination and multi-payday income splitting

### Calculation Summary

```
totalIncome        ← incomes matching triggerPayday, divided by paydays.length
totalObligations   ← sum of obligations, prorated if isProratedStart
totalDebtPayments  ← sum of min payments, prorated if isProratedStart
afterFixed         = totalIncome - totalObligations - totalDebtPayments
reserve            = round(afterFixed × 10%)  [fallback: 5%, then 0]
freePool           = max(0, afterFixed - reserve)
efContribution     = min(efDeficit/12, freePool×20%, efDeficit)
avalanchePool      = 25–50% of investPool, capped at focusDebt.balance
s2sPeriod          = max(0, residual)

dynamicS2sDaily (live) = max(0, round((s2sPeriod - totalPeriodSpent) / daysLeft))
s2sToday               = max(0, dynamicS2sDaily - expensesToday)
```

### When the Engine Runs

The engine (`calculateS2S`) is called at:
1. Onboarding completion (`POST /tg/onboarding/complete`)
2. Period rollover (Cron 4 at 00:05 UTC)
3. Manual recalculate (`POST /tg/periods/recalculate`)

The dashboard's live `dynamicS2sDaily` and `s2sToday` are computed in `index.ts` directly (not via `calculateS2S`) on every `GET /tg/dashboard` request.

---

## 8. API Semantics

### Authentication

All `/tg/*` routes require:
- `X-TG-INIT-DATA` header containing Telegram's URL-encoded `initData`
- HMAC-SHA256 validation using `BOT_TOKEN` as secret
- `auth_date` freshness check: rejects `initData` older than 3600 seconds

In non-production environments only: `X-TG-DEV: <telegramId>` bypasses HMAC validation.

All `/internal/*` routes require:
- `X-Internal-Key` header matching `ADMIN_KEY` environment variable exactly

### Request/Response Contract

- All money values in request bodies and responses are in minor units (kopecks/cents).
- Frontend displays: `amount / 100` with `toLocaleString('ru-RU')`.
- `POST /tg/expenses` accepts `amount` as a number in minor units, validates `amount > 0`.
- `GET /tg/dashboard` always returns a valid JSON body. If no active period exists, it returns zeroed fields rather than an error.
- Responses do not include envelope wrappers — the body is the resource directly.
- Delete operations return `{ ok: true }` with HTTP 200.
- Create operations return the created resource with HTTP 201.

### Onboarding Flow

The onboarding sequence (must be completed in order):
1. `POST /tg/onboarding/income` — creates Income record, sets user primary currency
2. `POST /tg/onboarding/obligations` — replaces all obligations
3. `POST /tg/onboarding/debts` — replaces all debts, sets `isFocusDebt` on first
4. `POST /tg/onboarding/ef` — creates/updates EmergencyFund
5. `POST /tg/onboarding/complete` — calculates period bounds and S2S, creates ACTIVE Period, sets `onboardingDone = true`

### Auth Flow

```
Telegram App
  → injects window.Telegram.WebApp.initData
    → Next.js reads initData, sends as X-TG-INIT-DATA header
      → API validates HMAC → extracts TelegramUser.id
        → ensureUser: finds or creates User by telegramId
          → sets req.userId for handler
```

---

## 9. Notification Semantics

Four cron jobs run inside the API process, started via `import('./cron')` after the Express server starts listening.

| Schedule (UTC) | Job | Description |
|---|---|---|
| `* * * * *` | Notification dispatcher | Every minute. For each user with `telegramChatId != null` and `onboardingDone = true`: computes current local time in their `timezone`. If local time matches `morningNotifyTime` (default `09:00`) and morning notify enabled, sends morning notification. Same for evening. |
| `55 23 * * *` | Daily snapshot | Upserts DailySnapshot for all active periods. Captures `s2sPlanned`, `s2sActual`, `totalExpenses`, `isOverspent` at 23:55 UTC. |
| `0 9 * * *` | Debt payment alerts | Finds debts with `dueDay` equal to today or tomorrow. Sends payment alert. Fires at 09:00 UTC — not per-user timezone. |
| `5 0 * * *` | Period rollover | Finds active periods with `endDate <= today 00:00 UTC`. Marks COMPLETED, creates new ACTIVE period, sends new-period notification. |

### Dedup Mechanism

Notification dedup uses an in-memory `Map<string, Set<string>>` keyed by UTC date string (`YYYY-MM-DD`). The Set contains `"userId:type"` keys (e.g., `"user123:morning"`). The previous day's entries are cleared when a new date is encountered.

**Consequence:** Dedup persists only within a single process lifetime. If the API restarts after a notification fires but before the day ends, the notification may be sent again on the next minute tick.

Payment alert dedup key: `"userId:payment:<debtId>"` — prevents duplicate alerts per debt per day across multiple cron ticks.

### Notification Contents

| Type | Function | Content |
|------|----------|---------|
| Morning | `sendMorningNotification` | `s2sToday`, `s2sDaily`, `daysLeft`, status emoji. Inline keyboard button linking to Mini App. |
| Evening | `sendEveningNotification` | `todaySpent`, `s2sDaily`, remaining or overspent amount. |
| Payment alert | `sendPaymentAlert` | Debt title, `minPayment`, currency, days until due (0 = today, 1 = tomorrow). |
| New period | `sendNewPeriodNotification` | New `s2sDaily`, `daysTotal`, currency, `prevSaved` (positive = saved, negative = overspent). |
| Deficit alert | `sendDeficitAlert` | Deficit amount and currency. **Function exists in `notify.ts` but is never called by any cron job.** |

---

## 10. Timezone Policy

| Concern | Implementation | Known Gap |
|---------|---------------|-----------|
| User timezone storage | IANA string in `User.timezone`, default `"Europe/Moscow"` | No UI to change timezone after onboarding |
| Cron execution | All cron jobs run on the server, assumed UTC | Server timezone must be UTC in production |
| Notification dispatch | Converts UTC now to user's IANA timezone, compares to stored `HH:MM` string | Per-minute granularity; 1-minute jitter possible |
| Period boundaries | `new Date(year, month, day)` in Node.js uses server local time (assumed UTC) | If server is not UTC, period boundaries shift |
| `expensesToday` query | `spentAt >= new Date().setHours(0,0,0,0)` in UTC | Users in UTC+3: "today" resets at 03:00 MSK, not 00:00 MSK |
| DailySnapshot | Fires at 23:55 UTC | Not aligned to any user's local midnight |
| Period rollover | Fires at 00:05 UTC | Users significantly west of UTC experience rollover during their previous calendar day |

**Known drift:** For users in UTC-5, rollover fires at 19:05 local (the previous evening). Their "new period" starts while they are still spending in what they consider the old day. For Moscow users (+3), rollover fires at 03:05 MSK — correctly after midnight local.

---

## 11. Error Semantics

### HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET, successful DELETE (`{ ok: true }`) |
| 201 | Created | Successful POST creating a resource |
| 400 | Bad Request | Invalid input (amount <= 0, missing required fields, no active period) |
| 401 | Unauthorized | Missing or invalid `X-TG-INIT-DATA`, stale `auth_date`, invalid `X-Internal-Key` |
| 404 | Not Found | Resource not found for a confirmed user (e.g., expense not found on DELETE) |
| 503 | Service Unavailable | `GET /health/deep` DB connectivity failure |

### Error Body Format

```json
{ "error": "Human-readable error message" }
```

The `code` field is not currently used in production handlers.

---

## 12. Known Correctness Limitations

These are confirmed gaps between intended and actual behavior. They must be understood when debugging or extending the system.

1. **`triggerPayday` is not persisted on the Period record.** Derived at runtime from `endDate.getDate()` and the current Income paydays. If the user changes paydays between period creation and a recalculate, the income allocation for the current period changes retroactively.

2. **`sendDeficitAlert` is never called.** The function exists in `notify.ts` and is exported, but no cron job or route calls it. The `deficitAlerts` setting in `UserSettings` has no effect.

3. **`weeklyDigest` setting exists but no cron implements it.** `UserSettings.weeklyDigest` is stored and toggleable but there is no weekly digest job.

4. **Period rollover at 00:05 UTC does not align with user's local midnight.** Users significantly west of UTC experience rollover during their prior calendar day. The `expensesToday` query in the new period's first dashboard load may include expenses from the wrong local day.

5. **EF target uses full monthly obligations even for prorated periods.** `efTarget = monthlyObligations × targetMonths` always uses the full monthly sum. `efContribution` is prorated, but the target is not. This is intentional but creates an asymmetry (see `./formulas-and-calculation-policy.md` Section 14).

6. **Notification dedup is in-memory only.** A process restart during the notification window can cause duplicate notifications. No DB-backed dedup exists.

7. **No rate limiting on any endpoint.** All `/tg/*` routes are subject to Telegram's own rate limits at the `initData` level, but the API itself has no per-user or per-IP rate limiting.

8. **DailySnapshot timing is UTC-based, not per-user timezone.** The 23:55 UTC snapshot is the end of the UTC day. For Moscow users (+3), this is 02:55 MSK the next day. Historical reporting built on snapshots will be offset by the user's UTC offset.

9. **No `/delete` user data command.** There is no implemented route or bot command for a user to delete their data. The field and infrastructure for user deletion do not exist.

10. **Multi-currency is not operational.** The schema supports `Currency.USD`, but the engine performs no currency conversion. Mixing RUB and USD incomes/obligations produces incorrect results.

11. **Expense import not implemented.** `ExpenseSource.IMPORT` and `Expense.source` exist in the schema but no import route or pipeline is built.

12. **Debt payment alert cron fires at 09:00 UTC, not user-local time.** Unlike morning/evening notifications, the payment alert is not per-timezone.

---

## 13. Debugging Guide

### How to Debug a Wrong Dashboard Number

**Problem:** User reports `s2sToday` or `s2sDaily` is wrong.

```bash
# 1. Get the active period
psql $DATABASE_URL -c "
  SELECT id, start_date, end_date, s2s_period, s2s_daily, days_total, is_prorated_start, status
  FROM \"Period\"
  WHERE user_id = '<userId>' AND status = 'ACTIVE';
"

# 2. Get today's total expenses (UTC midnight)
psql $DATABASE_URL -c "
  SELECT SUM(amount) AS today_total
  FROM \"Expense\"
  WHERE user_id = '<userId>'
    AND spent_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
"

# 3. Get period total expenses
psql $DATABASE_URL -c "
  SELECT SUM(e.amount) AS period_total
  FROM \"Expense\" e
  JOIN \"Period\" p ON e.period_id = p.id
  WHERE p.user_id = '<userId>' AND p.status = 'ACTIVE';
"

# 4. Manually verify using the formulas:
#    daysLeft         = max(1, ceil((endDate - now) / 86400000))
#    periodRemaining  = max(0, s2sPeriod - periodTotal)
#    dynamicS2sDaily  = max(0, round(periodRemaining / daysLeft))
#    s2sToday         = max(0, dynamicS2sDaily - todayTotal)
```

**Common mistakes:**
- Using `Period.s2sDaily` (snapshot) instead of computing `dynamicS2sDaily` fresh
- Using local midnight instead of UTC midnight for today's expenses
- Stale `s2sPeriod` — if income/obligations changed and recalculate was not called

### How to Debug a Wrong Period Rollover

**Problem:** Period did not roll over, or new period has wrong dates.

```bash
# Check if any expired ACTIVE periods exist
psql $DATABASE_URL -c "
  SELECT id, user_id, end_date, status
  FROM \"Period\"
  WHERE status = 'ACTIVE' AND end_date <= now();
"

# Check API logs for rollover output
docker logs pfm-api 2>&1 | grep -i "rollover\|Cron 4\|completed\|new period" | tail -30

# Verify the rollover cron is scheduled (logged at startup)
docker logs pfm-api 2>&1 | grep "Scheduled\|cron"

# Check incomes for a user (rollover skips if no active incomes)
psql $DATABASE_URL -c "
  SELECT id, amount, paydays, is_active
  FROM \"Income\"
  WHERE user_id = '<userId>' AND is_active = true;
"
```

**Common causes:**
- API process was down at 00:05 UTC
- User has no active incomes (rollover skips new period creation)
- Payday date has no valid next occurrence (e.g., payday 31 in a 28-day month — `new Date(year, month, 31)` wraps to next month)

### How to Debug a Wrong Notification

**Problem:** Morning notification not sent, or sent at wrong time.

```bash
# 1. Verify user has telegramChatId and onboardingDone
psql $DATABASE_URL -c "
  SELECT id, telegram_chat_id, onboarding_done, timezone
  FROM \"User\"
  WHERE telegram_id = '<telegramId>';
"

# 2. Check notification settings
psql $DATABASE_URL -c "
  SELECT morning_notify_enabled, morning_notify_time, evening_notify_enabled
  FROM \"UserSettings\"
  WHERE user_id = '<userId>';
"

# 3. Manually check what time it is in the user's timezone right now
node -e "
  console.log(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date()));
"

# 4. Check for duplicate sends (dedup lost on restart)
docker logs pfm-api 2>&1 | grep "morning\|evening\|notify" | tail -30
```

**Common causes:**
- `telegramChatId` is null (user never interacted with the bot directly)
- `onboardingDone = false`
- Process restarted during notification window (dedup lost)
- `morningNotifyTime` format mismatch (must be `HH:MM` 24-hour)

### How to Debug s2sToday Near Midnight

**Problem:** `s2sToday` resets unexpectedly, or carries over incorrect values near midnight UTC.

**Root cause analysis:**
- `expensesToday` uses UTC midnight. When UTC midnight passes, expenses from "yesterday local" are no longer in today's total.
- `daysLeft` decrements at UTC midnight. For Moscow users, this happens at 03:00 MSK.
- A user who logs expenses between 00:00 and 03:00 MSK will see those expenses shift from "today" to "yesterday" at 03:00 MSK.

```bash
# Verify server UTC time
docker exec pfm-api node -e "console.log(new Date().toISOString())"

# Check what "today" boundary is for the user
# If user timezone is Europe/Moscow (+3) and it's 02:30 UTC:
# - Server considers it "today" until 00:00 UTC
# - User considers it still "today" until 00:00 MSK (21:00 UTC prev day)
# - Mismatch: user's subjective "today" and server "today" differ
```

### How to Debug s2sStatus Discrepancy

**Problem:** Color or status on dashboard doesn't match expectation.

Logic from `index.ts` dashboard handler:

```
if period.s2sPeriod <= 0:
  s2sStatus = 'DEFICIT'
else if todayTotal > dynamicS2sDaily:
  s2sStatus = 'OVERSPENT'
else if dynamicS2sDaily > 0 and s2sToday / dynamicS2sDaily <= 0.3:
  s2sStatus = 'WARNING'
else:
  s2sStatus = 'OK'
```

Color logic (from `engine.ts` output, also applied in frontend `s2sColor()` in `MiniApp.tsx`):

```
if DEFICIT or OVERSPENT: red
if s2sToday / s2sDaily <= 0.3: red (WARNING = red, not orange)
if s2sToday / s2sDaily <= 0.7: orange
else: green
```

Note: WARNING maps to **red**, not orange. Orange only applies in the `(0.3, 0.7]` ratio range.

### Useful Verification Commands

```bash
# Health check
curl https://mytodaylimit.ru/api/health

# Deep health (DB connectivity)
curl https://mytodaylimit.ru/api/health/deep

# Dashboard (dev mode only — bypasses HMAC)
curl -H "X-TG-DEV: <telegramId>" http://localhost:3002/tg/dashboard | jq '.'

# Full live s2sDaily calculation in SQL
WITH period_data AS (
  SELECT id, s2s_period, end_date FROM "Period"
  WHERE user_id = '<userId>' AND status = 'ACTIVE'
),
spent AS (
  SELECT SUM(e.amount) AS total
  FROM "Expense" e
  JOIN period_data p ON e.period_id = p.id
)
SELECT
  p.s2s_period,
  s.total AS total_spent,
  GREATEST(0, p.s2s_period - COALESCE(s.total, 0)) AS period_remaining,
  GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p.end_date - NOW())) / 86400)) AS days_left,
  ROUND(
    GREATEST(0, p.s2s_period - COALESCE(s.total, 0))::numeric
    / GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p.end_date - NOW())) / 86400))
  ) AS live_dynamic_s2s_daily
FROM period_data p, spent s;
```
