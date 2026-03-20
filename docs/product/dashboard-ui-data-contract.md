---
title: "Dashboard UI Data Contract"
document_type: Normative
status: Active
source_of_truth: "YES — for dashboard display logic"
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - system/numerical-source-of-truth.md
  - system/formulas-and-calculation-policy.md
  - api/api-v1.md
---

# Dashboard UI Data Contract

This document defines exactly what every visible element on the dashboard displays and where that data comes from. It is the authoritative reference for anyone verifying or debugging dashboard output.

**Source files verified:**
- `apps/web/src/app/miniapp/MiniApp.tsx` — `Dashboard` component (line ~510), `loadDashboard` function (line ~1544), error/loading render (line ~1637)
- `apps/api/src/index.ts` — `GET /tg/dashboard` handler (line ~170)

---

## Dashboard Data Shape

The `DashboardData` TypeScript interface in `MiniApp.tsx`:

```typescript
interface DashboardData {
  onboardingDone: boolean;
  s2sToday: number;       // kopecks
  s2sDaily: number;       // kopecks
  s2sStatus: string;      // 'OK' | 'WARNING' | 'OVERSPENT' | 'DEFICIT'
  daysLeft: number;
  daysTotal: number;
  periodStart: string;    // ISO datetime string
  periodEnd: string;      // ISO datetime string
  periodSpent: number;    // kopecks
  s2sPeriod: number;      // kopecks
  todayExpenses: Expense[];
  todayTotal: number;     // kopecks
  focusDebt: Debt | null;
  debts: Debt[];
  emergencyFund: { currentAmount: number; targetAmount: number } | null;
  currency: string;       // 'RUB' | 'USD'
}
```

All money fields are in minor units (kopecks for RUB, cents for USD). The frontend formats them as `amount / 100` rounded to 0 decimal places.

---

## UI Elements — Data Contract Table

| UI Label | Russian Label | API Field | Source | Persisted/Derived | Formula | Null Behavior | Notes |
|---|---|---|---|---|---|---|---|
| SAFE TO SPEND TODAY (large number) | — | `s2sToday` | `GET /tg/dashboard` | Derived at request | `max(0, dynamicS2sDaily - todayTotal)` | Shows `0 ₽` if null/zero | Top of S2S card; color driven by `s2sColor()` in frontend |
| Daily limit subtitle | "из дневного лимита X ₽" | `s2sDaily` | `GET /tg/dashboard` | Derived at request | `max(0, round((s2sPeriod - totalPeriodSpent) / daysLeft))` | Hidden if 0 | This is NOT `period.s2sDaily`; it is live-recomputed carry-over value |
| Left this period | "Осталось в периоде X ₽" | Computed from `s2sPeriod - periodSpent` | Frontend inline | Derived | `max(0, data.s2sPeriod - data.periodSpent)` | Shows `0 ₽` | Computed in JSX: `Math.max(0, data.s2sPeriod - data.periodSpent)` |
| Period date range bar | "Янв 15 → Апр 1" | `periodStart`, `periodEnd` | `GET /tg/dashboard` | Persisted (Period.startDate, endDate) | `periodLabel(periodStart, periodEnd)` | Not shown if no period | Format: month abbreviation + day, no year |
| Day counter in period bar | "День X из Y" | `daysLeft`, `daysTotal` | `GET /tg/dashboard` | Derived / Persisted | `periodElapsed = daysTotal - daysLeft; day = periodElapsed + 1` | Shows "День 1 из 0" if daysTotal=0 | `periodElapsed` is computed in frontend |
| Overspent banner | "Перерасход на X ₽" | `s2sStatus`, `todayTotal`, `s2sDaily` | `GET /tg/dashboard` | Derived | `todayTotal - s2sDaily` | Not shown unless `s2sStatus === 'OVERSPENT'` | Shown inside S2S card as red box |
| Today's expenses header total | "-X ₽" | `todayTotal` | `GET /tg/dashboard` | Derived at request | Sum of all expenses where `spentAt >= today 00:00:00 UTC` | Not shown if `todayExpenses.length === 0` | Card only renders if `todayExpenses.length > 0` |
| Today expense line item | note or "Расход" / "-X ₽" | `todayExpenses[n].note`, `todayExpenses[n].amount` | `GET /tg/dashboard` | Persisted | Direct DB values | note defaults to "Расход" | Shows first 3 items maximum |
| Emergency fund card | "Подушка безопасности" | `emergencyFund.currentAmount`, `emergencyFund.targetAmount` | `GET /tg/dashboard` | currentAmount persisted; targetAmount derived | `targetAmount = sum(activeObligations) × targetMonths` | Card hidden if `emergencyFund === null` or `targetAmount === 0` | `targetAmount` is computed server-side in the dashboard handler |
| EF progress bar | — | `emergencyFund.currentAmount / emergencyFund.targetAmount` | Computed in frontend | Derived | `min(100, round(currentAmount / targetAmount × 100))` | 0% if targetAmount=0 | Uses `ProgressBar` component |
| EF percentage label | "X%" | Computed in frontend | — | Derived | `efPct = min(100, round(currentAmount / targetAmount × 100))` | Shows "0%" | |
| EF goal label | "цель: 3 мес. обязательных" | Hardcoded string | — | — | Static label | Always shown | Does not reflect actual `targetMonths` value from DB |
| Debts card (Лавина) | "Долги (Лавина)" | `debts[]` | `GET /tg/dashboard` | Persisted | Ordered by APR desc on server | Card hidden if `debts.length === 0` | Shows first 3 debts |
| Debt focus indicator (dot) | — | `debt.isFocusDebt` | `GET /tg/dashboard` | Persisted | `Debt.isFocusDebt` flag | No dot if not focus debt | Accent-colored dot before debt title |
| Debt APR | "APR X%" | `debt.apr` | `GET /tg/dashboard` | Persisted | `(d.apr × 100).toFixed(1)%` | Shows "APR 0.0%" | apr stored as decimal fraction |
| Debt balance | "X ₽" | `debt.balance` | `GET /tg/dashboard` | Persisted | `fmt(d.balance, currency)` | Shows "0 ₽" | |
| Debt min payment | "мин X ₽" | `debt.minPayment` | `GET /tg/dashboard` | Persisted | `fmt(d.minPayment, currency)` | Shows "мин 0 ₽" | |
| Period spending progress bar | "Расходы за период" | `periodSpent`, `s2sPeriod` | `GET /tg/dashboard` | periodSpent derived; s2sPeriod persisted | `periodPct = min(100, round(periodSpent / s2sPeriod × 100))` | 0% if s2sPeriod=0 | Color: red if >80%, orange if >50%, green otherwise |
| Period progress % | "X% потрачено" | Computed in frontend | — | Derived | `periodPct` | Shows "0% потрачено" | |
| Days left label (period card) | "X дн. осталось" | `daysLeft` | `GET /tg/dashboard` | Derived at request | From API | Shows "1 дн. осталось" minimum | |
| S2S card main color | — | `s2sToday`, `s2sDaily` | Computed in frontend | Derived | `s2sColor(s2sToday, s2sDaily)` | red if both ≤ 0 | Frontend `s2sColor()` function, NOT the API's `s2sStatus` field |
| Period summary banner | "Период завершён" | Shown if last-completed period ended within 3 days | `GET /tg/periods/last-completed` | Persisted (Period) | `diffDays <= 3` from period.endDate | Not shown | Loaded asynchronously after dashboard, failure is silently ignored |

---

## Detailed Element Specs

### 1. Safe to Spend Today

**API field:** `s2sToday`

**Formula (server-side, `index.ts`):**
```typescript
const periodRemaining = Math.max(0, activePeriod.s2sPeriod - totalPeriodSpent);
const dynamicS2sDaily = Math.max(0, Math.round(periodRemaining / daysLeft));
const s2sToday = Math.max(0, dynamicS2sDaily - todayTotal);
```

**Critical distinction:** `dynamicS2sDaily` used here is NOT `period.s2sDaily` (the snapshot). It is recomputed fresh from `period.s2sPeriod`, current total spend, and current `daysLeft` on every dashboard request.

**Display:** Divided by 100, formatted with `ru-RU` locale, 0 decimal places, `₽` suffix.

**Color:** Computed in frontend by `s2sColor(data.s2sToday, data.s2sDaily)`:
- green: `s2sToday / s2sDaily > 0.7`
- orange: `s2sToday / s2sDaily > 0.3`
- red: ratio ≤ 0.3, or either value is 0

This frontend color calculation is independent from the `s2sStatus` field returned by the API. They should agree but are separate implementations.

---

### 2. Daily Limit ("из дневного лимита X ₽")

**API field:** `s2sDaily`

**This is the live carry-over daily limit, not the stored `period.s2sDaily`.**

**Formula:** `max(0, round((s2sPeriod - totalPeriodSpent) / daysLeft))`

`totalPeriodSpent` = sum of all expenses in the active period (not just today).

`daysLeft` = `max(1, ceil((activePeriod.endDate - now) / 86400000))`

Note: This `daysLeft` formula differs slightly from the engine's `daysBetween` helper. The dashboard handler uses `Math.ceil((endDate - now) / ms_per_day)` directly, not `daysBetween(periodStartDate, periodEndDate)`.

---

### 3. Left This Period ("Осталось в периоде X ₽")

**Not a distinct API field.** Computed inline in the JSX:

```typescript
Math.max(0, data.s2sPeriod - data.periodSpent)
```

Where:
- `data.s2sPeriod` = `activePeriod.s2sPeriod` (persisted at period creation)
- `data.periodSpent` = `periodExpenses._sum.amount ?? 0` (live sum of all period expenses)

Shown below the period remaining label in the S2S card.

---

### 4. Days Left ("X дн. осталось")

**API field:** `daysLeft`

**Formula (server-side):**
```typescript
Math.max(1, Math.ceil((activePeriod.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
```

Guaranteed to be at least 1 (never 0 or negative). This is a UTC-based calculation; it decrements at UTC midnight regardless of the user's local timezone.

---

### 5. Period Date Range

**API fields:** `periodStart`, `periodEnd` (ISO datetime strings)

**Display function (`periodLabel`):**
```typescript
function periodLabel(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const mo = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  return `${mo[s.getMonth()]} ${s.getDate()} → ${mo[e.getMonth()]} ${e.getDate()}`;
}
```

No year is shown. The month abbreviations are Russian. The separator is `→` (not `–`).

---

### 6. Today's Expenses List

**API field:** `todayExpenses` (array of Expense objects)

**Server-side query (`index.ts`):**
```typescript
prisma.expense.findMany({
  where: {
    userId,
    spentAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
  },
  orderBy: { spentAt: 'desc' },
})
```

The `setHours(0, 0, 0, 0)` call sets UTC midnight of the current server day. Users in non-UTC timezones see a "day boundary" at server midnight, not their local midnight.

The card is only rendered if `todayExpenses.length > 0`. Maximum 3 items are shown.

Each expense shows:
- `note || 'Расход'` as the label
- `-{fmt(amount, currency)}` in red as the amount

---

### 7. Today's Total Spent

**API field:** `todayTotal`

**Formula (server-side):**
```typescript
const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
```

This is the sum of the `todayExpenses` array already loaded for the response, not a separate aggregate query. Shown as the header of the today's expenses card: `"-X ₽"`.

---

### 8. Focus Debt (via Debts Card)

**API field:** `focusDebt` (from `GET /tg/dashboard`), `debts[]`

The dashboard response includes a `focusDebt` field and a full `debts` array. The dashboard renders the `debts` array (not `focusDebt` directly) as a summary card showing up to 3 debts.

**Server-side focus debt selection:**
```typescript
const focusDebt = user.debts.find((d) => d.isFocusDebt) ?? user.debts[0] ?? null;
```

Debts are ordered by APR desc in the query (`orderBy: { apr: 'desc' }`). The focus debt is the one with `isFocusDebt = true`, falling back to the first debt in the list.

The focus debt indicator is a small accent-colored dot rendered before the debt title for debts where `isFocusDebt === true`.

---

### 9. Emergency Fund Progress Bar

**API field:** `emergencyFund: { currentAmount: number; targetAmount: number } | null`

**`targetAmount` is computed server-side in the dashboard handler:**
```typescript
emergencyFund: user.emergencyFund
  ? {
      currentAmount: user.emergencyFund.currentAmount,
      targetAmount: user.obligations.reduce((sum, o) => sum + o.amount, 0)
                    * user.emergencyFund.targetMonths,
    }
  : null
```

`targetAmount` = sum of all active obligations (monthly amounts) × `targetMonths` (default 3). This is NOT prorated — it always uses full monthly obligation amounts.

The card is hidden if `emergencyFund === null` or `emergencyFund.targetAmount === 0` (i.e., user has no obligations).

The goal label is hardcoded as "цель: 3 мес. обязательных" regardless of the actual `targetMonths` value.

---

### 10. S2S Status / Color Bar

**API field:** `s2sStatus: 'OK' | 'WARNING' | 'OVERSPENT' | 'DEFICIT'`

**Server-side status rules (`index.ts`):**

| Condition | Status |
|---|---|
| `activePeriod.s2sPeriod <= 0` | `DEFICIT` |
| `todayTotal > dynamicS2sDaily` | `OVERSPENT` |
| `dynamicS2sDaily > 0 && s2sToday / dynamicS2sDaily <= 0.3` | `WARNING` |
| Otherwise | `OK` |

**Frontend color derivation (`s2sColor()` in MiniApp.tsx):**

| Condition | Color |
|---|---|
| `s2sToday <= 0 \|\| s2sDaily <= 0` | `red` |
| `ratio > 0.7` | `green` |
| `ratio > 0.3` | `orange` |
| Otherwise | `red` |

The frontend does NOT use `s2sStatus` for the main card color. It recomputes the color from `s2sToday` and `s2sDaily` values. The API's `s2sStatus` is used only for the overspent banner (shown when `s2sStatus === 'OVERSPENT'`).

The two implementations are semantically equivalent for the OVERSPENT and WARNING cases but differ in the DEFICIT case: the API emits `DEFICIT` when `s2sPeriod <= 0`, while the frontend shows `red` when `s2sToday <= 0 || s2sDaily <= 0`.

---

## Loading States

The dashboard goes through these loading phases:

**Initial app load:**
1. `screen = 'loading'` — full-screen spinner with "Загрузка..." text
2. `GET /tg/onboarding/status` fires
3. If `onboardingDone = true`: `loadDashboard()` fires → `GET /tg/dashboard`
4. On success: `screen = 'dashboard'`
5. On failure: `screen = 'error'` with error text from `String(e)`

**Dashboard screen with no data (transition state):**
If `screen === 'dashboard' && !dashboard`: a centered `<Spinner />` is shown. This is visible for the brief moment between setting `screen = 'dashboard'` and `setDashboard(data)` completing.

In practice, `loadDashboard` sets `dashboard` before setting `screen`, so this state should rarely be visible:
```typescript
loadDashboard().then(() => setScreen('dashboard'))
```

**After adding an expense:**
`loadDashboard()` is called before navigating back to dashboard. The dashboard data is updated before the screen transition.

**After settings changes (incomes, obligations, paydays):**
`onChanged={loadDashboard}` is passed as a callback. Dashboard data refreshes after the settings change completes.

---

## Error States

If the initial API call (`GET /tg/onboarding/status`) fails, the app shows:

```
screen = 'error'
```

Renders:
- Red text showing `error` string (e.g. "TypeError: Load failed", "API 401")
- "Повторить" button that calls `window.location.reload()`

The error message is `String(e)` where `e` is the caught exception. For network failures, this shows the browser's fetch error message (e.g. "TypeError: Load failed" on iOS Safari). For API errors, the `api()` helper throws `new Error(\`API ${res.status}\`)`, so the message is "Error: API 401".

**Note:** The error screen is only reachable from the initial onboarding status check. If `loadDashboard()` fails (after onboarding status succeeds), the app silently proceeds to `screen = 'dashboard'` with `dashboard = null`, which renders a spinner indefinitely. This is a UX gap — a failed dashboard load after a successful status check shows an infinite spinner with no error or retry option.

---

## Staleness

The dashboard data becomes stale immediately after it is loaded. There is no auto-refresh, no WebSocket, and no polling.

Data is refreshed in these scenarios only:

| Trigger | Mechanism |
|---|---|
| User adds an expense | `handleSaveExpense` calls `loadDashboard()` before returning to dashboard |
| User deletes an expense (History screen) | `onRefresh={loadDashboard}` callback from History |
| User changes income | `onChanged={loadDashboard}` callback from IncomesScreen |
| User changes obligation | `onChanged={loadDashboard}` callback from ObligationsScreen |
| User changes paydays | `onChanged={loadDashboard}` callback from PaydaysScreen |
| User navigates away and back | Only if they came from a screen that called `onChanged` |
| App reload | `window.location.reload()` on error screen |

**There is no pull-to-refresh.** If the user opens the app and leaves it open for hours without adding an expense, the displayed s2sToday and daysLeft will reflect the state at load time, not the current time.

---

## Known UX Gaps

1. **No pull-to-refresh.** The dashboard does not update unless the user takes an action. A user who opens the app first thing in the morning sees the same data as when they last loaded it.

2. **Failed dashboard load shows infinite spinner.** If `loadDashboard()` fails after the initial status check succeeds, `screen` is set to `'dashboard'` but `dashboard` remains `null`, resulting in a non-dismissible spinner.

3. **"Left this period" is computed in JSX, not returned by API.** If `s2sPeriod` and `periodSpent` are ever inconsistent (e.g. due to a direct DB edit), the displayed "Осталось в периоде" will differ from what the API internally considers the remaining budget.

4. **EF goal label hardcodes "3 мес."** The label always reads "цель: 3 мес. обязательных" regardless of the user's `targetMonths` setting. A user who has set `targetMonths = 6` in the DB will see incorrect goal labeling.

5. **Today's expenses capped at 3 items with no "show more".** The dashboard shows `todayExpenses.slice(0, 3)` with no expansion option. Users with more than 3 expenses today must navigate to the History screen to see them all.

6. **Debts capped at 3 items with a "show all" button.** Unlike today's expenses, the debts card does have a "Показать все (N)" button that navigates to the Debts screen.

7. **`s2sStatus` field from API is used only for the overspent banner.** The main card color is recomputed independently by `s2sColor()`. If the two implementations ever diverge, the card color and the overspent banner can contradict each other.

8. **No explicit "DEFICIT" UI state.** When `s2sStatus === 'DEFICIT'`, the card shows `s2sToday = 0` in red. There is no special message explaining that obligations exceed income. The user sees "0 ₽" with no explanation.

9. **Period summary banner fires asynchronously.** The `GET /tg/periods/last-completed` call is made after `loadDashboard()` returns. Its failure is silently swallowed with `.catch(() => {})`. If this endpoint is slow or failing, the banner never appears without any user-visible indication.
