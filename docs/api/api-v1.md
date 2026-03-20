---
title: "PFM Bot — API Reference v1"
document_type: Normative
status: "Active — Partial (error model pending)"
source_of_truth: "YES — for API contract"
verified_against_code: Partial
last_updated: "2026-03-20"
---

# PFM Bot — API Reference v1

> Base URL: `https://mytodaylimit.ru/api`
> All monetary values are integers in **minor units** (kopecks for RUB, cents for USD).
> Example: 150000 = 1500.00 ₽

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Calculation Caveats](#2-calculation-caveats)
3. [Error Format](#3-error-format)
4. [Error Codes](#4-error-codes)
5. [PATCH Semantics](#5-patch-semantics)
6. [Common Types](#6-common-types)
7. [Health](#7-health)
8. [Onboarding](#8-onboarding)
9. [Dashboard](#9-dashboard)
10. [Expenses](#10-expenses)
11. [Periods](#11-periods)
12. [Incomes](#12-incomes)
13. [Obligations](#13-obligations)
14. [Debts](#14-debts)
15. [Me (Profile, Settings, Plan)](#15-me-profile-settings-plan)
16. [Billing](#16-billing)
17. [Internal Routes](#17-internal-routes)
18. [Auth Appendix](#18-auth-appendix)
19. [Open Issues](#19-open-issues)

---

## 1. Authentication

### Telegram Mini App (X-TG-INIT-DATA)

All `/tg/*` routes require this header:

```
X-TG-INIT-DATA: <Telegram WebApp initData string>
```

The value is the URL-encoded `initData` string injected by Telegram into `window.Telegram.WebApp.initData`. The API validates it using HMAC-SHA256:

```
secretKey  = HMAC-SHA256("WebAppData", BOT_TOKEN)
checkHash  = HMAC-SHA256(secretKey, sorted_data_check_string)
```

**auth_date freshness check (implemented 2026-03-20):** The API rejects requests where `Date.now()/1000 - auth_date > 3600` (older than 1 hour). Returns `401` with `{ "error": "Stale init data" }`.

Returns `401` if header is missing, hash is invalid, or auth_date is stale.

On first authenticated request, the API automatically creates a User record for the Telegram user.

### Internal (X-Internal-Key)

All `/internal/*` routes require:

```
X-Internal-Key: <ADMIN_KEY env var value>
```

Returns `401` if missing or wrong. Used by the bot service only.

### Dev bypass (non-production only)

When `NODE_ENV !== 'production'`, the following header skips HMAC validation:

```
X-TG-DEV: <telegramId as integer string>
```

**This header is blocked in production.**

---

## 2. Calculation Caveats

> For full formula details see: [formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md)

### Live vs. stored s2sDaily

Routes that return `s2sToday` or `s2sDaily` — specifically `GET /tg/dashboard` and the `S2SResult` type — use **live calculation** on every request, not the `period.s2sDaily` stored in the database.

The live formula: `s2sDaily = round((s2sPeriod - totalPeriodSpent) / daysLeft)`

This implements carry-over: unspent budget from previous days rolls forward automatically.

The `period.s2sDaily` column in the DB is a snapshot taken at period creation and at recalculation. It is **not** what the dashboard returns.

### Expense scoping

`GET /tg/expenses` (paginated) scopes to the **current ACTIVE period only**. It does not return all-time expenses.

### No idempotency key for expenses

`POST /tg/expenses` has no idempotency key. Retrying a failed request will create a duplicate expense. Known gap — see [Open Issues](#19-open-issues).

---

## 3. Error Format

**Current format (implemented):**

```json
{
  "error": "Human-readable error message"
}
```

**Target format (not yet implemented):**

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_CODE",
  "requestId": "uuid"
}
```

The `code` field is absent in the current implementation. `requestId` is not implemented.

Common HTTP status codes:

| Status | Meaning |
|---|---|
| 400 | Bad request — missing or invalid fields |
| 401 | Unauthorized — missing, invalid, or stale auth header |
| 404 | Resource not found (ownership verified) |
| 500 | Unhandled server error |
| 502 | Upstream error (Telegram Bot API unreachable) |
| 503 | Service unavailable (DB down, on `/health/deep`) |

---

## 4. Error Codes

These are the **target** machine-readable codes. They are not yet returned by the API (field `code` is missing from current error responses).

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth header |
| `INVALID_INIT_DATA` | 401 | HMAC hash mismatch |
| `STALE_INIT_DATA` | 401 | auth_date older than 1 hour |
| `NO_ACTIVE_PERIOD` | 400 | Operation requires an active period |
| `NOT_FOUND` | 404 | Resource not found or not owned by user |
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `INVALID_AMOUNT` | 400 | Amount field is missing, not a number, or ≤ 0 |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## 5. PATCH Semantics

### PATCH /tg/incomes/:id

**Allowed fields:** `title`, `amount`, `paydays`, `currency`, `frequency`, `isActive`

**Forbidden fields:** `id`, `userId`, `createdAt`, `updatedAt` (silently ignored by Prisma)

**Validation:**
- `amount` must be > 0 if provided
- `paydays` must be non-empty array of integers 1–31 if provided

### PATCH /tg/obligations/:id

**Allowed fields:** `title`, `amount`, `type`, `dueDay`, `isActive`

**Forbidden fields:** `id`, `userId`, `createdAt`, `updatedAt`

**Validation:**
- `dueDay` must be 1–31 or null if provided

### PATCH /tg/debts/:id

**Allowed fields:** `title`, `type`, `balance`, `apr`, `minPayment`, `dueDay`

**Forbidden fields (explicitly blocked by whitelist):** `isFocusDebt`, `isPaidOff`, `paidOffAt`, `id`, `userId`

**Note:** `isFocusDebt` cannot be set directly via PATCH. Focus debt assignment is managed automatically (highest APR, or reassigned on delete/payoff).

**Validation:**
- `balance` must be > 0 if provided
- `apr` must be 0–1 decimal fraction if provided
- `minPayment` must be ≥ 0 if provided

### PATCH /tg/me/settings

**Allowed fields:** `morningNotifyTime`, `eveningNotifyTime`, `morningNotifyEnabled`, `eveningNotifyEnabled`, `paymentAlerts`, `deficitAlerts`, `weeklyDigest`

**Note on weeklyDigest:** The field is accepted and stored, but **no cron job or handler sends a weekly digest**. Setting this to `true` has no effect in the current implementation.

---

## 6. Common Types

### Currency

```typescript
type Currency = "RUB" | "USD"
```

### S2SResult

Returned by `POST /tg/onboarding/complete` and `POST /tg/periods/recalculate`.

> **Note:** `s2sDaily` and `s2sToday` in this struct are computed live, not read from DB. See [Section 2](#2-calculation-caveats).

```typescript
interface S2SResult {
  // Period-level breakdown
  totalIncome: number;          // kopecks — income attributed to this period
  totalObligations: number;     // kopecks — fixed monthly costs (prorated if needed)
  totalDebtPayments: number;    // kopecks — sum of debt minimum payments
  avalanchePool: number;        // kopecks — extra allocation to focus debt
  efContribution: number;       // kopecks — amount going to emergency fund
  reserve: number;              // kopecks — 10% buffer (reduced to 5%/0 if tight)
  residual: number;             // kopecks — raw s2sPeriod before max(0) clamp
  s2sPeriod: number;            // kopecks — total safe to spend for the entire period

  // Daily metrics
  daysTotal: number;            // total days in period
  daysLeft: number;             // days remaining including today
  daysElapsed: number;          // days since period start
  s2sDaily: number;             // kopecks — per-day limit (carry-over adjusted, LIVE)
  s2sToday: number;             // kopecks — remaining today after expenses (LIVE)

  // Status
  status: "OK" | "WARNING" | "OVERSPENT" | "DEFICIT";
  s2sColor: "green" | "orange" | "red";

  // Convenience
  periodSpent: number;          // kopecks — total expenses in period so far
  periodRemaining: number;      // kopecks — s2sPeriod - periodSpent (clamped to 0)
}
```

### Period

```typescript
interface Period {
  id: string;                   // CUID
  userId: string;
  startDate: string;            // ISO 8601
  endDate: string;              // ISO 8601
  totalIncome: number;          // kopecks
  totalObligations: number;     // kopecks
  totalDebtPayments: number;    // kopecks
  efContribution: number;       // kopecks
  reserve: number;              // kopecks
  s2sPeriod: number;            // kopecks
  s2sDaily: number;             // kopecks (snapshot at period creation — NOT the live value)
  status: "ACTIVE" | "COMPLETED" | "DEFICIT";
  daysTotal: number;
  currency: Currency;
  isProratedStart: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Income

```typescript
interface Income {
  id: string;
  userId: string;
  title: string;
  amount: number;               // kopecks per month (full period amount)
  currency: Currency;
  frequency: "MONTHLY" | "BIWEEKLY" | "WEEKLY" | "IRREGULAR";
  paydays: number[];            // days of month, e.g. [15] or [5, 20]
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Obligation

```typescript
interface Obligation {
  id: string;
  userId: string;
  title: string;
  type: "RENT" | "UTILITIES" | "SUBSCRIPTION" | "TELECOM" | "INSURANCE" | "ENVELOPE" | "OTHER";
  amount: number;               // kopecks per month
  currency: Currency;
  dueDay: number | null;        // day of month payment is due, 1–31
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Debt

```typescript
interface Debt {
  id: string;
  userId: string;
  title: string;
  type: "CREDIT" | "MORTGAGE" | "CREDIT_CARD" | "CAR_LOAN" | "PERSONAL_LOAN" | "OTHER";
  balance: number;              // kopecks — current remaining balance
  originalAmount: number | null; // kopecks — balance at time of creation
  apr: number;                  // decimal fraction, e.g. 0.189 = 18.9%
  minPayment: number;           // kopecks per month
  currency: Currency;
  dueDay: number | null;
  isFocusDebt: boolean;         // receives extra avalanche payment
  isPaidOff: boolean;
  paidOffAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Expense

```typescript
interface Expense {
  id: string;
  userId: string;
  periodId: string;
  amount: number;               // kopecks
  currency: Currency;
  note: string | null;
  source: "MANUAL" | "IMPORT";
  spentAt: string;              // ISO 8601
  createdAt: string;
}
```

### EmergencyFund

```typescript
interface EmergencyFund {
  id: string;
  userId: string;
  currentAmount: number;        // kopecks
  targetMonths: number;         // default 3
  currency: Currency;
  updatedAt: string;
}
```

### Subscription

```typescript
interface Subscription {
  id: string;
  userId: string;
  planCode: string;             // "PRO"
  status: "ACTIVE" | "CANCELLED" | "EXPIRED";
  starsPrice: number;           // Telegram Stars amount
  telegramChargeId: string | null;
  currentPeriodStart: string;   // ISO 8601
  currentPeriodEnd: string;     // ISO 8601
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### UserSettings

```typescript
interface UserSettings {
  id: string;
  userId: string;
  morningNotifyTime: string;    // "HH:MM", default "09:00"
  eveningNotifyTime: string;    // "HH:MM", default "21:00"
  morningNotifyEnabled: boolean; // default true
  eveningNotifyEnabled: boolean; // default true
  paymentAlerts: boolean;       // default true
  deficitAlerts: boolean;       // default true
  weeklyDigest: boolean;        // default false — DEAD SETTING: stored but no handler sends digest
  createdAt: string;
  updatedAt: string;
}
```

---

## 7. Health

### GET /health

**Stability:** Stable

No authentication required.

**Response 200:**
```json
{
  "ok": true,
  "timestamp": "2026-03-20T10:00:00.000Z"
}
```

---

### GET /health/deep

**Stability:** Stable

No authentication required. Runs `SELECT 1` against the database.

**Response 200:**
```json
{
  "ok": true,
  "db": true,
  "timestamp": "2026-03-20T10:00:00.000Z"
}
```

**Response 503:**
```json
{
  "ok": false,
  "db": false,
  "error": "Error details"
}
```

---

## 8. Onboarding

The onboarding flow is a 5-step sequence. Steps 1–4 can be called in any order and are idempotent (each step deletes and recreates its data). Step 5 (`/complete`) creates the first Period and must be called last.

### GET /tg/onboarding/status

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

**Response 200:**
```json
{ "onboardingDone": false }
```

---

### POST /tg/onboarding/income

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Deletes all existing incomes for the user, then creates one new income record. Also updates `user.primaryCurrency`.

**Request body:**
```typescript
{
  amount: number;               // kopecks, required, > 0
  paydays: number[];            // required, non-empty, days of month e.g. [15] or [5, 20]
  currency?: Currency;          // default "RUB"
  title?: string;               // default "Основной доход"
}
```

**Response 200:** `Income` object

**Example:**
```json
// Request
POST /tg/onboarding/income
{
  "amount": 15000000,
  "paydays": [5, 20],
  "currency": "RUB",
  "title": "Зарплата"
}

// Response
{
  "id": "cm8abc123",
  "userId": "cm8user456",
  "title": "Зарплата",
  "amount": 15000000,
  "currency": "RUB",
  "frequency": "MONTHLY",
  "paydays": [5, 20],
  "isActive": true,
  "createdAt": "2026-03-20T10:00:00.000Z",
  "updatedAt": "2026-03-20T10:00:00.000Z"
}
```

---

### POST /tg/onboarding/obligations

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Replaces all obligations. Passing an empty array clears all obligations.

**Request body:**
```typescript
{
  obligations: Array<{
    title: string;
    type: ObligationType;       // default "OTHER"
    amount: number;             // kopecks
    dueDay?: number;            // day of month, 1–31
  }>;
}
```

**Response 200:** `Obligation[]` — all current obligations after replace

---

### POST /tg/onboarding/debts

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Replaces all debts. Sorts by APR descending; highest APR debt gets `isFocusDebt: true`.

**Request body:**
```typescript
{
  debts: Array<{
    title: string;
    type: DebtType;             // default "OTHER"
    balance: number;            // kopecks
    apr: number;                // decimal, e.g. 0.189
    minPayment: number;         // kopecks per month
    dueDay?: number;
  }>;
}
```

**Response 200:** `Debt[]` — created debts in APR-descending order

---

### POST /tg/onboarding/ef

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Upserts emergency fund record.

**Request body:**
```typescript
{
  currentAmount?: number;       // kopecks, default 0
  targetMonths?: number;        // default 3
  currency?: Currency;          // default "RUB"
}
```

**Response 200:** `EmergencyFund` object

---

### POST /tg/onboarding/complete

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

> **Calculation note:** Creates first Period with S2SResult stored. The `s2sDaily` stored in the Period record is a snapshot; subsequent dashboard reads recalculate it live.

Requires at least one active income. Closes any existing ACTIVE period (marks it COMPLETED), calculates new period bounds and S2S, creates the first ACTIVE period, sets `user.onboardingDone = true`.

**Request body:** none

**Response 200:**
```typescript
{
  period: Period;
  s2s: S2SResult;
}
```

**Example:**
```json
// Response
{
  "period": {
    "id": "cm8period789",
    "userId": "cm8user456",
    "startDate": "2026-03-20T00:00:00.000Z",
    "endDate": "2026-04-05T00:00:00.000Z",
    "totalIncome": 7500000,
    "totalObligations": 2000000,
    "totalDebtPayments": 500000,
    "efContribution": 100000,
    "reserve": 490000,
    "s2sPeriod": 4410000,
    "s2sDaily": 275625,
    "status": "ACTIVE",
    "daysTotal": 16,
    "currency": "RUB",
    "isProratedStart": true
  },
  "s2s": {
    "totalIncome": 7500000,
    "totalObligations": 2000000,
    "totalDebtPayments": 500000,
    "avalanchePool": 0,
    "efContribution": 100000,
    "reserve": 490000,
    "residual": 4410000,
    "s2sPeriod": 4410000,
    "daysTotal": 16,
    "daysLeft": 16,
    "daysElapsed": 1,
    "s2sDaily": 275625,
    "s2sToday": 275625,
    "status": "OK",
    "s2sColor": "green",
    "periodSpent": 0,
    "periodRemaining": 4410000
  }
}
```

---

## 9. Dashboard

### GET /tg/dashboard

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

> **Calculation note:** `s2sDaily` and `s2sToday` are computed **live** on every request using carry-over formula. They are not read from `period.s2sDaily`. See [Section 2](#2-calculation-caveats).

Returns the main dashboard payload. If user has no active period, returns zeroed fields.

**Response 200:**
```typescript
{
  onboardingDone: boolean;
  s2sToday: number;             // kopecks — remaining budget for today (LIVE)
  s2sDaily: number;             // kopecks — per-day limit (carry-over adjusted, LIVE)
  s2sStatus: "OK" | "WARNING" | "OVERSPENT" | "DEFICIT";
  daysLeft: number;
  daysTotal: number;
  periodStart: string;          // ISO 8601
  periodEnd: string;            // ISO 8601
  periodSpent: number;          // kopecks — total expenses in current period
  s2sPeriod: number;            // kopecks — total safe to spend for period
  todayExpenses: Expense[];     // today's expenses, sorted by spentAt desc
  todayTotal: number;           // kopecks — sum of todayExpenses
  focusDebt: {
    id: string;
    title: string;
    apr: number;
    balance: number;
    minPayment: number;
    type: DebtType;
  } | null;
  debts: Array<{
    id: string;
    title: string;
    apr: number;
    balance: number;
    minPayment: number;
    type: DebtType;
    isFocusDebt: boolean;
  }>;
  emergencyFund: {
    currentAmount: number;      // kopecks
    targetAmount: number;       // kopecks — obligations_sum × targetMonths
  } | null;
  currency: Currency;
}
```

**S2S status logic:**

| Status | Condition |
|---|---|
| `DEFICIT` | `s2sPeriod <= 0` |
| `OVERSPENT` | `todayExpenses > s2sDaily` |
| `WARNING` | `s2sToday / s2sDaily <= 0.30` |
| `OK` | None of the above |

**Notes:**

- `s2sDaily` is recalculated dynamically on every request: `round((s2sPeriod - totalPeriodSpent) / daysLeft)`. This implements carry-over — unspent budget rolls forward.
- `daysLeft` uses `ceil((endDate - now) / 86400000)`, clamped to minimum 1.
- When no active period: all numeric fields are 0, all arrays are empty.

---

## 10. Expenses

### POST /tg/expenses

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Creates an expense in the current active period.

> **Known gap:** No idempotency key. Retrying a failed request creates a duplicate. See [Open Issues](#19-open-issues).

**Request body:**
```typescript
{
  amount: number;               // kopecks, required, > 0
  note?: string;                // optional description
}
```

**Response 201:** `Expense` object

**Errors:**
- `400 { "error": "Invalid amount" }` — amount missing, not a number, or ≤ 0
- `400 { "error": "No active period. Complete onboarding first." }` — no ACTIVE period found

---

### GET /tg/expenses/today

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Returns all expenses with `spentAt >= today 00:00:00` (server UTC time), sorted by `spentAt` descending.

> **Timezone note:** "Today" is UTC midnight, not the user's local midnight. For a Moscow user (UTC+3), expenses between 00:00–03:00 Moscow time appear as "yesterday."

**Response 200:** `Expense[]`

---

### DELETE /tg/expenses/:id

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Deletes an expense. Verifies ownership (user must own the expense).

**Response 200:**
```json
{ "ok": true }
```

**Errors:**
- `404` — expense not found or doesn't belong to user

---

### GET /tg/expenses

**Stability:** Current Behavior

**Auth:** X-TG-INIT-DATA

Returns paginated expense list **for the current active period only** (not all-time).

**Query parameters:**
- `limit` — integer, max 200, default 50
- `offset` — integer, default 0

**Response 200:**
```typescript
{
  expenses: Expense[];
  total: number;                // total count (for pagination)
  periodId: string | null;      // active period ID, or null if none
}
```

---

## 11. Periods

### GET /tg/periods/current

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Returns the current ACTIVE period including all its expenses.

**Response 200:** `Period & { expenses: Expense[] }` or `null` if no active period

---

### GET /tg/periods/last-completed

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Returns a summary of the most recently completed period.

**Response 200:**
```typescript
{
  id: string;
  startDate: string;
  endDate: string;
  daysTotal: number;
  s2sPeriod: number;            // kopecks — planned budget
  s2sDaily: number;             // kopecks
  totalSpent: number;           // kopecks — actual total expenses
  saved: number;                // kopecks — s2sPeriod - totalSpent (may be negative)
  overspentDays: number;        // count of DailySnapshot records with isOverspent=true
  currency: Currency;
  topExpenses: Array<{
    amount: number;
    note: string | null;
    spentAt: string;
  }>;                           // top 5 by amount desc
}
```

Returns `null` if no completed period exists.

---

### POST /tg/periods/recalculate

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

> **Calculation note:** Recomputes period bounds using `allPaydays` from current active incomes, then recalculates S2S. Updates the `Period` record in DB.

Recalculates the active period's S2S using current income, obligations, debts, and EF. Also recomputes period bounds from current paydays. Useful after editing income or payday settings.

**Request body:** none

**Response 200:**
```typescript
{
  ok: true;
  s2s: S2SResult;
}
```

**Errors:**
- `400 { "error": "No active period or income" }` — no active period or no active incomes

---

## 12. Incomes

### GET /tg/incomes

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Returns all income records for the user, sorted by `createdAt` descending.

**Response 200:** `Income[]`

---

### POST /tg/incomes

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Creates a new income record.

**Request body:**
```typescript
{
  title: string;                // required
  amount: number;               // kopecks, required
  paydays: number[];            // required
  currency?: Currency;          // default "RUB"
  frequency?: IncomeFrequency;  // default "MONTHLY"
}
```

**Response 201:** `Income` object

**Errors:**
- `400` — title, amount, or paydays missing

---

### PATCH /tg/incomes/:id

**Stability:** Provisional

**Auth:** X-TG-INIT-DATA

Partially updates an income record. See [PATCH Semantics](#5-patch-semantics) for allowed fields.

**Response 200:** Updated `Income` object

**Errors:**
- `404` — income not found or not owned by user

---

### DELETE /tg/incomes/:id

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

**Response 200:** `{ "ok": true }`

**Errors:**
- `404`

---

## 13. Obligations

### GET /tg/obligations

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Returns all obligations, sorted by `createdAt` descending.

**Response 200:** `Obligation[]`

---

### POST /tg/obligations

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

**Request body:**
```typescript
{
  title: string;                // required
  amount: number;               // kopecks, required
  type?: ObligationType;        // default "OTHER"
  dueDay?: number;              // day of month
}
```

**Response 201:** `Obligation` object

---

### PATCH /tg/obligations/:id

**Stability:** Provisional

**Auth:** X-TG-INIT-DATA

See [PATCH Semantics](#5-patch-semantics) for allowed fields.

**Response 200:** Updated `Obligation`

---

### DELETE /tg/obligations/:id

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

**Response 200:** `{ "ok": true }`

---

## 14. Debts

### GET /tg/debts

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Returns active (non-paid-off) debts sorted by `apr` descending.

**Response 200:** `Debt[]`

---

### POST /tg/debts

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Creates a new debt. If no focus debt exists, the new debt becomes the focus debt automatically.

**Request body:**
```typescript
{
  title: string;                // required
  balance: number;              // kopecks, required
  apr: number;                  // required, decimal fraction e.g. 0.189
  minPayment: number;           // kopecks, required
  type?: DebtType;              // default "OTHER"
  dueDay?: number;
}
```

**Response 201:** `Debt` object

---

### PATCH /tg/debts/:id

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

See [PATCH Semantics](#5-patch-semantics) for allowed/forbidden fields. `isFocusDebt` cannot be set via PATCH.

**Response 200:** Updated `Debt`

---

### DELETE /tg/debts/:id

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Deletes debt. If the deleted debt was the focus debt, reassigns focus to next highest-APR debt.

**Response 200:** `{ "ok": true }`

---

### POST /tg/debts/:id/payment

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Records a payment on a debt. Reduces `balance` by `amount`. If balance reaches 0, sets `isPaidOff: true`, `isFocusDebt: false`, and reassigns focus to next debt.

**Request body:**
```typescript
{
  amount: number;               // kopecks, required, > 0
  isExtra?: boolean;            // default false — marks as extra (avalanche) payment
}
```

**Response 200:**
```typescript
{
  ok: true;
  payment: {
    id: string;
    debtId: string;
    amount: number;             // kopecks
    isExtra: boolean;
    paidAt: string;             // ISO 8601
  };
  newBalance: number;           // kopecks — balance after payment
}
```

---

### GET /tg/debts/avalanche-plan

**Stability:** Provisional

**Auth:** X-TG-INIT-DATA

Returns the avalanche repayment plan for all active debts. Estimates monthly extra from current period: `round(s2sPeriod × 0.10 / (daysTotal / 30))`.

**Response 200:**
```typescript
{
  items: Array<{
    debtId: string;
    title: string;
    balance: number;            // kopecks
    apr: number;
    minPayment: number;         // kopecks
    isFocus: boolean;
    order: number;              // 1 = first to pay off
    estimatedMonths: number;
    totalInterest: number;      // kopecks
  }>;
  totalDebt: number;            // kopecks
  totalMinPayments: number;     // kopecks
  estimatedDebtFreeMonths: number; // sequential sum (simplified)
  estimatedTotalInterest: number;  // kopecks
}
```

---

## 15. Me (Profile, Settings, Plan)

### GET /tg/me/profile

**Stability:** Provisional

**Auth:** X-TG-INIT-DATA

Returns the full user record including profile and subscription.

**Response 200:** `User & { profile: UserProfile | null, subscription: Subscription | null }`

---

### GET /tg/me/settings

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

**Response 200:** `UserSettings` object

---

### PATCH /tg/me/settings

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

Upserts user settings. Only the following fields are accepted (others are silently ignored).

> **Dead setting:** `weeklyDigest` is accepted and stored, but no cron job sends a weekly digest. Setting it to `true` has no observable effect.

```typescript
{
  morningNotifyTime?: string;       // "HH:MM"
  eveningNotifyTime?: string;       // "HH:MM"
  morningNotifyEnabled?: boolean;
  eveningNotifyEnabled?: boolean;
  paymentAlerts?: boolean;
  deficitAlerts?: boolean;
  weeklyDigest?: boolean;           // DEAD — stored but no handler
}
```

**Response 200:** Updated `UserSettings`

---

### GET /tg/me/plan

**Stability:** Stable

**Auth:** X-TG-INIT-DATA

**Response 200:**
```typescript
{
  plan: "PRO" | "FREE";
  godMode: boolean;
  subscription: Subscription | null;
}
```

A user is considered PRO if:
- `user.godMode === true`, OR
- `subscription.status === "ACTIVE"` AND `subscription.currentPeriodEnd > now`

---

## 16. Billing

### POST /tg/billing/pro/checkout

**Stability:** Provisional

**Auth:** X-TG-INIT-DATA

Creates a Telegram Stars invoice link for the PRO subscription (100 Stars / month). Calls the Telegram Bot API `createInvoiceLink` method.

**Request body:** none

**Response 200:**
```json
{ "invoiceUrl": "https://t.me/$invoice..." }
```

**Errors:**
- `400 { "error": "Already PRO" }` — user already has an active PRO subscription
- `502` — Telegram Bot API returned an error
- `503` — BOT_TOKEN not configured

**Flow after payment:**
1. Telegram sends a `successful_payment` update to the bot
2. Bot calls `POST /internal/activate-subscription` with `telegramId`, `chargeId`, `amount`
3. API creates/updates the `Subscription` record and creates a `PaymentEvent`

---

## 17. Internal Routes

These routes are only for bot-to-API communication and are protected by `X-Internal-Key`.

### POST /internal/store-chat-id

**Stability:** Stable

Stores the user's `telegramChatId` (required for push notifications). Called by the bot when it receives any message from a user.

**Request body:**
```typescript
{
  telegramId: string | number;  // required
  chatId: string | number;      // required
}
```

**Response 200:** `{ "ok": true }`

**Errors:**
- `400` — missing telegramId or chatId

---

### POST /internal/activate-subscription

**Stability:** Stable

Activates (or renews) a PRO subscription after a successful Telegram Stars payment.

**Request body:**
```typescript
{
  telegramId: string | number;  // required
  chargeId: string;             // Telegram payment charge ID, required
  amount: number;               // Stars amount, required
}
```

**Response 200:**
```typescript
{
  ok: true;
  subscription: Subscription;
}
```

**Errors:**
- `404 { "error": "User not found" }` — no user with this telegramId

**Behavior:**
- Upserts `Subscription` record (`status: ACTIVE`, `currentPeriodEnd = now + 30 days`)
- Creates `PaymentEvent` record with `eventType: "subscription_activated"`

---

## 18. Auth Appendix

| Route Group | Actor | Auth Method | Prod-Safe | Dev Bypass Available | Notes |
|-------------|-------|-------------|-----------|----------------------|-------|
| `GET /health`, `GET /health/deep` | Anyone | None | Yes | N/A | Public |
| `GET /tg/onboarding/status` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `POST /tg/onboarding/*` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `GET /tg/dashboard` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `POST /tg/expenses`, `GET /tg/expenses*`, `DELETE /tg/expenses/:id` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `GET /tg/periods/*`, `POST /tg/periods/recalculate` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `GET /tg/incomes`, `POST /tg/incomes`, `PATCH /tg/incomes/:id`, `DELETE /tg/incomes/:id` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `GET /tg/obligations`, `POST /tg/obligations`, `PATCH /tg/obligations/:id`, `DELETE /tg/obligations/:id` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `GET /tg/debts*`, `POST /tg/debts*`, `PATCH /tg/debts/:id`, `DELETE /tg/debts/:id` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `GET /tg/me/*`, `PATCH /tg/me/settings` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `POST /tg/billing/pro/checkout` | Telegram user | X-TG-INIT-DATA | Yes | Yes (dev only) | |
| `POST /internal/store-chat-id` | Bot service | X-Internal-Key | Yes | No | Never proxied externally |
| `POST /internal/activate-subscription` | Bot service | X-Internal-Key | Yes | No | Never proxied externally |

**Dev bypass details:** The `X-TG-DEV: <telegramId>` header bypasses HMAC validation entirely. It is guarded by `if (process.env.NODE_ENV !== 'production')` and is unreachable in production where `NODE_ENV=production` is set in the Dockerfile.

---

## 19. Open Issues

These items were previously inline TODO/VERIFY comments. Tracked here for visibility.

| ID | Route | Issue | Priority |
|----|-------|-------|----------|
| OI-001 | `GET /tg/me/profile` | Exact fields returned not verified against code — `# TODO: verify exact fields returned` | Low |
| OI-002 | `POST /tg/expenses` | No idempotency key — retrying creates a duplicate expense | Medium |
| OI-003 | All `/tg/*` | No rate limiting on any endpoint | High |
| OI-004 | `PATCH /tg/me/settings` | `weeklyDigest` field is a dead setting — no handler sends the digest | Medium |
| OI-005 | Error format | `code` and `requestId` fields not implemented — current format is `{ error: string }` only | Medium |
| OI-006 | `GET /tg/expenses` | Scoped to active period only — all-time expense history not exposed | Low |
