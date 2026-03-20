---
title: "Dashboard UI Data Contract"
document_type: Normative
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - path: ../system/formulas-and-calculation-policy.md
    relation: "canonical formula source"
---

# Dashboard UI Data Contract

This document defines the contract between the backend API response and the UI rendering. When a number is wrong on the dashboard, this document is the debugging starting point.

**Reference**: The authoritative API response shape is at `GET /tg/dashboard`. For calculation semantics see [`../system/formulas-and-calculation-policy.md`](../system/formulas-and-calculation-policy.md).

**Source files:**
- `apps/web/src/app/miniapp/MiniApp.tsx` — `Dashboard` component, `loadDashboard` function
- `apps/api/src/index.ts` — `GET /tg/dashboard` handler

---

## Dashboard API Response Shape

```typescript
interface DashboardData {
  onboardingDone: boolean;
  s2sToday: number;       // kopecks
  s2sDaily: number;       // kopecks — live carry-over daily limit (NOT period.s2sDaily snapshot)
  s2sStatus: string;      // 'OK' | 'WARNING' | 'OVERSPENT' | 'DEFICIT'
  daysLeft: number;
  daysTotal: number;
  periodStart: string;    // ISO datetime string
  periodEnd: string;      // ISO datetime string
  periodSpent: number;    // kopecks
  s2sPeriod: number;      // kopecks — persisted at period creation
  todayExpenses: Expense[];
  todayTotal: number;     // kopecks
  focusDebt: Debt | null;
  debts: Debt[];
  emergencyFund: { currentAmount: number; targetAmount: number } | null;
  currency: string;       // 'RUB' | 'USD'
}
```

All money fields are in minor units (kopecks for RUB, cents for USD). The frontend divides by 100 for display.

---

## UI Elements — Data Contract

### 1. "Можно сегодня" (Safe to Spend Today)

| Attribute | Value |
|-----------|-------|
| UI Label | "Можно сегодня" |
| UI Label (EN) | "Safe to spend today" |
| API field | `s2sToday` |
| Type | Int (kopecks) |
| Domain meaning | Remaining daily budget after today's expenses |
| Formula | `max(0, dynamicS2sDaily - todayTotal)` |
| Formula source | formulas-and-calculation-policy.md §S2S_Today |
| Persisted or derived | **Derived at runtime** |
| DB field | None — computed in API handler on every request |
| Null behavior | If no active period: 0 |
| Zero behavior | Shown as 0₽; status becomes WARNING or OVERSPENT or DEFICIT |
| Negative source | Cannot be negative — floored at 0 via `max(0, ...)` |
| Loading state | Full-screen spinner on initial load; no partial update |
| Error state | Shows "error" screen with reload button |
| Related | `s2sStatus` and `s2sColor()` determine display color |

---

### 2. "Дневной лимит" (Daily Limit)

| Attribute | Value |
|-----------|-------|
| UI Label | "из дневного лимита X ₽" |
| API field | `s2sDaily` |
| Type | Int (kopecks) |
| Domain meaning | Live carry-over daily limit for today |
| Formula | `max(0, round((s2sPeriod - totalPeriodSpent) / daysLeft))` |
| Formula source | formulas-and-calculation-policy.md §S2S_Daily_Live |
| Persisted or derived | **Derived at runtime** |
| DB field | None — recomputed on every dashboard request |
| Critical distinction | This is NOT `period.s2sDaily` (the creation-time snapshot). It is recalculated live on every request from current spend and daysLeft. |
| Null behavior | Hidden if 0 |
| Related | Used by `s2sColor()` frontend function to determine card color |

---

### 3. "Осталось за период" (Period Remaining)

| Attribute | Value |
|-----------|-------|
| UI Label | "Осталось в периоде X ₽" |
| API field | Computed inline from `s2sPeriod` and `periodSpent` |
| Type | Int (kopecks) |
| Domain meaning | Budget remaining in the current period |
| Formula | `max(0, data.s2sPeriod - data.periodSpent)` |
| Formula source | Computed in JSX, not returned as a distinct API field |
| Persisted or derived | **Derived in frontend** |
| DB field | `s2sPeriod` persisted; `periodSpent` is a live aggregate |
| Null behavior | Shows 0₽ |

---

### 4. "Потрачено за период" (Period Spent)

| Attribute | Value |
|-----------|-------|
| UI Label | "Расходы за период" (in progress bar) |
| API field | `periodSpent` |
| Type | Int (kopecks) |
| Domain meaning | Sum of all expenses in the current period |
| Formula | `sum(expenses.amount) WHERE spentAt >= period.startDate` |
| Persisted or derived | **Derived at runtime** (live aggregate query) |
| DB field | No — computed from `Expense` table on each request |
| Related | Drives progress bar: `periodPct = min(100, round(periodSpent / s2sPeriod * 100))` |
| Color logic | Progress bar: green < 50%, orange 50–80%, red > 80% |

---

### 5. "Дней до конца периода" (Days Left)

| Attribute | Value |
|-----------|-------|
| UI Label | "X дн. осталось" |
| API field | `daysLeft` |
| Type | Int |
| Domain meaning | Days remaining in the current period, including today |
| Formula | `max(1, ceil((period.endDate - now) / 86400000))` |
| Persisted or derived | **Derived at runtime** |
| DB field | None — computed from `period.endDate` |
| Minimum value | Always at least 1 (never 0) |
| Timezone note | UTC-based. Decrements at UTC midnight, not user's local midnight. |
| Related | Used in denominator of `s2sDaily` formula |

---

### 6. "Потрачено сегодня" (Today Total)

| Attribute | Value |
|-----------|-------|
| UI Label | Header of today's expense card: "-X ₽" |
| API field | `todayTotal` |
| Type | Int (kopecks) |
| Domain meaning | Sum of all expenses logged today (UTC day) |
| Formula | `sum(todayExpenses[].amount)` — computed from the already-loaded todayExpenses array |
| Persisted or derived | **Derived at runtime** |
| DB field | None |
| Day boundary | "Today" = UTC midnight of server date. Users in non-UTC zones see their day start at a non-local midnight. |
| Card visibility | Card hidden if `todayExpenses.length === 0` |

---

### 7. "Подушка безопасности" (Emergency Fund)

| Attribute | Value |
|-----------|-------|
| UI Label | "Подушка безопасности" |
| API field | `emergencyFund: { currentAmount, targetAmount }` |
| Type | Both Int (kopecks) |
| Domain meaning | currentAmount = saved so far; targetAmount = goal |
| `currentAmount` source | Persisted: `EmergencyFund.currentAmount` in DB |
| `targetAmount` formula | `sum(activeObligations.amount) * emergencyFund.targetMonths` — computed server-side in dashboard handler, NOT stored in DB |
| Persisted or derived | currentAmount persisted; targetAmount **derived at runtime** |
| Gap note | If obligations change after EF record was created, targetAmount on dashboard changes too (GAP-013 in gap-analysis.md) |
| Card visibility | Hidden if `emergencyFund === null` or `targetAmount === 0` |
| Progress bar | `min(100, round(currentAmount / targetAmount * 100))` |
| Goal label bug | Hardcoded as "цель: 3 мес. обязательных" — does not reflect actual `targetMonths` from DB |

---

### 8. "Фокусный долг" (Focus Debt)

| Attribute | Value |
|-----------|-------|
| UI Label | "Долги (Лавина)" card |
| API field | `debts[]` array (also `focusDebt` but dashboard renders the array) |
| Domain meaning | Focus debt = highest-APR debt selected for extra avalanche payment |
| Focus debt selection | `debts.find(d => d.isFocusDebt) ?? debts[0] ?? null` |
| Sort order | Ordered by APR desc server-side |
| Displayed fields | `debt.title`, `debt.balance`, `debt.minPayment`, `debt.apr`, `debt.isFocusDebt` |
| Focus indicator | Small accent-colored dot before debt title if `isFocusDebt === true` |
| Card visibility | Hidden if `debts.length === 0` |
| Items shown | Maximum 3, with "Показать все (N)" button to navigate to Debts screen |
| APR display | `(d.apr * 100).toFixed(1)%` — apr stored as decimal fraction in DB |

---

### 9. S2S Status Color

| Attribute | Value |
|-----------|-------|
| API field | `s2sStatus: 'OK' | 'WARNING' | 'OVERSPENT' | 'DEFICIT'` |
| Server-side status rules | See table below |
| Frontend color function | `s2sColor(s2sToday, s2sDaily)` — computed independently from `s2sStatus` |
| `s2sStatus` usage | Only used for overspent banner (`s2sStatus === 'OVERSPENT'`) |
| Main card color | Determined by frontend `s2sColor()`, NOT by `s2sStatus` |

**Server-side `s2sStatus` rules (`index.ts`):**

| Condition | Status |
|-----------|--------|
| `activePeriod.s2sPeriod <= 0` | `DEFICIT` |
| `todayTotal > dynamicS2sDaily` | `OVERSPENT` |
| `dynamicS2sDaily > 0 && s2sToday / dynamicS2sDaily <= 0.3` | `WARNING` |
| Otherwise | `OK` |

**Frontend `s2sColor(s2sToday, s2sDaily)` rules:**

| Condition | Color |
|-----------|-------|
| `s2sToday <= 0 \|\| s2sDaily <= 0` | red |
| `s2sToday / s2sDaily > 0.7` | green |
| `s2sToday / s2sDaily > 0.3` | orange |
| Otherwise | red |

**Important:** The two implementations are parallel and semantically equivalent for most cases, but diverge for DEFICIT: the API emits `DEFICIT` when `s2sPeriod <= 0`, while the frontend shows red when `s2sToday <= 0 || s2sDaily <= 0`. There is no explicit DEFICIT UI state — the user sees "0 ₽" in red with no explanatory message.

---

### 10. Today's Expense List

| Attribute | Value |
|-----------|-------|
| UI Label | Individual line items under today's total |
| API field | `todayExpenses[]` |
| Type | `Expense[]` |
| Server query | `WHERE userId = X AND spentAt >= UTC_midnight_today ORDER BY spentAt DESC` |
| Day boundary | UTC midnight of server date — not user's local midnight |
| Items shown | Maximum 3 items (no "show more" on dashboard) |
| Label | `expense.note || 'Расход'` |
| Amount display | `-{fmt(amount, currency)}` in red |
| Card visibility | Entire card hidden if `todayExpenses.length === 0` |

---

## Dashboard Response JSON Example

```json
{
  "onboardingDone": true,
  "s2sToday": 621800,
  "s2sDaily": 872300,
  "s2sStatus": "OK",
  "daysLeft": 9,
  "daysTotal": 15,
  "periodStart": "2026-04-05T00:00:00.000Z",
  "periodEnd": "2026-04-20T00:00:00.000Z",
  "periodSpent": 2508700,
  "s2sPeriod": 13084100,
  "todayTotal": 250500,
  "todayExpenses": [
    { "id": "exp_1", "amount": 150000, "note": "обед", "spentAt": "2026-04-11T09:32:00.000Z" },
    { "id": "exp_2", "amount": 100500, "note": null, "spentAt": "2026-04-11T08:15:00.000Z" }
  ],
  "focusDebt": {
    "id": "debt_1",
    "title": "Кредитная карта Тинькофф",
    "balance": 20000000,
    "apr": 0.21,
    "minPayment": 1500000,
    "isFocusDebt": true
  },
  "debts": [
    {
      "id": "debt_1",
      "title": "Кредитная карта Тинькофф",
      "balance": 20000000,
      "apr": 0.21,
      "minPayment": 1500000,
      "isFocusDebt": true
    }
  ],
  "emergencyFund": {
    "currentAmount": 10000000,
    "targetAmount": 15000000
  },
  "currency": "RUB"
}
```

All money values in kopecks. Divide by 100 for display in rubles.

---

## What to Do When the Number Is Wrong

### "Можно сегодня" is lower than expected

1. Check `s2sDaily` in the response. Is the daily limit itself low, or did today's expenses consume it?
2. Check `periodSpent`. Was there more spending than expected this period?
3. Check `daysLeft`. If it's low (e.g., 1–2), the carry-over formula amplifies any deficit.
4. Check `s2sPeriod`. If this is lower than expected, the issue is in the period creation calculation — check `calculateS2S` in `engine.ts`.
5. If `s2sStatus === 'DEFICIT'`, `s2sPeriod` is 0 or negative — obligations exceed income.

### "Дневной лимит" changed without any expenses

- `s2sDaily` is recalculated live on every request. If `daysLeft` decreased by 1 (new day started), the formula `(s2sPeriod - periodSpent) / daysLeft` produces a different result. This is expected behavior (carry-over).

### "Потрачено за период" is wrong

- Verify `periodSpent` matches the sum of all expenses in the period from the DB.
- Check `period.startDate` — expenses before startDate should not be counted.

### Emergency fund progress is wrong

- `targetAmount` is computed server-side from current obligations sum × `targetMonths`. If obligations were recently changed, targetAmount changes too. This is by design (GAP-013).

### Dashboard shows 0 / spinner indefinitely

- If `loadDashboard()` fails after the initial onboarding status check succeeds, the app sets `screen = 'dashboard'` but `dashboard` remains null. This shows an infinite spinner with no error message and no retry button. This is a known UX gap.

---

## Loading and Error States

**Initial load sequence:**
1. Full-screen spinner ("Загрузка...")
2. `GET /tg/onboarding/status` fires
3. If `onboardingDone = true`: `loadDashboard()` → `GET /tg/dashboard`
4. On success: screen transitions to dashboard
5. On failure of onboarding/status: `screen = 'error'` with "Повторить" reload button

**Error message format:** `String(e)` from caught exception. Examples:
- Network failure: "TypeError: Load failed"
- API error: "Error: API 401"

**Known gap:** If `loadDashboard()` fails (after onboarding status succeeds), the screen is set to `'dashboard'` with `dashboard = null`, resulting in an infinite spinner with no error or retry option.

**Data staleness:** There is no auto-refresh, polling, or WebSocket. Data refreshes only when the user takes an action (adds expense, changes settings, etc.). There is no pull-to-refresh.
