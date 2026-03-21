---
title: "Formulas and Calculation Policy"
document_type: Normative
status: Active
source_of_truth: YES
verified_against_code: Yes
last_updated: "2026-03-21"
related_docs:
  - path: ./income-allocation-semantics.md
    relation: "income section depends on this"
  - path: ./numerical-source-of-truth.md
    relation: "depends on this"
  - path: ./glossary.md
    relation: "terminology defined here"
  - path: ./system-spec-v1.md
    relation: "system-level context"
  - path: ../adr/adr-003-s2s-formula.md
    relation: "design decision"
  - path: ../adr/adr-002-money-in-minor-units.md
    relation: "design decision"
---

# Formulas and Calculation Policy

This document is the **single authoritative source** for how every number in PFM-bot is computed. All other documents that reference formulas must cite this file. When the code and this document disagree, the code (domain layer at `apps/api/src/domain/finance/`) is authoritative and this document must be updated.

**Breaking change 2026-03-21:** Engine migrated from `engine.ts` (Semantics A) to `domain/finance/` (Semantics B). Key changes: (1) `income.amount` = per-payout, no `payCount` division; (2) period boundaries = actual payout dates, not nominal calendar window; (3) `startNominalPayday` replaces UTC `endDate.getDate()` trigger derivation; (4) `totalDebtPaymentsRemainingForPeriod` replaces static `totalDebtPayments` sum.

**Scope:** Period boundary calculation, the full S2S engine pipeline, data types, rounding policy, persisted vs derived fields, status and color rules, carry-over mechanism, and worked examples.

**Not covered here:** UI layout, notification message text, subscription/billing logic, authentication, or the debt avalanche payoff projection (`buildAvalanchePlan` in `avalanche.ts`).

---

## 1. Glossary of Calculation Entities

All monetary values are in minor units (kopecks for RUB, cents for USD) unless stated otherwise.

| Term | Type | Persisted | Short Definition |
|------|------|-----------|-----------------|
| `daysTotal` | Int | Yes (Period) | Days from `actualStart` to `periodEnd`. Snapshot at creation. |
| `daysElapsed` | Int | No | Days from `periodStartDate` to today, inclusive. Minimum 1. |
| `daysLeft` | Int | No | `max(1, daysTotal - daysElapsed + 1)`. Days remaining including today. |
| `totalIncome` | Int (kopecks) | Yes (Period) | `startNominalPayday`-selected income for this period. `income.amount` is per-payout — no division. |
| `totalObligations` | Int (kopecks) | Yes (Period) | Sum of obligation amounts (all obligations, no due-day filter for period total). |
| `totalDebtPayments` | Int (kopecks) | Yes (Period) | **Remaining** min payments for debts due in this period. Rebuilt on every debt payment event. Equal to `totalDebtPaymentsRemainingForPeriod` from domain layer. |
| `afterFixed` | Int (kopecks) | No | `totalIncome - totalObligations - totalDebtPayments`. May be negative. |
| `reserve` | Int (kopecks) | Yes (Period) | 10% of `afterFixed` (5% fallback, 0 if `afterFixed <= 0`). |
| `freePool` | Int (kopecks) | No | `max(0, afterFixed - reserve)`. Base for EF and avalanche. |
| `efContribution` | Int (kopecks) | Yes (Period) | Amount directed to EF this period. |
| `avalanchePool` | Int (kopecks) | No (part of residual) | Extra debt payment toward focus debt. |
| `residual` | Int (kopecks) | No | `totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool`. May be negative. |
| `s2sPeriod` | Int (kopecks) | Yes (Period) | `max(0, residual)`. Total discretionary budget for the period. |
| `s2sDaily` (snapshot) | Int (kopecks) | Yes (Period) | `max(0, round(s2sPeriod / daysTotal))` at creation. Stale immediately. |
| `dynamicS2sDaily` | Int (kopecks) | No | `max(0, round(periodRemaining / daysLeft))`. Live per-request. |
| `s2sToday` | Int (kopecks) | No | `max(0, dynamicS2sDaily - expensesToday)`. Never negative. |
| `periodRemaining` | Int (kopecks) | No | `max(0, s2sPeriod - totalPeriodSpent)`. Floored at 0 for display. |
| `totalPeriodSpent` | Int (kopecks) | No | `SUM(expense.amount)` for all expenses in the active period. |
| `expensesToday` | Int (kopecks) | No | `SUM(expense.amount)` where `spentAt >= UTC midnight today`. |
| `carryOver` | Implicit | No | Emergent from `periodRemaining / daysLeft`. Not a named field. |
| `startNominalPayday` | Int (day 1–31) | No (computed in memory) | The **nominal** calendar payday that triggered the current period. Derived from `calculateActualPeriodBounds()` by mapping `lastActualPayday` back to its nominal day-of-month. Used for income matching. Not stored — recomputed on every snapshot rebuild. |
| `triggerPayday` | Int (day 1–31) | Yes (Period) | Stored alias for `startNominalPayday`. Written to `Period.triggerPayday` on every rebuild. For legacy periods (pre-2026-03-21) with null value: derived from `endDate.getDate()` as fallback (old Semantics A algorithm). |
| `totalDebtPaymentsRemainingForPeriod` | Int (kopecks) | No | Sum of `remainingRequiredThisPeriod` across all debts due in this period. Computed from `REQUIRED_MIN_PAYMENT` events. Input to `s2sPeriod` formula. |
| `freePool` | Int (kopecks) | No | `max(0, afterFixed - reserve)`. |
| `investPool` | Int (kopecks) | No | `max(0, freePool - efContribution)`. Base for avalanche percentage. |
| `monthlyObligations` | Int (kopecks) | No | Raw (non-prorated) sum of all obligation amounts. Used for EF target. |
| `efTarget` | Int (kopecks) | No | `monthlyObligations * targetMonths`. Never prorated. |
| `efDeficit` | Int (kopecks) | No | `max(0, efTarget - currentAmount)`. Zero when EF fully funded. |
| `isProratedStart` | Boolean | Yes (Period) | Always `false` since 2026-03-21. Actual payout boundaries are never prorated — they always start at the real payout date. |
| `fullPeriodDays` | Int | No | Legacy field from Semantics A proration. Unused in new engine. |
| `s2sStatus` | Enum | No | `OK` / `WARNING` / `OVERSPENT` / `DEFICIT`. Computed per request. |
| `s2sColor` | Enum | No | `green` / `orange` / `red`. Computed per request. |

---

## 2. Data Types and Rounding Policy

### 2.1 Minor Units Rule

- **All money is stored and computed as `Int` in minor units.**
- RUB: 1 ₽ = 100 kopecks. USD: 1 $ = 100 cents.
- Float and Decimal types are never used for money anywhere in the codebase.
- Display conversion: divide by 100. All display formatting happens in the frontend or `notify.ts`, never in `engine.ts`.

### 2.2 Rounding Rule

- **Every intermediate monetary calculation uses `Math.round()`.**
- `Math.round()` is applied immediately after each division or multiplication involving money.
- Precision is lost at each step. Over many periods, cumulative rounding error is bounded but non-zero (typically ±1 kopeck per operation, up to ±10 kopecks per period).

**All rounding points:**

```
// income per period: no division. inc.amount is already per-payout (Semantics B)
// Legacy (Semantics A, removed 2026-03-21): Math.round(inc.amount / payCount)
Math.round(afterFixed * 0.10)                            // (placeholder — see actual rounding points below)
Math.round(afterFixed * 0.10)                            // reserve 10%
Math.round(afterFixed * 0.05)                            // reserve 5% fallback
Math.round(efDeficit / 12)                               // monthly EF goal
Math.round(monthlyEFGoal * (daysTotal / fullPeriodDays)) // prorated EF goal
Math.round(freePool * 0.20)                              // EF cap (20%)
Math.round(investPool * 0.50)                            // high-APR avalanche
Math.round(investPool * 0.25)                            // low-APR avalanche
Math.round(investPool * 0.30)                            // EF-deficit high-APR avalanche
Math.round(periodRemaining / daysLeft)                   // daily limit
```

### 2.3 Input Validation

- Expense `amount` from `POST /tg/expenses` is rounded with `Math.round(amount)` before storage.
- Income, obligation, and debt amounts are rounded with `Math.round()` on creation/update.
- The engine receives already-integer values from DB and does not re-validate positivity of inputs.

---

## 3. Persisted vs Derived Fields

| Field | DB Table | Persisted | When Set | Notes |
|-------|----------|-----------|----------|-------|
| `Period.s2sPeriod` | Period | Yes | Period creation / recalculate | Snapshot. Does not change as expenses are added. |
| `Period.s2sDaily` | Period | Yes (snapshot) | Period creation / recalculate | Stale after first expense. Never used for live dashboard. |
| `Period.totalIncome` | Period | Yes | Period creation / recalculate | Snapshot. |
| `Period.totalObligations` | Period | Yes | Period creation / recalculate | Snapshot. |
| `Period.totalDebtPayments` | Period | Yes | Period creation / recalculate | Snapshot. |
| `Period.efContribution` | Period | Yes | Period creation / recalculate | Snapshot. |
| `Period.reserve` | Period | Yes | Period creation / recalculate | Snapshot. |
| `Period.daysTotal` | Period | Yes | Period creation / recalculate | Snapshot. |
| `Period.isProratedStart` | Period | Yes | Period creation / recalculate | |
| `Period.startDate` | Period | Yes | Period creation / recalculate | |
| `Period.endDate` | Period | Yes | Period creation / recalculate | |
| `dynamicS2sDaily` (live) | — | No | Computed per request | `Math.round(periodRemaining / daysLeft)` in `GET /tg/dashboard` |
| `s2sToday` | — | No | Computed per request | `max(0, dynamicS2sDaily - expensesToday)` |
| `periodRemaining` | — | No | Computed per request | `max(0, s2sPeriod - totalPeriodSpent)` |
| `daysLeft` | — | No | Computed per request | `Math.max(1, Math.ceil((endDate - now) / msPerDay))` |
| `Period.triggerPayday` | Period | Yes | Period creation / recalculate / rollover | Stored since v2 (2026-03-20). Fallback: derived from `endDate.getDate()` and `allPaydays` when null (legacy periods). |
| `DailySnapshot.s2sPlanned` | DailySnapshot | Yes | Nightly cron 23:55 UTC | Live `dynamicS2sDaily` at snapshot time |
| `DailySnapshot.s2sActual` | DailySnapshot | Yes | Nightly cron 23:55 UTC | `s2sPlanned - todayTotal` at 23:55 UTC — NOT floored at 0 |
| `DailySnapshot.isOverspent` | DailySnapshot | Yes | Nightly cron 23:55 UTC | `todayTotal > s2sPlanned` |

**Critical distinction:** `GET /tg/dashboard` reads `activePeriod.s2sPeriod` from DB but computes `dynamicS2sDaily` and `s2sToday` fresh on every request. It never reads `Period.s2sDaily` for the live display. The stored `Period.s2sDaily` is only used in completed period summaries.

---

## 4. "Today" Definition

- **Server-side:** UTC midnight — `new Date().setHours(0, 0, 0, 0)` on the server (which runs UTC).
- **Not user's local midnight.** For Moscow users (+3), "today" resets at 03:00 MSK.
- `expensesToday` = expenses with `spentAt >= UTC midnight`.
- `daysLeft` decrements at UTC midnight.
- Period rollover fires at 00:05 UTC (not at user's local midnight).

---

## 5. Period Boundary Calculation

Source: `calculatePeriodBounds(paydays: number[], fromDate: Date)` in `engine.ts`.

**Input:** `paydays` = sorted array of day-of-month integers (e.g., `[15]` or `[1, 15]`). `fromDate` = typically today.

### 5.1 Single Payday `[p]`

```
if day >= p:
  canonicalStart = this month, day p
  periodEnd      = next month, day p

if day < p:
  canonicalStart = last month, day p
  periodEnd      = this month, day p
```

### 5.2 Two Paydays `[a, b]` where a < b

```
if day >= b:
  canonicalStart = this month, day b
  periodEnd      = next month, day a

if day >= a and day < b:
  canonicalStart = this month, day a
  periodEnd      = this month, day b

if day < a:
  canonicalStart = last month, day b
  periodEnd      = this month, day a
```

### 5.3 Fallback (zero or more than 2 paydays)

Start = today, end = one month from today, `isProratedStart = false`. Not expected in normal operation.

### 5.4 isProratedStart

For single payday:
```
isProratedStart = (fromDate.getDate() !== payday)
```

For two paydays:
```
isProratedStart = (startOfDay(fromDate).getTime() !== canonicalStart.getTime())
```

When `isProratedStart = true`: `actualStart = startOfDay(fromDate)`. When false: `actualStart = canonicalStart`.

### 5.5 daysTotal and fullPeriodDays

```
daysBetween(start, end) = Math.max(1, Math.ceil((end - start) / msPerDay))

fullPeriodDays = daysBetween(canonicalStart, periodEnd)
daysTotal      = daysBetween(actualStart, periodEnd)
```

When `isProratedStart = false`: `daysTotal == fullPeriodDays`.
When `isProratedStart = true`: `daysTotal < fullPeriodDays`.

### 5.6 Effects of isProratedStart

When `isProratedStart = true`:

1. `totalObligations` is prorated: `Math.round(sum(obligations) * (daysTotal / fullPeriodDays))`
2. `totalDebtPayments` is prorated: `Math.round(sum(minPayments) * (daysTotal / fullPeriodDays))`
3. `efContribution.periodEFGoal` is prorated: `Math.round(monthlyEFGoal * (daysTotal / fullPeriodDays))`
4. **Income is NOT prorated.** The engine uses trigger-based income selection, which already returns the per-period installment.
5. **`efTarget` uses non-prorated `monthlyObligations`.** The EF target is always based on a full month's obligations — it is intentionally not prorated.

---

## 6. Step-by-Step Calculation

The function `calculateS2S(input: S2SInput)` in `engine.ts` executes these steps in order.

### Step 1: Time Variables

```
daysTotal   = daysBetween(periodStartDate, periodEndDate)
daysElapsed = daysBetween(periodStartDate, today)
daysLeft    = max(1, daysTotal - daysElapsed + 1)   // includes today
```

- `daysLeft` is floored at 1 to prevent division by zero. On the last day of a period, `daysLeft = 1`.
- `periodStartDate` passed to the engine is `actualStart` (already adjusted for proration).

### Step 2: Trigger Payday

```
allPaydays  = sorted unique union of all inc.paydays across all income records
endDay      = periodEndDate.getDate()
endDayIdx   = allPaydays.indexOf(endDay)

if endDayIdx > 0:
  triggerPayday = allPaydays[endDayIdx - 1]
else:
  triggerPayday = allPaydays[allPaydays.length - 1]
```

The trigger payday is the payday **immediately preceding** the period's end date in the sorted list. If the period ends on the first payday in the list (index 0), the trigger wraps to the last payday.

**Edge case:** If `endDay` is not in `allPaydays` (paydays changed after period creation), `endDayIdx = -1`. In this case, `hasTrigger = true` for all records — all income is included. This is a defensive fallback.

### Step 3: Income for Period

```
for each income record inc:
  hasTrigger = (endDayIdx !== -1) ? inc.paydays.includes(triggerPayday) : true
  if not hasTrigger: skip
  payCount     = max(1, inc.paydays.length)
  contribution = Math.round(inc.amount / payCount)

totalIncome = sum of all contributions
```

See `./income-allocation-semantics.md` for full explanation of multi-income and multi-payday configurations.

### Step 4: Obligations for Period

```
totalObligations = sum(obligation.amount for all active obligations)

if isProratedStart and fullPeriodDays > 0:
  totalObligations = Math.round(totalObligations * (daysTotal / fullPeriodDays))
```

Only active obligations are included. Proration uses `daysTotal` (actual period days from `actualStart`) as numerator and `fullPeriodDays` (canonical full period) as denominator.

### Step 5: Debt Minimum Payments

```
activeDebts = debts.filter(d => d.balance > 0)
totalDebtPayments = sum(d.minPayment for d in activeDebts)

if isProratedStart and fullPeriodDays > 0:
  totalDebtPayments = Math.round(totalDebtPayments * (daysTotal / fullPeriodDays))
```

Only debts with `balance > 0` are included. A debt with `balance = 0` is excluded even if `isPaidOff = false` in DB.

### Step 6: afterFixed

```
afterFixed = totalIncome - totalObligations - totalDebtPayments
```

May be negative if obligations and debt payments exceed income.

### Step 7: Reserve

```
reserve = Math.round(afterFixed * 0.10)
if reserve < 0: reserve = 0

afterReserve = afterFixed - reserve

if afterReserve < 0 and afterFixed > 0:
  reserve = Math.round(afterFixed * 0.05)
  if afterFixed - reserve < 0:
    reserve = 0
```

Reserve is always `>= 0`. When `afterFixed <= 0`, reserve = 0. Full reserve policy is in Section 8.

### Step 8: freePool

```
freePool = max(0, afterFixed - reserve)
```

Always non-negative. This is the pool from which both EF and avalanche are allocated.

### Step 9: EF Contribution

```
monthlyObligations = sum(obligation.amount for all active obligations)  // NOT prorated
efTarget      = monthlyObligations * emergencyFund.targetMonths
efDeficit     = max(0, efTarget - emergencyFund.currentAmount)

if efDeficit > 0 and freePool > 0:
  monthlyEFGoal = Math.round(efDeficit / 12)
  periodEFGoal  = monthlyEFGoal

  if isProratedStart and fullPeriodDays > 0:
    periodEFGoal = Math.round(monthlyEFGoal * (daysTotal / fullPeriodDays))

  efContribution = min(periodEFGoal, Math.round(freePool * 0.20))
  efContribution = min(efContribution, efDeficit)   // never overshoot target

else:
  efContribution = 0
```

**`monthlyObligations` uses raw (non-prorated) sum even in prorated periods.** This is intentional: the EF target should represent a full month's obligations, not a partial month's.

### Step 10: Avalanche Pool

```
focusDebt = activeDebts.find(d => d.isFocusDebt)

Case A: focusDebt exists AND efDeficit <= 0 (EF fully funded):
  investPool    = max(0, freePool - efContribution)
  if focusDebt.apr >= 0.18:
    avalanchePool = Math.round(investPool * 0.50)
  else:
    avalanchePool = Math.round(investPool * 0.25)
  avalanchePool = min(avalanchePool, focusDebt.balance)

Case B: focusDebt exists AND efDeficit > 0 AND focusDebt.apr >= 0.18:
  investPool    = max(0, freePool - efContribution)
  avalanchePool = Math.round(investPool * 0.30)
  avalanchePool = min(avalanchePool, focusDebt.balance)

Case C: focusDebt exists AND efDeficit > 0 AND focusDebt.apr < 0.18:
  avalanchePool = 0

Case D: no focusDebt:
  avalanchePool = 0
```

The `min(avalanchePool, focusDebt.balance)` cap prevents overpaying a nearly-paid-off debt. The difference is not redistributed — it flows into `s2sPeriod`.

### Step 11: residual and s2sPeriod

```
residual  = totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool
s2sPeriod = max(0, residual)
```

`residual` may be negative (DEFICIT status). `s2sPeriod` is floored at 0. Both values are preserved: `DEFICIT` is triggered by `residual < 0`, and `s2sPeriod = 0` in that case.

### Step 12: Daily Limit with Carry-Over (Engine)

```
periodRemaining = s2sPeriod - totalExpensesInPeriod   // NOT floored here in engine
s2sDaily        = max(0, Math.round(periodRemaining / daysLeft))
s2sToday        = max(0, s2sDaily - todayExpenses)
```

**Dashboard runtime (index.ts) — uses slightly different formulation:**

```typescript
const daysElapsed      = Math.max(1, Math.ceil((now - activePeriod.startDate) / msPerDay));
const daysLeft         = Math.max(1, activePeriod.daysTotal - daysElapsed + 1);
const periodRemaining  = Math.max(0, activePeriod.s2sPeriod - totalPeriodSpent);  // floored at 0
const dynamicS2sDaily  = Math.max(0, Math.round(periodRemaining / daysLeft));
const s2sToday         = Math.max(0, dynamicS2sDaily - todayTotal);
```

The dashboard floors `periodRemaining` at 0 before dividing; the engine does not. Both formulas produce the same result in all normal cases. They can differ by 1 day near period boundaries.

### Step 13: Status

**Engine (`engine.ts`):**

```
if residual < 0:               status = 'DEFICIT'
elif todayExpenses > s2sDaily: status = 'OVERSPENT'
elif s2sToday <= s2sDaily * 0.3: status = 'WARNING'
else:                          status = 'OK'
```

**Dashboard (`index.ts`) — slight variation:**

```
if activePeriod.s2sPeriod <= 0:                       s2sStatus = 'DEFICIT'
elif todayTotal > dynamicS2sDaily:                    s2sStatus = 'OVERSPENT'
elif dynamicS2sDaily > 0 and s2sToday / dynamicS2sDaily <= 0.3: s2sStatus = 'WARNING'
else:                                                 s2sStatus = 'OK'
```

The dashboard triggers DEFICIT when `s2sPeriod <= 0` (includes the case where `residual` was negative at creation). The engine triggers DEFICIT when `residual < 0` at calculation time. These are equivalent if `s2sPeriod` has not been manually set.

### Step 14: Color

```
if status == 'DEFICIT' or status == 'OVERSPENT':
  s2sColor = 'red'
elif s2sDaily > 0 and s2sToday / s2sDaily <= 0.3:
  s2sColor = 'red'
elif s2sDaily > 0 and s2sToday / s2sDaily <= 0.7:
  s2sColor = 'orange'
else:
  s2sColor = 'green'
```

WARNING status and the `<= 0.3` color condition both map to **red**, not orange. Orange applies only in the range `(0.3, 0.7]`.

---

## 7. Priority of Money Allocation (Waterfall)

```
totalIncome                     (trigger-selected income for this period)
  - totalObligations            (fixed costs; prorated if isProratedStart)
  - totalDebtPayments           (min payments; prorated if isProratedStart)
= afterFixed                    (may be negative → DEFICIT path)
  - reserve                     (10% buffer; 5% fallback; 0 if afterFixed <= 0)
= freePool                      (base for variable allocations)
  - efContribution              (EF goal; max 20% of freePool; zero if EF funded)
= investPool                    (freePool - efContribution)
  - avalanchePool               (APR-dependent share of investPool; 0 if no focus debt)
= residual                      (may be negative)
= s2sPeriod                     (max(0, residual))
  ÷ daysLeft                    (carry-over: recalculated each day)
= dynamicS2sDaily               (per-day limit with carry-over)
  - expensesToday
= s2sToday                      (remaining today)
```

---

## 8. Reserve Policy

The reserve is a buffer withheld from the discretionary income. It is NOT allocated to any specific purpose — it reduces `freePool` and therefore reduces `s2sPeriod`.

| Condition | Reserve Rate | Result |
|-----------|-------------|--------|
| `afterFixed > 0` | 10% | `reserve = Math.round(afterFixed * 0.10)` |
| `afterFixed > 0` and 10% makes `afterReserve < 0` | 5% fallback | In practice unreachable (10% of positive is always < positive). Defensive guard. |
| `afterFixed <= 0` | 0% | No buffer taken from a deficit |

**`reserve` is always `>= 0`.** The initial `if reserve < 0: reserve = 0` guard handles any floating-point anomaly.

---

## 9. EF Contribution Policy

- **`efTarget = monthlyObligations * targetMonths`** — always uses full monthly obligations, never prorated.
- Default `targetMonths = 3` (set at onboarding; stored in `EmergencyFund.targetMonths`).
- **`efDeficit = max(0, efTarget - currentAmount)`** — zero when EF is fully funded.
- **Monthly contribution goal: `Math.round(efDeficit / 12)`** — aims to fill the deficit over 12 months.
- For prorated periods: `periodEFGoal = Math.round(monthlyEFGoal * (daysTotal / fullPeriodDays))`.
- The contribution is double-capped:
  1. `min(periodEFGoal, Math.round(freePool * 0.20))` — prevents EF from consuming more than 20% of `freePool`
  2. `min(result, efDeficit)` — prevents overfunding
- When `efDeficit <= 0` or `freePool = 0`: `efContribution = 0`.

---

## 10. Avalanche Pool Policy

Four distinct cases determined by two boolean conditions (`efDeficit <= 0` and `focusDebt.apr >= 0.18`):

| EF funded (`efDeficit <= 0`) | Focus debt APR | Rate | Basis |
|------------------------------|----------------|------|-------|
| Yes | `>= 18%` (0.18) | 50% of `investPool` | Case A |
| Yes | `< 18%` | 25% of `investPool` | Case A |
| No | `>= 18%` | 30% of `investPool` | Case B |
| No | `< 18%` | 0% | Case C |
| N/A | N/A (no focusDebt) | 0% | Case D |

In all cases: `avalanchePool = min(computed, focusDebt.balance)`.

`investPool = max(0, freePool - efContribution)`. When EF is funded, `efContribution = 0`, so `investPool = freePool`.

---

## 11. Carry-Over Mechanism

The daily limit adjusts every day to reflect actual spending. This is implicit — nothing is stored.

**How it works:**

- Day 1: `dynamicS2sDaily = s2sPeriod / daysTotal`
- After Day 1 with spend `X < dynamicS2sDaily`: `periodRemaining = s2sPeriod - X` (larger than expected)
- Day 2: `dynamicS2sDaily = (s2sPeriod - X) / (daysTotal - 1)` — higher than original
- After Day 1 with overspend: `periodRemaining` is smaller, Day 2 `dynamicS2sDaily` is lower
- `periodRemaining` is floored at 0 in the dashboard: `max(0, s2sPeriod - totalPeriodSpent)`. If overspent, `periodRemaining = 0` and `dynamicS2sDaily = 0`.

Yesterday's overspending reduces tomorrow's daily limit. Yesterday's under-spending increases tomorrow's.

---

## 12. Status and Color Rules

### Status Rules — Engine (`engine.ts`)

| Status | Condition | Priority |
|--------|-----------|----------|
| `DEFICIT` | `residual < 0` | 1st (highest) |
| `OVERSPENT` | `todayExpenses > s2sDaily` | 2nd |
| `WARNING` | `s2sToday <= s2sDaily * 0.3` | 3rd |
| `OK` | None of the above | Default |

### Status Rules — Dashboard (`index.ts`)

| Status | Condition |
|--------|-----------|
| `DEFICIT` | `activePeriod.s2sPeriod <= 0` |
| `OVERSPENT` | `todayTotal > dynamicS2sDaily` |
| `WARNING` | `dynamicS2sDaily > 0 && s2sToday / dynamicS2sDaily <= 0.3` |
| `OK` | None of the above |

### Color Rules

| Color | Condition |
|-------|-----------|
| `red` | `status == 'DEFICIT'` or `status == 'OVERSPENT'` |
| `red` | `s2sDaily > 0` and `s2sToday / s2sDaily <= 0.3` (WARNING territory) |
| `orange` | `s2sDaily > 0` and `s2sToday / s2sDaily` in `(0.3, 0.7]` |
| `green` | All other cases, including `s2sDaily = 0` with no deficit |

---

## 13. Source of Truth Hierarchy

When a calculation result is disputed, the canonical answer is found by tracing through Section 6. The hierarchy of authority:

1. **`engine.ts` (`calculateS2S`)** — canonical formula implementation
2. **This document** — canonical description of that formula
3. **API response** (`GET /tg/dashboard`) — authoritative for current values at a point in time
4. **DB `Period` record** — snapshot at period creation; stale for live calculations
5. **UI display** — derived from API response; never the source of truth

---

## 14. Known Limitations

These are current behaviors that must be understood to correctly interpret results. They are not planned fixes.

### 14.1 triggerPayday Persistence (Fixed in v2)

`triggerPayday` is now stored in `Period.triggerPayday` on period creation, recalculation, and rollover (v2, 2026-03-20). For legacy periods where the field is null, the engine falls back to deriving it from `periodEndDate.getDate()` and `allPaydays`. See GAP-001 / TD-011 (closed).

### 14.2 efTarget Uses Full Monthly Obligations Even in Prorated Periods

`efTarget = monthlyObligations * targetMonths` always uses the raw obligation sum. The `efContribution` is prorated, but the target it aims for is not. This is intentional (the EF should cover a full month), but creates an asymmetry.

### 14.3 Integer Rounding Accumulates

Each `Math.round()` introduces up to ±0.5 kopeck of error. With 12+ operations per calculation and hundreds of periods per year, cumulative error is small but non-zero. Accepted as a design trade-off (see `../adr/adr-002-money-in-minor-units.md`).

### 14.4 daysLeft Differs Between Engine and Dashboard

- `engine.ts`: `daysLeft = max(1, daysTotal - daysElapsed + 1)`
- `index.ts` dashboard: `daysLeft = max(1, ceil((endDate - now) / msPerDay))`

These agree in most cases. They can differ by 1 near period boundaries or when `now` is close to UTC midnight.

### 14.5 Period Rollover Cron at 00:05 UTC

Rollover fires at 00:05 UTC. Users in non-UTC timezones experience rollover at their local equivalent (e.g., 03:05 MSK). Users west of UTC may experience rollover during the prior calendar day.

### 14.6 DailySnapshot at 23:55 UTC

The snapshot cron fires at 23:55 UTC. For Moscow users (+3), this is 02:55 MSK the next day. Snapshots reflect UTC day boundaries, not user local day boundaries.

### 14.7 avalanchePool Cap When focusDebt.balance Approaches Zero

When a focus debt's balance is small, `min(avalanchePool, focusDebt.balance)` caps the pool far below the APR-driven percentage. The difference is not redistributed — it flows into `s2sPeriod`.

### 14.8 The 5% Reserve Fallback Is Unreachable

The fallback (`if afterReserve < 0 and afterFixed > 0`) cannot trigger under normal arithmetic: if `afterFixed > 0`, then `afterFixed * 0.10 < afterFixed`, so `afterReserve = afterFixed - 10% > 0`. The branch is a defensive guard only.

---

## 15. Cash Anchor Live Window (v2)

*Added 2026-03-20.*

When `Period.cashAnchorAmount` is set (via `POST /tg/cash-anchor`), the dashboard uses a different calculation path instead of the period-based carry-over model.

### 15.1 When the Live Window Is Active

`usesLiveWindow = true` when `Period.cashAnchorAmount IS NOT NULL`.

In this mode the dashboard computes:

```
nextIncomeDate      = next actual payday, adjusted for Russian work calendar
                      (if payday falls on weekend/holiday, shifted to previous business day)
daysToNextIncome    = max(1, daysBetween(today, nextIncomeDate))
reservedUpcoming    = sum of obligation.amount + debt.minPayment
                      WHERE dueDay IN [today.day, nextIncomeDate.day)
                      (only obligations/debts whose dueDay falls within the current window)
expensesSinceAnchor = sum(expense.amount) WHERE spentAt >= Period.cashAnchorAt
freeCashPool        = max(0, cashAnchorAmount - reservedUpcoming - expensesSinceAnchor)
s2sDaily            = floor(freeCashPool / daysToNextIncome)   ← floor, not round (conservative)
```

### 15.2 Key Semantics

- **Expenses before `cashAnchorAt` are NOT deducted.** They are already reflected in the anchor amount the user provided.
- **`reservedUpcoming`** only includes obligations and debts whose `dueDay` falls in `[today, nextIncomeDate)`. Obligations/debts due after the next income date are not reserved in the current window.
- **`daysToNextIncome`** is floored at 1 to prevent division by zero.
- **`floor()` vs `round()`** — the live window uses `Math.floor()` for the daily limit (conservative), while the period model uses `Math.round()`.
- **`reservedUpcomingObligations`** and **`reservedUpcomingDebtPayments`** are the two components of `reservedUpcoming`, returned separately in the dashboard response for explainability.

### 15.3 Russian Work Calendar

Paydays that fall on a Russian public holiday or weekend are shifted to the **previous business day**. This is used when computing `nextIncomeDate` and `lastIncomeDate` (not for period boundary calculation, which remains calendar-date based).

### 15.4 Fallback When No Anchor Is Set

When `cashAnchorAmount IS NULL`, the dashboard uses the existing period-based model:

```
s2sDaily = round((s2sPeriod - totalPeriodSpent) / daysLeft)
```

This is unchanged from v1. `usesLiveWindow = false` in this case.

### 15.5 New Dashboard Fields (v2)

| Field | Type | Description |
|-------|------|-------------|
| `cashOnHand` | Int? | User's cash anchor in minor units. `null` if not set. |
| `cashAnchorAt` | DateTime? | When cash anchor was last set. |
| `lastIncomeDate` | DateTime? | Last actual payday date (work-calendar adjusted). |
| `nextIncomeDate` | DateTime? | Next actual payday date (work-calendar adjusted). |
| `nextIncomeAmount` | Int | Expected next income in minor units. |
| `daysToNextIncome` | Int? | Days until next income. `null` if no anchor. |
| `reservedUpcoming` | Int | Sum reserved for obligations + debts in current window. |
| `reservedUpcomingObligations` | Int | Reserved for obligations only. |
| `reservedUpcomingDebtPayments` | Int | Reserved for debt min payments only. |
| `windowStart` | DateTime | Effective window start (`cashAnchorAt` or `periodStart`). |
| `windowEnd` | DateTime | Effective window end (`nextIncomeDate` or `periodEnd`). |
| `usesLiveWindow` | Boolean | `true` when cash anchor model is active. |

---

## 16. Worked Examples

All amounts in kopecks. To convert to rubles: divide by 100.

---

### Example 1: Simple Case — 500k ₽/month, No Obligations, No Debts

**Setup:**
- Income: `50,000,000` kopecks (500,000 ₽/month), single payday on 15th
- Obligations: 0, Debts: none
- EF: `currentAmount = 0`, `targetMonths = 3`
- Today: March 15, 2026 (payday — full period, not prorated)
- No expenses

**Step 1 — Period bounds:**
- `calculatePeriodBounds([15], March 15)`:
  - `day = 15 >= 15` → `canonicalStart = March 15`, `periodEnd = April 15`
  - `isProratedStart = (15 != 15) = false`
  - `actualStart = March 15`
  - `fullPeriodDays = daysTotal = daysBetween(Mar 15, Apr 15) = 31`

**Step 2 — Time variables:**
- `daysTotal = 31`, `daysElapsed = 1`, `daysLeft = max(1, 31 - 1 + 1) = 31`

**Step 3 — triggerPayday:**
- `allPaydays = [15]`, `endDay = 15`, `endDayIdx = 0`
- `endDayIdx > 0` is false → `triggerPayday = allPaydays[0] = 15`

**Step 4 — Income:**
- `inc.paydays.includes(15) = true`, `payCount = 1`
- `totalIncome = Math.round(50,000,000 / 1) = 50,000,000`

**Steps 5–6 — Obligations, debts, afterFixed:**
- `totalObligations = 0`, `totalDebtPayments = 0`
- `afterFixed = 50,000,000`

**Step 7 — Reserve:**
- `reserve = Math.round(50,000,000 * 0.10) = 5,000,000`

**Step 8 — freePool:**
- `freePool = max(0, 50,000,000 - 5,000,000) = 45,000,000`

**Step 9 — EF:**
- `monthlyObligations = 0` → `efTarget = 0` → `efDeficit = 0`
- `efContribution = 0`

**Step 10 — Avalanche:** No debts → `avalanchePool = 0`

**Step 11 — s2sPeriod:**
- `residual = 50,000,000 - 0 - 0 - 5,000,000 - 0 - 0 = 45,000,000`
- `s2sPeriod = 45,000,000` (450,000 ₽)

**Step 12 — Daily:**
- `periodRemaining = 45,000,000`, `daysLeft = 31`
- `dynamicS2sDaily = Math.round(45,000,000 / 31) = Math.round(1,451,612.9) = 1,451,613`
- `s2sToday = max(0, 1,451,613 - 0) = 1,451,613` (14,516 ₽)

**Status:** `OK`, `green`

---

### Example 2: Two-Payday Income — Two Separate Records

**Setup:**
- Record 1: `{amount: 25,000,000, paydays: [1]}` (250,000 ₽ on 1st)
- Record 2: `{amount: 25,000,000, paydays: [15]}` (250,000 ₽ on 15th)
- Obligations: 0, Debts: none, EF: funded
- Period: March 15 → April 1 (full, not prorated, today = March 15)

**triggerPayday:**
- `allPaydays = [1, 15]`, `endDay = 1` (April 1), `endDayIdx = 0`
- `endDayIdx > 0` is false → `triggerPayday = allPaydays[1] = 15`

**Income:**
- Record 1 (`paydays: [1]`): `inc.paydays.includes(15) = false` → **skipped**
- Record 2 (`paydays: [15]`): `inc.paydays.includes(15) = true`, `payCount = 1`
- `totalIncome = 25,000,000` (250,000 ₽)

**Note:** Only the 15th-payday income counts. The 1st-payday income counts in the **next** period (April 1 → April 15, where `triggerPayday = 1`).

**s2sPeriod (17-day period, no obligations):**
- `afterFixed = 25,000,000`
- `reserve = Math.round(25,000,000 * 0.10) = 2,500,000`
- `s2sPeriod = 25,000,000 - 2,500,000 = 22,500,000` (225,000 ₽)
- `dynamicS2sDaily = Math.round(22,500,000 / 17) = 1,323,529` (13,235 ₽)

---

### Example 3: Two-Payday Single Record (Equivalent to Example 2)

**Setup:**
- Single record: `{amount: 50,000,000, paydays: [1, 15]}` (500,000 ₽/month, both paydays)
- Same period as Example 2: March 15 → April 1

**triggerPayday:** Same derivation → `triggerPayday = 15`

**Income:**
- `inc.paydays.includes(15) = true`, `payCount = max(1, 2) = 2`
- `contribution = Math.round(50,000,000 / 2) = 25,000,000`
- `totalIncome = 25,000,000`

**Result:** Identical to Example 2. Both configurations produce the same `totalIncome`.

---

### Example 4: With Obligations and Debt

**Setup:**
- Income: `20,000,000` kopecks (200,000 ₽), single payday, full 30-day period
- Obligation: `5,000,000` (50,000 ₽/month rent)
- Debt: `{balance: 10,000,000, apr: 0.20, minPayment: 1,000,000, isFocusDebt: true}`
- EF: funded (`efDeficit = 0`)
- No expenses

**Step 3 — Income:** `totalIncome = 20,000,000`
**Step 4 — Obligations:** `totalObligations = 5,000,000`
**Step 5 — Debt payments:** `totalDebtPayments = 1,000,000`
**Step 6 — afterFixed:** `20,000,000 - 5,000,000 - 1,000,000 = 14,000,000`
**Step 7 — Reserve:** `Math.round(14,000,000 * 0.10) = 1,400,000`
**Step 8 — freePool:** `14,000,000 - 1,400,000 = 12,600,000`
**Step 9 — EF:** `efContribution = 0` (funded)
**Step 10 — Avalanche (Case A, APR >= 18%):**
- `investPool = 12,600,000`
- `avalanchePool = Math.round(12,600,000 * 0.50) = 6,300,000`
- `avalanchePool = min(6,300,000, 10,000,000) = 6,300,000`
**Step 11 — residual:** `20,000,000 - 5,000,000 - 1,000,000 - 1,400,000 - 0 - 6,300,000 = 6,300,000`
**s2sPeriod:** `6,300,000` (63,000 ₽)
**dynamicS2sDaily:** `Math.round(6,300,000 / 30) = 210,000` (2,100 ₽/day)

Total debt payment this period: `minPayment (1,000,000) + avalanchePool (6,300,000) = 7,300,000` (73,000 ₽).

---

### Example 5: Prorated Period Start

**Setup:**
- User completed onboarding on March 20. Payday: 15th.
- Income: `12,000,000` (120,000 ₽/month)
- Obligations: `3,000,000` (30,000 ₽/month)
- EF: funded

**Period bounds:**
- `calculatePeriodBounds([15], March 20)`:
  - `day = 20 >= 15` → `canonicalStart = March 15`, `periodEnd = April 15`
  - `isProratedStart = (20 != 15) = true`, `actualStart = March 20`
  - `fullPeriodDays = daysBetween(Mar 15, Apr 15) = 31`
  - `daysTotal = daysBetween(Mar 20, Apr 15) = 26`

**Income (NOT prorated):** `totalIncome = 12,000,000`

**Obligations (prorated):**
- `totalObligations = Math.round(3,000,000 * (26 / 31)) = Math.round(2,516,129.0) = 2,516,129`

**afterFixed:** `12,000,000 - 2,516,129 = 9,483,871`
**Reserve:** `Math.round(9,483,871 * 0.10) = 948,387`
**freePool:** `9,483,871 - 948,387 = 8,535,484`
**s2sPeriod:** `8,535,484`
**dynamicS2sDaily (day 1):** `Math.round(8,535,484 / 26) = 328,288`

Comparison: full period would have `totalObligations = 3,000,000`, `s2sPeriod = 8,100,000`, `dynamicS2sDaily ≈ 261,290`. The prorated period gives the user a **higher** daily limit because obligations were scaled down for the shorter period.

---

### Example 6: Carry-Over — Overspent Yesterday

**Setup:**
- Period: 20 days. `s2sPeriod = 10,000,000`.
- After 5 days: `totalPeriodSpent = 3,500,000`.
- Original Day 1 `dynamicS2sDaily` was `Math.round(10,000,000 / 20) = 500,000`.
- Expected 5-day spend at 500,000/day = 2,500,000. Actual = 3,500,000. **Overspent by 1,000,000.**

**Day 6 calculation:**
- `daysLeft = 20 - 5 + 1 = 16`
- `periodRemaining = max(0, 10,000,000 - 3,500,000) = 6,500,000`
- `dynamicS2sDaily = Math.round(6,500,000 / 16) = Math.round(406,250) = 406,250`
- New limit (406,250) is **lower** than original (500,000) because overspending reduced `periodRemaining`.

If `todayExpenses = 450,000` on Day 6:
- `s2sToday = max(0, 406,250 - 450,000) = 0`
- `todayExpenses (450,000) > dynamicS2sDaily (406,250)` → `status = OVERSPENT`, `s2sColor = red`

---

### Example 7: EF Not Funded — efContribution Calculated

**Setup:**
- Income: `15,000,000` (150,000 ₽), obligations: `4,000,000` (40,000 ₽), no debts
- EF: `currentAmount = 0`, `targetMonths = 3`
- Full 30-day period

**Steps:**
- `afterFixed = 15,000,000 - 4,000,000 = 11,000,000`
- `reserve = Math.round(11,000,000 * 0.10) = 1,100,000`
- `freePool = 11,000,000 - 1,100,000 = 9,900,000`
- `monthlyObligations = 4,000,000`
- `efTarget = 4,000,000 * 3 = 12,000,000`
- `efDeficit = max(0, 12,000,000 - 0) = 12,000,000`
- `monthlyEFGoal = Math.round(12,000,000 / 12) = 1,000,000`
- `periodEFGoal = 1,000,000` (not prorated)
- 20% cap: `Math.round(9,900,000 * 0.20) = 1,980,000`
- `efContribution = min(1,000,000, 1,980,000) = 1,000,000`
- `efContribution = min(1,000,000, 12,000,000) = 1,000,000`
- `residual = 15,000,000 - 4,000,000 - 0 - 1,100,000 - 1,000,000 - 0 = 8,900,000`
- `s2sPeriod = 8,900,000` (89,000 ₽)
- `dynamicS2sDaily = Math.round(8,900,000 / 30) = 296,667` (2,967 ₽/day)

At this pace, EF will be funded in 12 periods (1 year).

---

### Example 8: DEFICIT Case — Obligations Exceed Income

**Setup:**
- Income: `5,000,000` (50,000 ₽), obligations: `6,000,000` (60,000 ₽), no debts
- Full 30-day period

**Steps:**
- `afterFixed = 5,000,000 - 6,000,000 = -1,000,000`
- `reserve = Math.round(-1,000,000 * 0.10) = -100,000` → floored to `0`
- `freePool = max(0, -1,000,000 - 0) = 0`
- `efContribution = 0` (freePool = 0), `avalanchePool = 0`
- `residual = 5,000,000 - 6,000,000 - 0 - 0 - 0 - 0 = -1,000,000`
- `s2sPeriod = max(0, -1,000,000) = 0`
- `status = DEFICIT` (residual < 0), `s2sColor = red`
- `dynamicS2sDaily = 0`, `s2sToday = 0`

The user has no discretionary budget. Fixed costs exceed income by 10,000 ₽/month.