---
title: "PFM Bot — System Specification v1"
document_type: Normative
status: Active
source_of_truth: "YES — primary system reference"
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - system/formulas-and-calculation-policy.md  ← NEW canonical for calculations
  - system/numerical-source-of-truth.md        ← NEW
  - system/income-allocation-semantics.md      ← NEW
  - api/api-v1.md
  - ops/runbook-deploy.md
---

# PFM Bot — System Specification v1

> Stack: pnpm monorepo · Express · Telegraf · Next.js 14 · PostgreSQL + Prisma · Docker Compose

---

## Table of Contents

1. [Scope](#1-scope)
2. [Domain Concepts](#2-domain-concepts)
3. [Authoritative Invariants](#3-authoritative-invariants)
4. [Persisted vs Derived Data](#4-persisted-vs-derived-data)
5. [Data Model](#5-data-model)
6. [Active Period Selection](#6-active-period-selection)
7. [Calculation Engine](#7-calculation-engine)
8. [API Semantics](#8-api-semantics)
9. [Notification Semantics](#9-notification-semantics)
10. [Timezone Policy](#10-timezone-policy)
11. [Error Semantics](#11-error-semantics)
12. [Known Correctness Limitations](#12-known-correctness-limitations)
13. [Open Verification Items](#13-open-verification-items)
14. [Debugging Guide](#14-debugging-guide)

---

## 1. Scope

This document is the primary system reference for the PFM Bot project. It defines domain concepts, authoritative invariants, data model relationships, and module responsibilities.

**This document covers:**
- Domain concept definitions (canonical vocabulary)
- System-level invariants that must hold at all times
- Which data is persisted vs. derived at request time
- Data model structure and key relationships
- High-level description of each system module's responsibilities
- Notification and timezone policy
- Known correctness gaps

**This document delegates:**
- Exact S2S calculation formulas and step-by-step arithmetic → `system/formulas-and-calculation-policy.md`
- Canonical numeric examples and rounding rules → `system/numerical-source-of-truth.md`
- Income allocation semantics (triggerPayday, multi-payday splitting) → `system/income-allocation-semantics.md`
- Full API request/response schemas → `api/api-v1.md`
- Deployment and operational procedures → `ops/runbook-deploy.md`

---

## 2. Domain Concepts

See also: `docs/glossary.md` (if it exists) for a flat alphabetical reference.

**Period**
A bounded time window from one payday to the next. Every user has at most one ACTIVE period at any time. Periods do not overlap. A period's `startDate` and `endDate` are stored in UTC. Period end date equals the exact payday date (midnight UTC). When a period expires it is marked COMPLETED and a new ACTIVE period is created by the rollover cron job.

**Income**
A recurring income source belonging to a user. Stored with a monthly `amount` in minor units and a `paydays` array (e.g. `[15]` or `[1, 15]`). One Income record may cover one or two paydays per month. The engine allocates income to a period based on which payday triggered that period (triggerPayday). A user may have multiple Income records.

**Obligation**
A fixed recurring monthly expense (rent, utilities, subscriptions, etc.) that is deducted from income before computing Safe-to-Spend. Stored per user as a monthly `amount`. Prorated when the period is shorter than a full period (isProratedStart = true).

**Debt**
A liability with a balance, APR, and minimum monthly payment. Used by the avalanche engine to determine extra payment allocation. The focus debt (highest APR, then smallest balance) receives extra from the `avalanchePool`. Minimum payments are deducted from income like obligations.

**EF (Emergency Fund)**
A savings target equal to `monthlyObligations × targetMonths` (default 3 months). The engine computes an `efContribution` each period to fill the gap between `currentAmount` and the target. The target uses monthly (non-prorated) obligations even in prorated periods.

**Expense**
A single spending event entered by the user. Stored with `amount` (minor units), `spentAt` timestamp (UTC), and linked to the active Period. The `todayExpenses` query filters by `spentAt >= today 00:00:00 UTC`.

**Snapshot (DailySnapshot)**
A nightly record (23:55 UTC) capturing `s2sPlanned`, `s2sActual`, `totalExpenses`, and `isOverspent` for each active period. Used for historical reporting. Not used in real-time dashboard calculation.

**S2S (Safe to Spend)**
The system's core output. Computed in three layers:
- `s2sPeriod`: total discretionary budget for the period (persisted on the Period row at creation)
- `s2sDaily`: live-computed daily allocation accounting for carry-over (NOT the stored `period.s2sDaily`)
- `s2sToday`: remaining today = `max(0, s2sDaily - todayExpenses)`

**Reserve**
A buffer withheld from S2S calculation. Starts at 10% of `afterFixed`; falls back to 5% or 0 if the result would go negative.

**freePool**
`max(0, afterFixed - reserve)`. The discretionary pool before EF contribution and avalanche allocation.

**avalanchePool**
Extra payment directed at the focus debt. Ranges from 25% to 50% of `investPool` depending on APR and EF funding status.

---

## 3. Authoritative Invariants

The following must hold at all times. Any code change that violates these is a correctness bug.

1. **All money stored in minor units only.** All `Int` fields in the schema representing money are kopecks (RUB) or cents (USD). No decimal money values are stored. Values are rounded with `Math.round()` at entry points.

2. **One ACTIVE period per user at any time.** The query `prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } })` returns at most one period. The rollover cron marks the old period COMPLETED before creating the new one.

3. **`daysLeft >= 1` always.** Enforced by `Math.max(1, ...)` in both the dashboard handler (`index.ts`) and the `computeS2S` cron helper (`cron.ts`).

4. **`s2sToday >= 0` always.** Enforced by `Math.max(0, s2sDaily - todayExpenses)` in the dashboard handler and engine.

5. **`s2sPeriod >= 0` always.** Enforced by `Math.max(0, residual)` in `calculateS2S`.

6. **No cross-user data access.** Every database query that touches user-owned records includes a `userId` filter. The `ensureUser` middleware sets `req.userId` from the validated Telegram identity before any handler runs.

7. **Calculation engine is pure.** `calculateS2S` and `calculatePeriodBounds` in `engine.ts` have no side effects, no DB access, and no randomness. Same inputs always produce same outputs.

8. **Period end date = exact payday date (midnight).** `calculatePeriodBounds` constructs `periodEnd` as `new Date(year, month, payday)` which is local midnight. No time component is set.

9. **API is the single compute layer.** The UI displays values returned by the API. The frontend never re-implements S2S arithmetic. The `s2sColor` function in `MiniApp.tsx` is a display-only color picker, not a financial calculation.

10. **`auth_date` freshness check enforced.** The `validateTelegramInitData` function in `index.ts` rejects initData older than 3600 seconds (`Date.now() / 1000 - authDate > 3600`).

---

## 4. Persisted vs Derived Data

| Field | Table | Type | Persisted / Derived | Recomputed When |
|---|---|---|---|---|
| `Period.s2sPeriod` | Period | Int (kopecks) | Persisted | At period creation (onboarding/rollover/recalculate) |
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
| `Expense.amount` | Expense | Int | Persisted | Never (immutable after insert) |
| `Expense.spentAt` | Expense | DateTime | Persisted | Never (default: now()) |
| `EmergencyFund.currentAmount` | EmergencyFund | Int | Persisted | When user updates EF balance |
| `dashboard.s2sDaily` | — | Derived | Derived at request | Each GET /tg/dashboard call |
| `dashboard.s2sToday` | — | Derived | Derived at request | Each GET /tg/dashboard call |
| `dashboard.daysLeft` | — | Derived | Derived at request | Each GET /tg/dashboard call |
| `dashboard.periodRemaining` | — | Derived | Derived at request | Each GET /tg/dashboard call |
| `dashboard.todayTotal` | — | Derived | Derived at request | Each GET /tg/dashboard call |
| `dashboard.s2sStatus` | — | Derived | Derived at request | Each GET /tg/dashboard call |
| `DailySnapshot.s2sPlanned` | DailySnapshot | Int | Persisted snapshot | Nightly at 23:55 UTC |
| `DailySnapshot.s2sActual` | DailySnapshot | Int | Persisted snapshot | Nightly at 23:55 UTC |
| `DailySnapshot.totalExpenses` | DailySnapshot | Int | Persisted snapshot | Nightly at 23:55 UTC |
| `DailySnapshot.isOverspent` | DailySnapshot | Boolean | Persisted snapshot | Nightly at 23:55 UTC |

**Important note on `period.s2sDaily`:** The field stored on the Period row is a snapshot taken at period creation time, when `totalExpensesInPeriod = 0`. As the user adds expenses throughout the period, this field becomes stale. The dashboard endpoint does NOT use `period.s2sDaily`. It recomputes the daily limit as:

```
dynamicS2sDaily = max(0, round((period.s2sPeriod - totalPeriodSpent) / daysLeft))
```

This carry-over recalculation means the daily limit adjusts every time the dashboard is loaded.

---

## 5. Data Model

### Key Relationships (ASCII)

```
User (1)
 ├── UserProfile (0..1)
 ├── UserSettings (0..1)       ← notification times, flags
 ├── Income[] (0..n)           ← amount, paydays[], isActive
 ├── Obligation[] (0..n)       ← amount, type, isActive
 ├── Debt[] (0..n)             ← balance, apr, minPayment, isFocusDebt
 ├── EmergencyFund (0..1)      ← currentAmount, targetMonths
 ├── Period[] (0..n)
 │    └── Expense[] (0..n)     ← amount, spentAt, userId
 │    └── DailySnapshot[] (0..n)
 ├── Subscription (0..1)
 └── PaymentEvent[] (0..n)
```

### Field-Level Notes

**User**
- `telegramId`: String, unique, used to find/create the user on every request
- `telegramChatId`: populated when user interacts with the bot; required for push notifications
- `timezone`: IANA string (default `"Europe/Moscow"`), used by notification cron
- `onboardingDone`: gates access to dashboard; must be true for notifications to fire

**Period**
- `s2sPeriod`: the discretionary budget for the full period; floor at 0
- `s2sDaily`: snapshot of daily limit at creation; not used in live dashboard (see section 4)
- `endDate`: equals the next payday date; period expires when `endDate <= today UTC`
- `isProratedStart`: true when the user started mid-period during onboarding
- `currency`: inherited from the income currency at creation time

**Income**
- `paydays`: `Int[]`, days of month (e.g. `[15]` or `[1, 15]`)
- `amount`: monthly amount in minor units; the engine divides by `paydays.length` when allocating to a period
- `isActive`: soft-delete flag; only active incomes are used in calculations

**Debt**
- `isFocusDebt`: set by `determineFocusDebt()` (highest APR, then smallest balance); controls which debt receives `avalanchePool`
- `balance`: remaining principal in minor units
- `apr`: stored as a decimal fraction (e.g. `0.189` for 18.9%)

**EmergencyFund**
- `targetMonths`: default 3; multiplied by monthly obligations to get the savings target
- `currentAmount`: user-reported current savings; the engine does not update this automatically

**DailySnapshot**
- Unique constraint on `(periodId, date)`; upserted nightly
- `date` is UTC midnight of the snapshot day (`setHours(0,0,0,0)`)

---

## 6. Active Period Selection

The active period for a user is found with a single query:

```typescript
prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } })
```

There is no `orderBy` on this query. The invariant that only one ACTIVE period exists per user (invariant #2) means this is safe. If the invariant is ever violated (e.g. by a rollover bug), `findFirst` will return an arbitrary period.

The rollover cron (Cron 4, `5 0 * * *`) enforces the one-active-period invariant by:
1. Finding all periods with `status: 'ACTIVE'` and `endDate <= today`
2. For each expired period: marking it COMPLETED, then creating a new ACTIVE period

If the API process is down at 00:05 UTC, rollover does not run. The expired ACTIVE period remains active until the next day's cron fires at 00:05 UTC.

---

## 7. Calculation Engine

The engine is implemented in `apps/api/src/engine.ts` as two pure functions:

- `calculatePeriodBounds(paydays, fromDate)` — determines start/end dates for a period
- `calculateS2S(input)` — computes the full S2S breakdown

For exact formulas, rounding rules, step-by-step arithmetic, and income allocation logic, see:

- **`system/formulas-and-calculation-policy.md`** — canonical reference for all calculations
- **`system/income-allocation-semantics.md`** — triggerPayday determination and multi-payday income splitting

**Brief summary of `calculateS2S` output:**

```
totalIncome        ← incomes matching triggerPayday, divided by paydays.length
totalObligations   ← sum of obligations, prorated if isProratedStart
totalDebtPayments  ← sum of min payments, prorated if isProratedStart
afterFixed         = totalIncome - totalObligations - totalDebtPayments
reserve            = round(afterFixed × 10%)  [fallback 5%, then 0]
freePool           = max(0, afterFixed - reserve)
efContribution     = min(efDeficit/12, freePool×20%, efDeficit)
avalanchePool      = 25–50% of investPool, capped at focusDebt.balance
s2sPeriod          = max(0, afterFixed - reserve - efContribution - avalanchePool)

s2sDaily (live)    = max(0, round((s2sPeriod - totalPeriodSpent) / daysLeft))
s2sToday           = max(0, s2sDaily - todayExpenses)
```

The `calculatePeriodBounds` function handles:
- 1 payday: monthly period from payday to same day next month
- 2 paydays `[a, b]`: alternating half-month periods (a→b, b→a next month)
- 3+ paydays: falls back to monthly from `fromDate` (not supported case)
- `isProratedStart = true` when `fromDate` is not on a payday boundary

---

## 8. API Semantics

### Authentication

All `/tg/*` routes require:
- `X-TG-INIT-DATA` header containing Telegram's URL-encoded `initData`
- HMAC-SHA256 validation using `BOT_TOKEN` as secret
- `auth_date` freshness check: rejects initData older than 3600 seconds

In non-production environments only: `X-TG-DEV: <telegramId>` bypasses HMAC validation.

All `/internal/*` routes require:
- `X-Internal-Key` header matching `ADMIN_KEY` environment variable exactly

### Request/Response Contract Rules

- All money values in request bodies and responses are in minor units (kopecks/cents)
- The frontend formats for display: `amount / 100` with `toLocaleString('ru-RU')`
- `POST /tg/expenses` accepts `amount` as a number in minor units, validates `amount > 0`
- `GET /tg/dashboard` always returns a valid JSON body; if no active period, returns zeroed fields rather than an error
- Responses do not include envelope wrappers — the body is the resource directly
- Delete operations return `{ ok: true }`
- Create operations return the created resource with HTTP 201

### Onboarding Flow

The onboarding sequence is:
1. `POST /tg/onboarding/income` — creates Income record, sets user primary currency
2. `POST /tg/onboarding/obligations` — replaces all obligations
3. `POST /tg/onboarding/debts` — replaces all debts, sets isFocusDebt on first
4. `POST /tg/onboarding/ef` — creates/updates EmergencyFund
5. `POST /tg/onboarding/complete` — calculates period bounds and S2S, creates ACTIVE Period, sets `onboardingDone = true`

### Auth Model Overview

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

Four cron jobs run inside the API process. They are started via `import('./cron')` after the Express server starts listening.

| Schedule (UTC) | Job | Behavior |
|---|---|---|
| `* * * * *` | Notification dispatcher | Every minute, queries all users with `telegramChatId != null` and `onboardingDone = true`. For each user, gets current local time in their `timezone` (IANA). If local time matches `morningNotifyTime` (default `09:00`) and morning notify is enabled, sends morning notification. Same for evening. |
| `55 23 * * *` | Daily snapshot | Upserts DailySnapshot for all active periods. |
| `0 9 * * *` | Debt payment alerts | Finds debts with `dueDay` equal to today or tomorrow. Sends payment alert for each. Fixed 09:00 UTC — not per-user timezone. |
| `5 0 * * *` | Period rollover | Finds active periods with `endDate <= today 00:00 UTC`. Marks COMPLETED, creates new ACTIVE period, sends new period notification. |

### Dedup Mechanism

Notification dedup uses an in-memory `Map<string, Set<string>>` keyed by UTC date string (`YYYY-MM-DD`). The key within the Set is `"userId:type"` (e.g. `"user123:morning"`).

On each write, the previous day's entries are cleared (the Map is replaced when a new date is encountered). This means:
- Dedup persists only within a single process lifetime
- If the API restarts after a notification fires but before the day ends, the notification can be sent again on the next minute tick

For the payment alert cron, the dedup key is `"userId:payment:<debtId>"`, preventing duplicate alerts per debt per day even across multiple cron runs.

### What Each Notification Contains

**Morning notification** (`sendMorningNotification`): s2sToday, s2sDaily, daysLeft, status emoji. Sent with an inline keyboard button linking to the Mini App.

**Evening notification** (`sendEveningNotification`): todaySpent, s2sDaily, remaining or overspent amount.

**Payment alert** (`sendPaymentAlert`): debt title, minPayment, currency, days until due (0 = today, 1 = tomorrow).

**New period notification** (`sendNewPeriodNotification`): new s2sDaily, daysTotal, currency, prevSaved (positive = saved, negative = overspent).

**Deficit alert** (`sendDeficitAlert`): deficit amount and currency. This function exists in `notify.ts` but is never called by any cron job.

---

## 10. Timezone Policy

| Concern | Implementation | Gap |
|---|---|---|
| User timezone storage | IANA string in `User.timezone`, default `"Europe/Moscow"` | No UI to change timezone |
| Cron execution | All cron jobs run on the server in UTC | Server timezone assumed UTC |
| Notification dispatch | Compares current UTC time converted to user's IANA timezone against stored HH:MM string | Firing is per-minute granularity; 1-minute jitter possible |
| Period boundaries | UTC midnight — `new Date(year, month, day)` in Node.js uses local (server) time, which should be UTC on server | If server is not UTC, period boundaries shift |
| `todayExpenses` query | `spentAt >= new Date().setHours(0,0,0,0)` in UTC | Users in UTC+3 whose day ends at 21:00 UTC have their "day" cut off at server midnight, not local midnight |
| DailySnapshot | Fires at 23:55 UTC, captures state for UTC date | Not aligned to any user's local midnight |
| Period rollover | Fires at 00:05 UTC | Users in UTC+3 experience rollover at 03:05 local time — correct; users in UTC-5 experience it at 19:05 local (previous day) |

**Known drift:** Period rollover timing (00:05 UTC) may not align with the user's local midnight. For users significantly west of UTC (e.g. UTC-5), rollover fires during their previous day's evening.

---

## 11. Error Semantics

### HTTP Status Codes Used

| Code | Meaning | When Used |
|---|---|---|
| 200 | OK | Successful GET, successful DELETE (`{ ok: true }`) |
| 201 | Created | Successful POST creating a resource |
| 400 | Bad Request | Invalid input (amount <= 0, missing required fields, no active period) |
| 401 | Unauthorized | Missing or invalid `X-TG-INIT-DATA`, invalid `X-Internal-Key` |
| 404 | Not Found | Resource not found and access confirmed (e.g. expense not found for DELETE) |
| 503 | Service Unavailable | `/health/deep` DB connectivity failure |

### Error Body Format

All error responses use the format:

```json
{ "error": "Human-readable error message", "code": "OPTIONAL_CODE" }
```

The `code` field is not currently used in production handlers; error bodies contain only `{ "error": string }`.

---

## 12. Known Correctness Limitations

These are confirmed gaps between the intended behavior and the actual implementation. They are not bugs to fix immediately but must be understood when debugging or extending the system.

1. **`triggerPayday` is not persisted on the Period.** At dashboard load and cron time, `triggerPayday` is re-derived from `endDate.getDate()` and the current list of Income paydays. If the user changes their paydays between period creation and dashboard load, the income allocation for the current period changes retroactively.

2. **DailySnapshot timing is UTC-based, not per-user timezone.** The 23:55 UTC snapshot captures end-of-UTC-day state. For users in UTC+3, this is 02:55 local time — the snapshot represents the end of the previous local day. Historical reporting built on snapshots will be off by the UTC offset for non-UTC users.

3. **`sendDeficitAlert` is never called.** The function exists in `notify.ts` and is exported, but no cron job or route calls it. The `deficitAlerts` setting in `UserSettings` has no effect.

4. **`weeklyDigest` setting exists but no cron implements it.** `UserSettings.weeklyDigest` is stored and toggleable in the UI, but there is no scheduled job that reads it or sends a weekly digest.

5. **Period rollover at 00:05 UTC may not align with user's local midnight.** For users significantly west of UTC, rollover fires during their prior calendar day. This means the `todayExpenses` query in the new period's first dashboard load will return expenses from the "wrong" local day until the user's local midnight passes.

6. **EF target uses monthly obligations even for prorated periods.** `efTarget = monthlyObligations × targetMonths` always uses the full monthly obligation sum, even when `totalObligations` was prorated down for a shorter-than-full period.

7. **No rate limiting on any endpoint.** All `/tg/*` routes are subject to Telegram's own rate limits at the initData level, but the API itself has no per-user or per-IP rate limiting.

8. **Notification dedup is in-memory only.** A process restart between 09:00 and 09:01 UTC (before `markNotified` runs for all users) can cause duplicate morning notifications. The dedup does not survive restarts.

9. **`X-TG-INIT-DATA` auth_date check: verified correct.** The code does enforce the 3600-second freshness check (`Date.now() / 1000 - authDate > 3600`). This was previously documented as missing — that was incorrect.

10. **Expense import is not implemented.** The `ExpenseSource.IMPORT` enum value and `Expense.source` field exist in the schema, but there is no import route or ingestion pipeline.

11. **Multi-currency is not operational.** The schema supports `Currency.USD` and `User.primaryCurrency`, but the S2S engine performs no currency conversion. Mixing RUB and USD incomes/obligations produces incorrect results.

12. **`UserProfile.avatarUrl` has no write endpoint.** The field exists in the schema but no route allows setting it.

---

## 13. Open Verification Items

Items that need code or behavior verification before they can be promoted to confirmed invariants or known limitations.

1. **Verify rollover cron behavior when user has no incomes.** The cron checks `if (incomes.length === 0) continue;` — confirm this does not leave a partially-completed state (old period marked COMPLETED with no new period created).

2. **Verify `calculatePeriodBounds` behavior for paydays > 28.** Paydays on the 29th, 30th, or 31st are not in the UI picker (`[1, 5, 10, 15, 20, 25]`) but may be reachable via the API. Confirm that `new Date(year, month, 31)` wraps correctly for short months.

3. **Verify `findFirst` tie-breaking if two ACTIVE periods exist.** The query has no `orderBy`. Confirm the Prisma behavior (likely insertion order) and whether this could hide a double-period bug.

4. **Verify deploy.sh steps and image rebuild order** to confirm `NEXT_PUBLIC_API_URL` is baked in at build time correctly in all deployment scenarios.

5. **Verify period rollover behavior when `endDate` is exactly midnight UTC vs. when it is a local midnight offset.** The `calculatePeriodBounds` function uses `new Date(year, month, payday)` which is Node.js local time — confirm server timezone is UTC in production.

6. **Verify the `bot` service entry point and handler list** — the Telegraf bot's route handlers have not been fully documented.

---

## 14. Debugging Guide

### How to Debug a Wrong Dashboard Number

**Problem:** User reports s2sToday or s2sDaily is wrong.

**Steps:**
```bash
# 1. Get active period for user (need userId from DB)
psql $DATABASE_URL -c "
  SELECT id, start_date, end_date, s2s_period, s2s_daily, days_total, is_prorated_start
  FROM \"Period\"
  WHERE user_id = '<userId>' AND status = 'ACTIVE';
"

# 2. Get today's expenses for user (UTC midnight)
psql $DATABASE_URL -c "
  SELECT SUM(amount) as today_total
  FROM \"Expense\"
  WHERE user_id = '<userId>'
    AND spent_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
"

# 3. Get period's total expenses
psql $DATABASE_URL -c "
  SELECT SUM(e.amount) as period_total
  FROM \"Expense\" e
  JOIN \"Period\" p ON e.period_id = p.id
  WHERE p.user_id = '<userId>' AND p.status = 'ACTIVE';
"

# 4. Manually compute expected values:
#    daysLeft = max(1, ceil((endDate - now) / 86400000))
#    periodRemaining = max(0, s2sPeriod - periodTotal)
#    s2sDaily = max(0, round(periodRemaining / daysLeft))
#    s2sToday = max(0, s2sDaily - todayTotal)
```

### How to Debug a Wrong Period Rollover

**Problem:** Period did not roll over at expected time, or wrong dates on new period.

**Steps:**
```bash
# 1. Check API logs for rollover output
docker logs pfm-api 2>&1 | grep "Cron.*ollover"

# 2. Check for expired periods that weren't rolled over
psql $DATABASE_URL -c "
  SELECT id, user_id, end_date, status
  FROM \"Period\"
  WHERE status = 'ACTIVE'
    AND end_date <= now();
"

# 3. Check cron.ts Cron 4 is scheduled (in logs at startup)
docker logs pfm-api 2>&1 | grep "Scheduled"
```

### How to Debug a Wrong Notification Timing

**Problem:** Morning notification not sent, or sent at wrong time.

**Steps:**
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

# 3. Manually verify what time it is in user's timezone right now
node -e "
  console.log(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date()));
"

# 4. Check for dedup issues (process restart after notification time)
docker logs pfm-api 2>&1 | grep "morning\|evening" | tail -20
```

### How to Debug s2sToday Discrepancy Near Midnight

**Problem:** s2sToday resets unexpectedly near midnight UTC.

**Root cause candidates:**
- `todayExpenses` query uses UTC midnight: `new Date().setHours(0,0,0,0)`. When UTC midnight passes, expenses from "yesterday local time" are no longer counted in today's total.
- `daysLeft` decrements at UTC midnight, which may not match user's local midnight.

**Steps:**
```bash
# 1. Check what UTC time it is on the server
docker exec pfm-api node -e "console.log(new Date().toISOString())"

# 2. Check user's local time vs UTC
# If the user is UTC+3 and it's 23:00-00:00 UTC, they see a "day change" at their 02:00 local
```

### How to Debug s2sStatus Discrepancy

**Problem:** Color/status on dashboard doesn't match expected.

**Logic (from `index.ts` dashboard handler):**
```
if (period.s2sPeriod <= 0)              → DEFICIT
else if (todayTotal > dynamicS2sDaily)  → OVERSPENT
else if (s2sToday / dynamicS2sDaily <= 0.3 && dynamicS2sDaily > 0) → WARNING
else                                    → OK
```

Note: The frontend `s2sColor()` function in `MiniApp.tsx` independently recomputes color from `s2sToday / s2sDaily`. It does not use the API's `s2sStatus` field for color. The two implementations should agree but are logically separate.

### Useful curl Commands

```bash
# Health check
curl https://mytodaylimit.ru/api/health

# Deep health (DB connectivity)
curl https://mytodaylimit.ru/api/health/deep

# Dashboard (requires initData — use only in dev with X-TG-DEV)
curl -H "X-TG-DEV: 12345" http://localhost:3002/tg/dashboard
```
