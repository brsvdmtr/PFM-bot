---
title: "API Reference v1"
document_type: Normative
status: Active
source_of_truth: YES
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ../system/formulas-and-calculation-policy.md
    relation: "calculation semantics"
  - path: openapi/api-v1.yaml
    relation: "machine-readable spec"
---

# API Reference v1

> **Base URL:** `https://mytodaylimit.ru`
> All monetary values are integers in **minor units** (kopecks for RUB, cents for USD).
> Example: `150000` = 1 500.00 ₽

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Request/Response Format](#3-requestresponse-format)
4. [Error Model](#4-error-model)
5. [Contract Stability Levels](#5-contract-stability-levels)
6. [PATCH Semantics](#6-patch-semantics)
7. [Calculation Semantics](#7-calculation-semantics)
8. [Common Types](#8-common-types)
9. [Health](#9-health)
10. [Onboarding](#10-onboarding)
11. [Dashboard](#11-dashboard)
12. [Expenses](#12-expenses)
13. [Periods](#13-periods)
14. [Incomes](#14-incomes)
15. [Obligations](#15-obligations)
16. [Debts](#16-debts)
17. [User](#17-user)
18. [Billing](#18-billing)
19. [Internal Routes](#19-internal-routes)
20. [Auth/Security Appendix](#20-authsecurity-appendix)
21. [Known Caveats](#21-known-caveats)

---

## 1. Overview

The PFM Bot API is an Express.js server that backs the Telegram Mini App and bot. It listens on port 3002 internally; nginx proxies external HTTPS traffic at `https://mytodaylimit.ru` to the container.

**Base URL:** `https://mytodaylimit.ru`

**API versioning:** There is no URL prefix versioning (e.g. `/api/v1`). The current contract version is v1. Breaking changes will be tracked in this document.

**Nginx routing:**
- `/health*` → api:3002
- `/tg/*` → api:3002
- `/internal/*` → api:3002 (not externally accessible in prod nginx config)
- All other paths → web frontend

---

## 2. Authentication

### Telegram WebApp (x-tg-init-data)

All `/tg/*` routes require this header:

```
x-tg-init-data: <Telegram WebApp initData string>
```

The value is the URL-encoded `initData` string injected by Telegram into `window.Telegram.WebApp.initData`. The API validates it using HMAC-SHA256:

```
secretKey  = HMAC-SHA256("WebAppData", BOT_TOKEN)
checkHash  = HMAC-SHA256(secretKey, sorted_data_check_string)
```

**auth_date freshness check:** The API rejects requests where `Date.now()/1000 - auth_date > 3600` (older than 1 hour). Returns `401` with `{"error": "Stale init data"}`.

Returns `401` if the header is missing, the hash is invalid, or `auth_date` is stale.

On first authenticated request, the API automatically creates a User record for the Telegram user.

### Internal (x-internal-key)

All `/internal/*` routes require:

```
x-internal-key: <ADMIN_KEY env var value>
```

Returns `401` if missing or wrong. Used exclusively by the bot service.

### Dev bypass (non-production only)

When `NODE_ENV !== 'production'`, the following header skips HMAC validation entirely:

```
x-tg-dev: <telegramId as integer string>
```

**This header is blocked in production.** The guard is `if (process.env.NODE_ENV !== 'production')` and `NODE_ENV=production` is set in the production Dockerfile.

---

## 3. Request/Response Format

- All request bodies must be JSON. Set `Content-Type: application/json`.
- All responses are JSON.
- Dates are ISO 8601 strings (e.g. `"2026-03-20T10:00:00.000Z"`).
- Monetary amounts are integers in minor units (kopecks/cents).

---

## 4. Error Model

### Current format (implemented)

```json
{
  "error": "Human-readable error message"
}
```

### Known gaps

- **No `requestId`/`traceId`:** Correlation IDs are not implemented. Planned.
- **No machine-readable error codes:** The `code` field is not present in current responses. Target format (not yet implemented):

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_CODE",
  "requestId": "uuid"
}
```

### HTTP status codes

| Status | When used |
|--------|-----------|
| 400 | Validation failure — missing or invalid fields |
| 401 | Auth failure — missing, invalid, or stale auth header |
| 404 | Resource not found or not owned by user |
| 500 | Unhandled server error |
| 502 | Upstream error — Telegram Bot API unreachable |
| 503 | Service unavailable — DB down (on `/health/deep`), or BOT_TOKEN not configured |

---

## 5. Contract Stability Levels

Each endpoint group is assigned a stability level:

| Level | Meaning |
|-------|---------|
| **Stable** | Contract is finalized. Breaking changes require a new API version. |
| **Provisional** | Functional but shape may change without a major version bump. |
| **Needs Verification** | Implemented but some edge cases are not fully confirmed against code. |

| Endpoint Group | Stability |
|----------------|-----------|
| `/health`, `/health/deep` | Stable |
| `/tg/dashboard` | Stable |
| `/tg/expenses` (CRUD) | Stable |
| `/tg/me/profile`, `/tg/me/settings` | Stable |
| `/tg/me/plan` | Stable |
| `/tg/onboarding/*` | Stable |
| `/tg/periods/current`, `/tg/periods/recalculate` | Stable |
| `/tg/incomes` (CRUD) | Stable |
| `/tg/obligations` (CRUD) | Stable |
| `/tg/debts` (CRUD + payment) | Stable |
| `/tg/billing/pro/checkout` | Provisional |
| `/tg/debts/avalanche-plan` | Provisional |
| `/tg/periods/last-completed` | Needs Verification — some edge cases (overspentDays calculation) not fully confirmed |
| `/internal/*` | Stable |

---

## 6. PATCH Semantics

All `PATCH` endpoints use partial update semantics: only fields present in the request body are updated. Omitted fields are left unchanged. Sending `null` removes optional fields.

Numeric fields `amount`, `balance`, and `minPayment` are `Math.round()`ed before storage.

### PATCH /tg/incomes/:id

**Allowed fields:** `title`, `amount`, `paydays`, `currency`, `frequency`, `isActive`

**Forbidden fields** (silently ignored by ORM): `id`, `userId`, `createdAt`, `updatedAt`

**Validation:**
- `amount` must be > 0 if provided
- `paydays` must be a non-empty array of integers 1–31 if provided

### PATCH /tg/obligations/:id

**Allowed fields:** `title`, `amount`, `type`, `dueDay`, `isActive`

**Forbidden fields:** `id`, `userId`, `createdAt`, `updatedAt`

**Validation:**
- `dueDay` must be 1–31 or null if provided

### PATCH /tg/debts/:id

**Allowed fields:** `title`, `type`, `balance`, `apr`, `minPayment`, `dueDay`

**Forbidden fields (explicitly blocked by whitelist):** `isFocusDebt`, `isPaidOff`, `paidOffAt`, `id`, `userId`

`isFocusDebt` cannot be set directly. Focus debt assignment is managed automatically: highest APR on creation, reassigned on delete or payoff.

**Validation:**
- `balance` must be > 0 if provided
- `apr` must be a decimal fraction 0–1 if provided (e.g. `0.189` = 18.9%)
- `minPayment` must be >= 0 if provided

### PATCH /tg/me/settings

**Allowed fields:** `morningNotifyTime`, `eveningNotifyTime`, `morningNotifyEnabled`, `eveningNotifyEnabled`, `paymentAlerts`, `deficitAlerts`, `weeklyDigest`

**Dead setting:** `weeklyDigest` is accepted and stored but no cron job or handler sends a weekly digest. Setting it to `true` has no observable effect.

---

## 7. Calculation Semantics

> For full formula details see: [formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md)

### s2sToday and s2sDaily are RUNTIME computed

Routes that return `s2sToday` or `s2sDaily` — specifically `GET /tg/dashboard` and `POST /tg/periods/recalculate` — compute these values **live on every request**. They are not read from the `Period.s2sDaily` column in the DB.

Live formula:

```
s2sDaily = round((s2sPeriod - totalPeriodSpent) / daysLeft)
s2sToday = s2sDaily - todaySpent
```

This implements carry-over: unspent budget from previous days rolls forward automatically.

`Period.s2sDaily` in the DB is a snapshot taken at period creation and at recalculation. It reflects the value at that moment, not the current live value.

### daysLeft formula

```
daysLeft = max(1, daysTotal - daysElapsed + 1)
```

where `daysElapsed = ceil((now - startDate) / 86400000)`.

### periodRemaining

```
periodRemaining = max(0, s2sPeriod - totalPeriodSpent)
```

### All amounts are integers

All monetary fields are integers in minor units (kopecks for RUB, cents for USD). No floating-point currency values appear in the API.

---

## 8. Common Types

### Currency

```
"RUB" | "USD"
```

### ObligationType

```
"RENT" | "UTILITIES" | "SUBSCRIPTION" | "TELECOM" | "INSURANCE" | "ENVELOPE" | "OTHER"
```

### DebtType

```
"CREDIT" | "MORTGAGE" | "CREDIT_CARD" | "CAR_LOAN" | "PERSONAL_LOAN" | "OTHER"
```

### IncomeFrequency

```
"MONTHLY" | "BIWEEKLY" | "WEEKLY" | "IRREGULAR"
```

### S2SStatus

```
"OK" | "WARNING" | "OVERSPENT" | "DEFICIT"
```

### S2SResult

Returned by `POST /tg/onboarding/complete` and `POST /tg/periods/recalculate`.

`s2sDaily` and `s2sToday` here are computed live — see [Section 7](#7-calculation-semantics).

```typescript
interface S2SResult {
  totalIncome: number;          // kopecks — income attributed to this period
  totalObligations: number;     // kopecks — fixed monthly costs (prorated if needed)
  totalDebtPayments: number;    // kopecks — sum of debt minimum payments
  avalanchePool: number;        // kopecks — extra allocation to focus debt
  efContribution: number;       // kopecks — emergency fund contribution
  reserve: number;              // kopecks — 10% buffer (reduced to 5%/0 if tight)
  residual: number;             // kopecks — raw s2sPeriod before max(0) clamp
  s2sPeriod: number;            // kopecks — total safe to spend for the entire period

  daysTotal: number;
  daysLeft: number;
  daysElapsed: number;
  s2sDaily: number;             // kopecks — per-day limit, carry-over adjusted (LIVE)
  s2sToday: number;             // kopecks — remaining today after expenses (LIVE)

  status: "OK" | "WARNING" | "OVERSPENT" | "DEFICIT";
  s2sColor: "green" | "orange" | "red";

  periodSpent: number;          // kopecks — total expenses in period so far
  periodRemaining: number;      // kopecks — s2sPeriod - periodSpent, clamped to 0
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
  s2sDaily: number;             // kopecks — SNAPSHOT at period creation, NOT the live value
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
  amount: number;               // kopecks per month
  currency: Currency;
  frequency: IncomeFrequency;
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
  type: ObligationType;
  amount: number;               // kopecks per month
  dueDay: number | null;        // day of month, 1–31
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
  type: DebtType;
  balance: number;              // kopecks — current remaining balance
  apr: number;                  // decimal fraction, e.g. 0.189 = 18.9%
  minPayment: number;           // kopecks per month
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
  note: string | null;
  source: "MANUAL" | "IMPORT";
  spentAt: string;              // ISO 8601
  createdAt: string;
}
```

### UserSettings

```typescript
interface UserSettings {
  id: string;
  userId: string;
  morningNotifyTime: string;    // "HH:MM", default "09:00"
  eveningNotifyTime: string;    // "HH:MM", default "21:00"
  morningNotifyEnabled: boolean;
  eveningNotifyEnabled: boolean;
  paymentAlerts: boolean;
  deficitAlerts: boolean;
  weeklyDigest: boolean;        // DEAD SETTING — stored but no handler sends digest
  createdAt: string;
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
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## 9. Health

### GET /health

**Stability:** Stable
**Auth:** None

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
**Auth:** None

Runs `SELECT 1` against the database to verify connectivity.

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

## 10. Onboarding

The onboarding flow is a 5-step sequence. Steps 1–4 can be called in any order and use replace semantics (each step deletes and recreates its data). Step 5 (`/complete`) creates the first Period and must be called last.

### GET /tg/onboarding/status

**Stability:** Stable
**Auth:** x-tg-init-data

**Response 200:**
```json
{ "onboardingDone": false }
```

---

### POST /tg/onboarding/income

**Stability:** Stable
**Auth:** x-tg-init-data

Deletes ALL existing income records for the user, then creates one new income. Also updates `user.primaryCurrency`. This is replace semantics, not append.

**Request body:**
```json
{
  "amount": 15000000,
  "paydays": [5, 20],
  "currency": "RUB",
  "title": "Зарплата"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | Int (kopecks) | Yes | Must be > 0 |
| `paydays` | Int[] | Yes | Non-empty, days of month 1–31 |
| `currency` | Currency | No | Default: `"RUB"` |
| `title` | string | No | Default: `"Основной доход"` |

**Response 200:** `Income` object

**Errors:**
- `400` — amount missing, not a number, or <= 0; paydays missing or empty

---

### POST /tg/onboarding/obligations

**Stability:** Stable
**Auth:** x-tg-init-data

Replaces all obligations. Passing an empty array clears all obligations.

**Request body:**
```json
{
  "obligations": [
    { "title": "Аренда", "type": "RENT", "amount": 5000000, "dueDay": 1 }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `obligations` | Array | Yes | May be empty to clear all |
| `obligations[].title` | string | Yes | |
| `obligations[].type` | ObligationType | No | Default: `"OTHER"` |
| `obligations[].amount` | Int (kopecks) | Yes | |
| `obligations[].dueDay` | Int | No | Day of month 1–31 |

**Response 200:** `Obligation[]` — all current obligations after replace

---

### POST /tg/onboarding/debts

**Stability:** Stable
**Auth:** x-tg-init-data

Replaces all debts. After creation, debts are sorted by APR descending; the highest-APR debt gets `isFocusDebt: true`.

**Request body:**
```json
{
  "debts": [
    { "title": "Кредит", "type": "CREDIT", "balance": 30000000, "apr": 0.189, "minPayment": 800000 }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `debts[].title` | string | Yes | |
| `debts[].type` | DebtType | No | Default: `"OTHER"` |
| `debts[].balance` | Int (kopecks) | Yes | |
| `debts[].apr` | Float | Yes | Decimal fraction, e.g. 0.189 |
| `debts[].minPayment` | Int (kopecks) | Yes | |
| `debts[].dueDay` | Int | No | |

**Response 200:** `Debt[]` — created debts in APR-descending order

---

### POST /tg/onboarding/ef

**Stability:** Stable
**Auth:** x-tg-init-data

Upserts the emergency fund record.

**Request body:**
```json
{
  "currentAmount": 500000,
  "targetMonths": 3,
  "currency": "RUB"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `currentAmount` | Int (kopecks) | No | Default: 0 |
| `targetMonths` | Int | No | Default: 3 |
| `currency` | Currency | No | Default: `"RUB"` |

**Response 200:** EmergencyFund object (`{id, userId, currentAmount, targetMonths, currency, updatedAt}`)

---

### POST /tg/onboarding/complete

**Stability:** Stable
**Auth:** x-tg-init-data

Finalizes onboarding. Requires at least one active income.

Behavior:
1. Closes any existing ACTIVE period (marks it COMPLETED)
2. Calculates new period bounds from current income paydays
3. Calculates S2S
4. Creates the first ACTIVE period
5. Sets `user.onboardingDone = true`

**Request body:** none

**Response 200:**
```typescript
{
  period: Period;
  s2s: S2SResult;
}
```

**Errors:**
- `400` — no active income found

---

## 11. Dashboard

### GET /tg/dashboard

**Stability:** Stable
**Auth:** x-tg-init-data

Returns the main dashboard payload. `s2sDaily` and `s2sToday` are computed live on every request using carry-over formula — they are not read from `Period.s2sDaily`. See [Section 7](#7-calculation-semantics).

If the user has no active period, all numeric fields are 0 and all arrays are empty. `onboardingDone` reflects actual state.

**Response 200:**
```typescript
{
  onboardingDone: boolean;
  s2sToday: number;             // kopecks — remaining budget for today (LIVE)
  s2sDaily: number;             // kopecks — per-day limit, carry-over adjusted (LIVE)
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
|--------|-----------|
| `DEFICIT` | `s2sPeriod <= 0` |
| `OVERSPENT` | `todaySpent > s2sDaily` |
| `WARNING` | `s2sToday / s2sDaily <= 0.30` |
| `OK` | None of the above |

**Notes:**
- `daysLeft` uses `max(1, ceil((endDate - now) / 86400000))`
- `s2sDaily` in the response is `dynamicS2sDaily` (carry-over adjusted), NOT `Period.s2sDaily`

---

## 12. Expenses

### POST /tg/expenses

**Stability:** Stable
**Auth:** x-tg-init-data

Creates an expense in the current active period.

> **Known gap:** No idempotency key. Retrying a failed request creates a duplicate expense.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | Int (kopecks) | Yes | Must be > 0 |
| `note` | string | No | Optional description |

**Response 201:** `Expense` object

**Errors:**
- `400 {"error": "Invalid amount"}` — amount missing, not a number, or <= 0
- `400 {"error": "No active period. Complete onboarding first."}` — no ACTIVE period found

---

### GET /tg/expenses/today

**Stability:** Stable
**Auth:** x-tg-init-data

Returns all expenses with `spentAt >= today 00:00:00` UTC, sorted by `spentAt` descending.

> **Timezone note:** "Today" is UTC midnight, not the user's local midnight.

**Response 200:** `Expense[]`

---

### DELETE /tg/expenses/:id

**Stability:** Stable
**Auth:** x-tg-init-data

Deletes an expense. Verifies that the expense belongs to the requesting user.

**Response 200:**
```json
{ "ok": true }
```

**Errors:**
- `404` — expense not found or does not belong to user

---

### GET /tg/expenses

**Stability:** Stable
**Auth:** x-tg-init-data

Returns paginated expense list. Scoped to the current ACTIVE period if one exists; returns all expenses if no active period.

**Query parameters:**

| Parameter | Type | Default | Max |
|-----------|------|---------|-----|
| `limit` | Int | 50 | 200 |
| `offset` | Int | 0 | — |

**Response 200:**
```typescript
{
  expenses: Expense[];
  total: number;                // total count for pagination
  periodId: string | null;      // active period ID, or null if none
}
```

---

## 13. Periods

### GET /tg/periods/current

**Stability:** Stable
**Auth:** x-tg-init-data

Returns the current ACTIVE period including all its expenses.

**Response 200:** `Period & { expenses: Expense[] }`, or `null` if no active period

---

### GET /tg/periods/last-completed

**Stability:** Needs Verification
**Auth:** x-tg-init-data

Returns a summary of the most recently completed period.

**Response 200:**
```typescript
{
  id: string;
  startDate: string;
  endDate: string;
  daysTotal: number;
  s2sPeriod: number;            // kopecks — planned budget
  s2sDaily: number;             // kopecks — stored snapshot
  totalSpent: number;           // kopecks — actual total expenses
  saved: number;                // kopecks — s2sPeriod - totalSpent (may be negative)
  overspentDays: number;        // count of days where daily spending exceeded s2sDaily
  currency: Currency;
  topExpenses: Array<{
    amount: number;
    note: string | null;
    spentAt: string;
  }>;                           // top 5 expenses by amount desc
}
```

Returns `null` if no completed period exists.

---

### POST /tg/periods/recalculate

**Stability:** Stable
**Auth:** x-tg-init-data

Recomputes period bounds using `allPaydays` from current active incomes, then recalculates S2S using current income, obligations, debts, and EF. Updates the `Period` record in DB.

Use this after editing income, payday settings, or any other data that affects S2S.

**Request body:** none

**Response 200:**
```typescript
{
  ok: true;
  s2s: S2SResult;
}
```

**Errors:**
- `400 {"error": "No active period or income"}` — no ACTIVE period or no active incomes found

---

## 14. Incomes

### GET /tg/incomes

**Stability:** Stable
**Auth:** x-tg-init-data

Returns all income records for the user, sorted by `createdAt` descending.

**Response 200:** `Income[]`

---

### POST /tg/incomes

**Stability:** Stable
**Auth:** x-tg-init-data

Creates a new income record.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | |
| `amount` | Int (kopecks) | Yes | |
| `paydays` | Int[] | Yes | Days of month 1–31 |
| `currency` | Currency | No | Default: `"RUB"` |
| `frequency` | IncomeFrequency | No | Default: `"MONTHLY"` |

**Response 201:** `Income` object

**Errors:**
- `400` — title, amount, or paydays missing

---

### PATCH /tg/incomes/:id

**Stability:** Stable
**Auth:** x-tg-init-data

Partially updates an income record. See [PATCH Semantics](#6-patch-semantics) for allowed fields.

Does NOT trigger period recalculation. Call `POST /tg/periods/recalculate` manually afterward if needed.

**Response 200:** Updated `Income` object

**Errors:**
- `404` — income not found or not owned by user

---

### DELETE /tg/incomes/:id

**Stability:** Stable
**Auth:** x-tg-init-data

**Response 200:** `{"ok": true}`

**Errors:**
- `404`

---

## 15. Obligations

### GET /tg/obligations

**Stability:** Stable
**Auth:** x-tg-init-data

Returns all obligations, sorted by `createdAt` descending.

**Response 200:** `Obligation[]`

---

### POST /tg/obligations

**Stability:** Stable
**Auth:** x-tg-init-data

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | |
| `amount` | Int (kopecks) | Yes | |
| `type` | ObligationType | No | Default: `"OTHER"` |
| `dueDay` | Int | No | Day of month 1–31 |

**Response 201:** `Obligation` object

---

### PATCH /tg/obligations/:id

**Stability:** Stable
**Auth:** x-tg-init-data

See [PATCH Semantics](#6-patch-semantics) for allowed fields.

**Response 200:** Updated `Obligation`

**Errors:**
- `404`

---

### DELETE /tg/obligations/:id

**Stability:** Stable
**Auth:** x-tg-init-data

**Response 200:** `{"ok": true}`

**Errors:**
- `404`

---

## 16. Debts

### GET /tg/debts

**Stability:** Stable
**Auth:** x-tg-init-data

Returns active (non-paid-off) debts sorted by `apr` descending.

**Response 200:** `Debt[]` (where `isPaidOff = false`)

---

### POST /tg/debts

**Stability:** Stable
**Auth:** x-tg-init-data

Creates a new debt. If no focus debt currently exists, the new debt becomes the focus debt automatically.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | |
| `balance` | Int (kopecks) | Yes | |
| `apr` | Float | Yes | Decimal fraction, e.g. 0.189 |
| `minPayment` | Int (kopecks) | Yes | |
| `type` | DebtType | No | Default: `"OTHER"` |
| `dueDay` | Int | No | |

**Response 201:** `Debt` object

---

### PATCH /tg/debts/:id

**Stability:** Stable
**Auth:** x-tg-init-data

See [PATCH Semantics](#6-patch-semantics) for allowed/forbidden fields. `isFocusDebt` cannot be set via PATCH.

Does NOT trigger period recalculation. Call `POST /tg/periods/recalculate` manually afterward if needed.

**Response 200:** Updated `Debt`

**Errors:**
- `404`

---

### DELETE /tg/debts/:id

**Stability:** Stable
**Auth:** x-tg-init-data

Deletes the debt. If the deleted debt was the focus debt, focus is reassigned to the next highest-APR non-paid-off debt.

**Response 200:** `{"ok": true}`

**Errors:**
- `404`

---

### POST /tg/debts/:id/payment

**Stability:** Stable
**Auth:** x-tg-init-data

Records a payment on a debt. Reduces `balance` by `amount`. If the new balance reaches 0, sets `isPaidOff: true`, `isFocusDebt: false`, and reassigns focus to the next debt.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | Int (kopecks) | Yes | Must be > 0 |
| `isExtra` | boolean | No | Default: false. Marks as an extra (avalanche) payment. |

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

**Errors:**
- `404` — debt not found or not owned by user

---

### GET /tg/debts/avalanche-plan

**Stability:** Provisional
**Auth:** x-tg-init-data

Returns the avalanche repayment plan for all active debts. Extra monthly payment is estimated from the current period: `round(s2sPeriod × 0.10 / (daysTotal / 30))`.

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
  estimatedDebtFreeMonths: number;
  estimatedTotalInterest: number; // kopecks
}
```

---

## 17. User

### GET /tg/me/profile

**Stability:** Stable
**Auth:** x-tg-init-data

Returns the full user record including profile and subscription.

**Response 200:** `User & { profile: UserProfile | null, subscription: Subscription | null }`

---

### GET /tg/me/settings

**Stability:** Stable
**Auth:** x-tg-init-data

**Response 200:** `UserSettings` object

---

### PATCH /tg/me/settings

**Stability:** Stable
**Auth:** x-tg-init-data

Upserts user settings (creates if not exist, updates if exist). Only the fields listed in [PATCH Semantics](#6-patch-semantics) are accepted; others are silently ignored.

**Request body:** any subset of `UserSettings` fields (see [PATCH Semantics](#6-patch-semantics))

**Response 200:** Updated `UserSettings`

---

### GET /tg/me/plan

**Stability:** Stable
**Auth:** x-tg-init-data

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

## 18. Billing

### POST /tg/billing/pro/checkout

**Stability:** Provisional
**Auth:** x-tg-init-data

Creates a Telegram Stars invoice link for PRO subscription (100 Stars/month). Calls Telegram Bot API `createInvoiceLink`.

**Request body:** none

**Response 200:**
```json
{ "invoiceUrl": "https://t.me/$invoice..." }
```

**Errors:**
- `400 {"error": "Already PRO"}` — user already has an active PRO subscription
- `502` — Telegram Bot API returned an error
- `503` — BOT_TOKEN not configured

**Payment flow:**
1. Telegram sends `successful_payment` update to the bot
2. Bot calls `POST /internal/activate-subscription` with `telegramId`, `chargeId`, `amount`
3. API creates/updates the `Subscription` record and creates a `PaymentEvent`

---

## 19. Internal Routes

These routes are for bot-to-API communication only. Protected by `x-internal-key`.

### POST /internal/store-chat-id

**Stability:** Stable
**Auth:** x-internal-key

Stores the user's `telegramChatId`, required for push notifications. Called by the bot on any message from a user.

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `telegramId` | string \| number | Yes |
| `chatId` | string \| number | Yes |

**Response 200:** `{"ok": true}`

**Errors:**
- `400` — missing `telegramId` or `chatId`

---

### POST /internal/activate-subscription

**Stability:** Stable
**Auth:** x-internal-key

Activates or renews a PRO subscription after a successful Telegram Stars payment.

Behavior:
- Upserts `Subscription` record: `status: ACTIVE`, `currentPeriodEnd = now + 30 days`
- Creates a `PaymentEvent` record with `eventType: "subscription_activated"`

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `telegramId` | string \| number | Yes |
| `chargeId` | string | Yes — Telegram payment charge ID |
| `amount` | number | Yes — Stars amount |

**Response 200:**
```typescript
{
  ok: true;
  subscription: Subscription;
}
```

**Errors:**
- `404 {"error": "User not found"}` — no user with this telegramId

---

## 20. Auth/Security Appendix

| Route pattern | Actor | Auth method | Prod behavior | Dev behavior |
|---------------|-------|-------------|---------------|--------------|
| `/health*` | Anyone | None | None | None |
| `/tg/*` | Telegram user | x-tg-init-data | HMAC-SHA256 + auth_date freshness (<1h) | x-tg-dev bypass available |
| `/internal/*` | Bot service | x-internal-key | Must match ADMIN_KEY env var | Must match ADMIN_KEY env var |

**Dev bypass details:** The `x-tg-dev: <telegramId>` header bypasses HMAC validation. It is guarded by `if (process.env.NODE_ENV !== 'production')` and is unreachable in production where `NODE_ENV=production` is set in the Dockerfile. Internal routes have no dev bypass — they always require the correct ADMIN_KEY.

---

## 21. Known Caveats

| ID | Route | Caveat |
|----|-------|--------|
| KC-001 | `GET /tg/expenses` | Scoped to active period if one exists. Returns all expenses if no active period. All-time history across multiple periods is not exposed. |
| KC-002 | `PATCH /tg/debts/:id` | Does NOT trigger period recalculation. Call `POST /tg/periods/recalculate` manually after changes that affect S2S. |
| KC-003 | `PATCH /tg/incomes/:id` | Does NOT trigger period recalculation. Call `POST /tg/periods/recalculate` manually after changes that affect S2S. |
| KC-004 | `POST /tg/onboarding/income` | Replace semantics — deletes ALL existing incomes first. Not an append operation. |
| KC-005 | `POST /tg/onboarding/complete` | Closes any existing ACTIVE period before creating the new one. The old period is marked COMPLETED. |
| KC-006 | `POST /tg/expenses` | No idempotency key. Retrying a failed request will create a duplicate expense. |
| KC-007 | `PATCH /tg/me/settings weeklyDigest` | Accepted and stored, but no cron job or handler sends a weekly digest. Dead setting. |
| KC-008 | All `/tg/*` | No rate limiting on any endpoint. GAP: TD-001. |
| KC-009 | Error format | No `requestId`/`traceId` in error responses. No machine-readable error `code` field. Both are planned. |
| KC-010 | `GET /tg/expenses/today` | "Today" is UTC midnight, not the user's local midnight. Affects users in UTC+ timezones around midnight. |
