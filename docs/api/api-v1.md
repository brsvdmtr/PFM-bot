# PFM Bot — API Reference v1

> Base URL: `https://mytodaylimit.ru/api`
> All monetary values are integers in **minor units** (kopecks for RUB, cents for USD).
> Example: 150000 = 1500.00 ₽

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Error Format](#2-error-format)
3. [Common Types](#3-common-types)
4. [Health](#4-health)
5. [Onboarding](#5-onboarding)
6. [Dashboard](#6-dashboard)
7. [Expenses](#7-expenses)
8. [Periods](#8-periods)
9. [Incomes](#9-incomes)
10. [Obligations](#10-obligations)
11. [Debts](#11-debts)
12. [Me (Profile, Settings, Plan)](#12-me-profile-settings-plan)
13. [Billing](#13-billing)
14. [Internal Routes](#14-internal-routes)

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

Returns `401` if header is missing or hash is invalid.

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

## 2. Error Format

All errors return JSON:

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_CODE"
}
```

`code` is optional and not consistently present in the current implementation.

Common HTTP status codes:

| Status | Meaning |
|---|---|
| 400 | Bad request — missing or invalid fields |
| 401 | Unauthorized — missing or invalid auth header |
| 404 | Resource not found (ownership verified) |
| 500 | Unhandled server error |
| 502 | Upstream error (Telegram Bot API unreachable) |
| 503 | Service unavailable (DB down, on `/health/deep`) |

---

## 3. Common Types

### Currency

```typescript
type Currency = "RUB" | "USD"
```

### S2SResult

Returned by `POST /tg/onboarding/complete` and `POST /tg/periods/recalculate`.

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
  s2sDaily: number;             // kopecks — per-day limit (carry-over adjusted)
  s2sToday: number;             // kopecks — remaining today after expenses

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
  s2sDaily: number;             // kopecks (snapshot at period creation)
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
  weeklyDigest: boolean;        // default false (not yet implemented)
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. Health

### GET /health

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

## 5. Onboarding

The onboarding flow is a 5-step sequence. Steps 1–4 can be called in any order and are idempotent (each step deletes and recreates its data). Step 5 (`/complete`) creates the first Period and must be called last.

### GET /tg/onboarding/status

**Auth:** X-TG-INIT-DATA

**Response 200:**
```json
{ "onboardingDone": false }
```

---

### POST /tg/onboarding/income

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

**Auth:** X-TG-INIT-DATA

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

## 6. Dashboard

### GET /tg/dashboard

**Auth:** X-TG-INIT-DATA

Returns the main dashboard payload. If user has no active period, returns zeroed fields.

**Response 200:**
```typescript
{
  onboardingDone: boolean;
  s2sToday: number;             // kopecks — remaining budget for today
  s2sDaily: number;             // kopecks — per-day limit (carry-over adjusted)
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

**Example:**
```json
{
  "onboardingDone": true,
  "s2sToday": 210000,
  "s2sDaily": 275000,
  "s2sStatus": "OK",
  "daysLeft": 14,
  "daysTotal": 16,
  "periodStart": "2026-03-20T00:00:00.000Z",
  "periodEnd": "2026-04-05T00:00:00.000Z",
  "periodSpent": 275000,
  "s2sPeriod": 4410000,
  "todayExpenses": [
    {
      "id": "cm8exp001",
      "userId": "cm8user456",
      "periodId": "cm8period789",
      "amount": 65000,
      "currency": "RUB",
      "note": "Кофе",
      "source": "MANUAL",
      "spentAt": "2026-03-21T08:30:00.000Z",
      "createdAt": "2026-03-21T08:30:00.000Z"
    }
  ],
  "todayTotal": 65000,
  "focusDebt": {
    "id": "cm8debt001",
    "title": "Кредитная карта",
    "apr": 0.289,
    "balance": 15000000,
    "minPayment": 300000,
    "type": "CREDIT_CARD"
  },
  "debts": [...],
  "emergencyFund": {
    "currentAmount": 500000,
    "targetAmount": 6000000
  },
  "currency": "RUB"
}
```

---

## 7. Expenses

### POST /tg/expenses

**Auth:** X-TG-INIT-DATA

Creates an expense in the current active period.

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

**Auth:** X-TG-INIT-DATA

Returns all expenses with `spentAt >= today 00:00:00` (server local time), sorted by `spentAt` descending.

**Response 200:** `Expense[]`

---

### DELETE /tg/expenses/:id

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

**Auth:** X-TG-INIT-DATA

Returns paginated expense list for the current active period.

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

## 8. Periods

### GET /tg/periods/current

**Auth:** X-TG-INIT-DATA

Returns the current ACTIVE period including all its expenses.

**Response 200:** `Period & { expenses: Expense[] }` or `null` if no active period

---

### GET /tg/periods/last-completed

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

**Auth:** X-TG-INIT-DATA

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

## 9. Incomes

### GET /tg/incomes

**Auth:** X-TG-INIT-DATA

Returns all income records for the user, sorted by `createdAt` descending.

**Response 200:** `Income[]`

---

### POST /tg/incomes

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

**Auth:** X-TG-INIT-DATA

Partially updates an income record. All fields from the request body are applied directly (no field whitelist enforced beyond Prisma schema).

**Response 200:** Updated `Income` object

**Errors:**
- `404` — income not found or not owned by user

---

### DELETE /tg/incomes/:id

**Auth:** X-TG-INIT-DATA

**Response 200:** `{ "ok": true }`

**Errors:**
- `404`

---

## 10. Obligations

### GET /tg/obligations

**Auth:** X-TG-INIT-DATA

Returns all obligations, sorted by `createdAt` descending.

**Response 200:** `Obligation[]`

---

### POST /tg/obligations

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

**Auth:** X-TG-INIT-DATA

Updates obligation. All body fields applied directly.

**Response 200:** Updated `Obligation`

---

### DELETE /tg/obligations/:id

**Auth:** X-TG-INIT-DATA

**Response 200:** `{ "ok": true }`

---

## 11. Debts

### GET /tg/debts

**Auth:** X-TG-INIT-DATA

Returns active (non-paid-off) debts sorted by `apr` descending.

**Response 200:** `Debt[]`

---

### POST /tg/debts

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

**Auth:** X-TG-INIT-DATA

Updates allowed fields only: `title`, `type`, `balance`, `apr`, `minPayment`, `dueDay`.

**Response 200:** Updated `Debt`

---

### DELETE /tg/debts/:id

**Auth:** X-TG-INIT-DATA

Deletes debt. If the deleted debt was the focus debt, reassigns focus to next highest-APR debt.

**Response 200:** `{ "ok": true }`

---

### POST /tg/debts/:id/payment

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

## 12. Me (Profile, Settings, Plan)

### GET /tg/me/profile

**Auth:** X-TG-INIT-DATA

Returns the full user record including profile and subscription.

**Response 200:** `User & { profile: UserProfile | null, subscription: Subscription | null }`

<!-- TODO: verify exact fields returned -->

---

### GET /tg/me/settings

**Auth:** X-TG-INIT-DATA

**Response 200:** `UserSettings` object

---

### PATCH /tg/me/settings

**Auth:** X-TG-INIT-DATA

Upserts user settings. Only the following fields are accepted (others are silently ignored):

```typescript
{
  morningNotifyTime?: string;       // "HH:MM"
  eveningNotifyTime?: string;       // "HH:MM"
  morningNotifyEnabled?: boolean;
  eveningNotifyEnabled?: boolean;
  paymentAlerts?: boolean;
  deficitAlerts?: boolean;
  weeklyDigest?: boolean;
}
```

**Response 200:** Updated `UserSettings`

---

### GET /tg/me/plan

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

## 13. Billing

### POST /tg/billing/pro/checkout

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

## 14. Internal Routes

These routes are only for bot-to-API communication and are protected by `X-Internal-Key`.

### POST /internal/store-chat-id

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
