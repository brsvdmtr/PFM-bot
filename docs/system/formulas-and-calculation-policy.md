# Formulas and Calculation Policy

<!-- Document metadata -->
Document Type: Normative
Status: Active — Verified Against Code
Source of Truth: YES — this document supersedes all other formula descriptions
Verified Against Code: Yes (`apps/api/src/engine.ts`, `apps/api/src/index.ts`, `apps/api/src/cron.ts`)
Last Updated: 2026-03-20
Related Docs:
  - system/income-allocation-semantics.md
  - system/numerical-source-of-truth.md
  - system/glossary.md
  - adr/adr-003-s2s-formula.md

---

## 1. Overview and Scope

This document is the single authoritative source for how every number in PFM-bot is computed. It covers:

- Period boundary calculation (`calculatePeriodBounds`)
- The full S2S engine pipeline (`calculateS2S`)
- Data types, rounding policy, and unit conventions
- Which fields are persisted vs derived at request time
- Status and color rules
- All known limitations and gaps in the current implementation

**What this document does NOT cover:**

- UI layout or display formatting
- Telegram notification message text
- Subscription or billing logic
- Authentication or session handling
- Debt avalanche payoff projection (`buildAvalanchePlan` in `avalanche.ts`)

**How to use this document:**

When a calculation result is disputed, the canonical answer is found by tracing through the numbered steps in Section 6. If the code and this document disagree, the code is authoritative and this document must be updated. All other documents referencing formulas must cite this file.

---

## 2. Canonical Glossary (Short Definitions)

Full definitions are in `system/glossary.md`. Brief inline references:

| Term | Short Definition |
|------|-----------------|
| `s2sPeriod` | Total safe-to-spend budget for the entire period. Persisted at period creation. |
| `s2sDaily` (live) | Per-day limit adjusted for carry-over. Derived at request time from `periodRemaining / daysLeft`. Never read from DB for live display. |
| `s2sToday` | Remaining safe-to-spend for the rest of today. Derived as `max(0, s2sDaily - todayExpenses)`. Never persisted. |
| `periodRemaining` | `s2sPeriod - totalPeriodSpent`. Never persisted. |
| `daysLeft` | Calendar days from today through period end, inclusive. Minimum 1. |
| `triggerPayday` | The payday day-of-month that caused this period to begin. Computed at runtime; never stored in DB. |
| `isProratedStart` | True if the user joined mid-period (today != canonicalPeriodStart). Affects obligation and debt payment scaling. |
| `fullPeriodDays` | Days in the canonical (non-prorated) period. Used as denominator for proration. |
| `daysTotal` | Actual days from `actualStart` to `periodEnd`. May equal `fullPeriodDays` when not prorated. |
| `afterFixed` | `totalIncome - totalObligations - totalDebtPayments`. Intermediate variable. |
| `freePool` | `max(0, afterFixed - reserve)`. Base for EF and avalanche allocation. |
| `reserve` | Buffer retained from `afterFixed`. 10% target, fallback 5%, fallback 0. |
| `efContribution` | Amount directed to emergency fund this period. |
| `avalanchePool` | Extra payment toward focus debt this period. |
| `residual` | `totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool`. May be negative (DEFICIT). |

---

## 3. Data Types and Rounding Policy

### 3.1 Monetary Amounts

- **All money is stored and computed as integers (Int) in minor units.**
- For RUB: minor unit = kopeck (1 RUB = 100 kopecks).
- For USD: minor unit = cent (1 USD = 100 cents).
- **Float and Decimal types are never used for money anywhere in the codebase.**
- Display conversion: divide by 100. All display formatting happens in the frontend or notify.ts, never in engine.ts.

### 3.2 Rounding

- **Every intermediate calculation uses `Math.round()`.**
- `Math.round()` is applied immediately after each division or multiplication involving money.
- This means precision is lost at each step. Over 30+ periods, cumulative rounding error is possible but bounded (typically ±1 kopeck per operation).
- Specific points where precision is lost:
  - `Math.round(inc.amount / payCount)` — income split by payday count
  - `Math.round(totalObligations * (daysTotal / fullPeriodDays))` — proration
  - `Math.round(totalDebtPayments * (daysTotal / fullPeriodDays))` — proration
  - `Math.round(afterFixed * 0.10)` — reserve
  - `Math.round(afterFixed * 0.05)` — reserve fallback
  - `Math.round(efDeficit / 12)` — monthly EF goal
  - `Math.round(monthlyEFGoal * (daysTotal / fullPeriodDays))` — prorated EF goal
  - `Math.round(freePool * 0.20)` — EF cap
  - `Math.round(investPool * 0.50)` — high-APR avalanche
  - `Math.round(investPool * 0.25)` — low-APR avalanche
  - `Math.round(investPool * 0.30)` — EF-unfunded high-APR avalanche
  - `Math.round(periodRemaining / daysLeft)` — daily limit
  - `Math.round(amount)` on expense input — client-supplied values are rounded on entry

### 3.3 Input Validation

- Expense amounts passed to `POST /tg/expenses` are rounded with `Math.round(amount)` before storage.
- Income, obligation, and debt amounts are rounded with `Math.round()` on creation/update.
- The engine itself receives already-integer values from DB; it does not re-validate positivity of inputs.

---

## 4. Persisted vs Derived Fields

| Field | DB Table | Persisted? | When Set | Notes |
|-------|----------|------------|----------|-------|
| `period.s2sPeriod` | Period | Yes | Period creation or `/tg/periods/recalculate` | Snapshot. Does not change as expenses are added. |
| `period.s2sDaily` | Period | Yes (snapshot) | Period creation or recalculate | Stale the moment expenses are logged. Never used for live display. |
| `period.totalIncome` | Period | Yes | Period creation or recalculate | Snapshot. |
| `period.totalObligations` | Period | Yes | Period creation or recalculate | Snapshot. |
| `period.totalDebtPayments` | Period | Yes | Period creation or recalculate | Snapshot. |
| `period.efContribution` | Period | Yes | Period creation or recalculate | Snapshot. |
| `period.reserve` | Period | Yes | Period creation or recalculate | Snapshot. |
| `period.daysTotal` | Period | Yes | Period creation or recalculate | Snapshot. |
| `period.isProratedStart` | Period | Yes | Period creation or recalculate | |
| `period.startDate` | Period | Yes | Period creation or recalculate | |
| `period.endDate` | Period | Yes | Period creation or recalculate | |
| `s2sDaily` (live dashboard) | — | No | Computed per request | `Math.round(periodRemaining / daysLeft)` in `GET /tg/dashboard` |
| `s2sToday` | — | No | Computed per request | `max(0, s2sDaily_live - todayExpenses)` |
| `periodRemaining` | — | No | Computed per request | `max(0, s2sPeriod - totalPeriodSpent)` |
| `daysLeft` | — | No | Computed per request | `Math.max(1, Math.ceil((endDate - now) / msPerDay))` |
| `triggerPayday` | — | No | Computed per engine call | Derived from `endDate.getDate()` and `allPaydays` |
| `DailySnapshot.s2sPlanned` | DailySnapshot | Yes (nightly) | Cron at 23:55 UTC | Reflects live s2sDaily at snapshot time |
| `DailySnapshot.s2sActual` | DailySnapshot | Yes (nightly) | Cron at 23:55 UTC | `s2sPlanned - todayTotal` at 23:55 UTC; not floored at 0 |
| `DailySnapshot.isOverspent` | DailySnapshot | Yes (nightly) | Cron at 23:55 UTC | `todayTotal > s2sPlanned` |

**Critical distinction:** The `GET /tg/dashboard` endpoint reads `activePeriod.s2sPeriod` from DB but computes `s2sDaily` and `s2sToday` fresh every request. It does not read `period.s2sDaily`. The stored `period.s2sDaily` is only used in legacy/summary views (e.g., completed period summary).

---

## 5. Period Definition

### 5.1 What a Period Is

A period is the interval between two consecutive payday events. The user spends from a fixed budget (`s2sPeriod`) during this interval. When the period ends, a new one begins automatically (via cron rollover at 00:05 UTC).

A period has:
- A canonical start: the payday date that began it
- A canonical end: the next payday date
- An actual start: may differ from canonical start if the user joined mid-period (`isProratedStart = true`)

### 5.2 Period Boundary Calculation

Source: `calculatePeriodBounds(paydays: number[], fromDate: Date)` in `engine.ts`.

Input: `paydays` = sorted array of day-of-month integers (e.g., `[15]` or `[1, 15]`). `fromDate` = the date to compute bounds relative to (typically today).

#### Case: Single payday `[p]`

```
if day >= p:
  canonicalStart = this month, day p
  periodEnd     = next month, day p

if day < p:
  canonicalStart = last month, day p
  periodEnd     = this month, day p
```

#### Case: Two paydays `[a, b]` where a < b

```
if day >= b:
  canonicalStart = this month, day b
  periodEnd     = next month, day a

if day >= a and day < b:
  canonicalStart = this month, day a
  periodEnd     = this month, day b

if day < a:
  canonicalStart = last month, day b
  periodEnd     = this month, day a
```

#### Fallback (zero or >2 paydays)

If `paydays.length !== 1` and `paydays.length !== 2`, the engine falls back to: start = today, end = one month from today, `isProratedStart = false`. This case is not expected in normal operation.

#### isProratedStart

For single payday:
```
isProratedStart = (fromDate.getDate() !== payday)
```

For two paydays:
```
isProratedStart = (startOfDay(fromDate).getTime() !== canonicalStart.getTime())
```

In both cases: if `isProratedStart = true`, then `actualStart = startOfDay(fromDate)`, else `actualStart = canonicalStart`.

#### daysTotal and fullPeriodDays

```
fullPeriodDays = daysBetween(canonicalStart, periodEnd)
daysTotal      = daysBetween(actualStart, periodEnd)
```

`daysBetween(start, end)` is defined as `Math.max(1, Math.ceil((end - start) / msPerDay))`. It returns a minimum of 1.

When `isProratedStart = false`: `daysTotal = fullPeriodDays`.
When `isProratedStart = true`: `daysTotal < fullPeriodDays`.

### 5.3 Effects of isProratedStart

When `isProratedStart = true`:
1. `totalObligations` is prorated: `Math.round(sum(obligations) * (daysTotal / fullPeriodDays))`
2. `totalDebtPayments` is prorated: `Math.round(sum(minPayments) * (daysTotal / fullPeriodDays))`
3. `efContribution.periodEFGoal` is prorated: `Math.round(monthlyEFGoal * (daysTotal / fullPeriodDays))`
4. Income is NOT prorated. The engine uses trigger-based income selection, which already returns the per-period installment.

---

## 6. Step-by-Step Calculation

The function `calculateS2S(input: S2SInput)` in `engine.ts` executes the following steps in order.

### Step 1: Time Variables

```
daysTotal   = daysBetween(periodStartDate, periodEndDate)
daysElapsed = daysBetween(periodStartDate, today)
daysLeft    = max(1, daysTotal - daysElapsed + 1)   // includes today
```

Unit: days (integer).

Note: `daysLeft` is floored at 1 to prevent division by zero. On the last day of a period, `daysLeft = 1`.

Note: `periodStartDate` passed to the engine is `actualStart` (already adjusted for proration). So `daysTotal` here equals `bounds.daysTotal`, not `bounds.fullPeriodDays`.

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

Unit: day-of-month integer.

The trigger payday is the payday immediately preceding the period's end date in the sorted list. If the period ends on the first payday in the list (index 0), the trigger wraps to the last payday (the previous period's end-initiator).

**Edge case:** If `endDay` is not present in `allPaydays` (e.g., paydays were changed after period creation), `endDayIdx = -1`. In this case, `hasTrigger` is set to `true` for all income records, meaning all income is included in the period.

### Step 3: Income for Period

```
for each income record inc:
  hasTrigger = (endDayIdx !== -1) ? inc.paydays.includes(triggerPayday) : true
  if not hasTrigger: skip
  payCount = max(1, inc.paydays.length)
  contribution = Math.round(inc.amount / payCount)

totalIncome = sum of all contributions
```

Unit: kopecks (Int).

This is the income that counts for this period. See `system/income-allocation-semantics.md` for full explanation of multi-income and multi-payday configurations.

### Step 4: Obligations for Period

```
totalObligations = sum(obligation.amount for all active obligations)

if isProratedStart and fullPeriodDays > 0:
  totalObligations = Math.round(totalObligations * (daysTotal / fullPeriodDays))
```

Unit: kopecks (Int).

The proration uses `daysTotal` (actual period days from actualStart) as numerator and `fullPeriodDays` (canonical full period) as denominator. Note that `efTarget` in Step 8 uses the non-prorated sum — this is a known asymmetry (see Section 13).

### Step 5: Debt Minimum Payments

```
activeDebts = debts.filter(d => d.balance > 0)
totalDebtPayments = sum(d.minPayment for d in activeDebts)

if isProratedStart and fullPeriodDays > 0:
  totalDebtPayments = Math.round(totalDebtPayments * (daysTotal / fullPeriodDays))
```

Unit: kopecks (Int).

Only debts with `balance > 0` are included. A debt with `balance = 0` is excluded even if `isPaidOff = false` in DB (though in practice the payment endpoint sets `isPaidOff = true` when balance reaches 0).

### Step 6: afterFixed

```
afterFixed = totalIncome - totalObligations - totalDebtPayments
```

Unit: kopecks (Int). May be negative if obligations and debt payments exceed income.

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

Unit: kopecks (Int).

The reserve is a buffer retained from discretionary income. Full policy is in Section 8. The fallback triggers when `afterFixed > 0` but the 10% reserve would push `afterReserve` negative — this can only happen if... actually it cannot: if `afterFixed > 0`, then `afterFixed * 0.10 < afterFixed`, so `afterReserve = afterFixed - 10% > 0`. The fallback branch (`afterReserve < 0 and afterFixed > 0`) is therefore unreachable under normal arithmetic. It is a defensive guard.

When `afterFixed <= 0`: `reserve = 0` (no buffer is taken from a deficit).

### Step 8: freePool

```
freePool = max(0, afterFixed - reserve)
```

Unit: kopecks (Int). Always non-negative.

Note: `freePool` is computed **before** EF contribution but **after** reserve. This is the pool from which both EF and avalanche are allocated.

### Step 9: EF Contribution

```
monthlyObligations = sum(obligation.amount for all active obligations)  // NOT prorated
efTarget = monthlyObligations * emergencyFund.targetMonths             // default targetMonths=3
efDeficit = max(0, efTarget - emergencyFund.currentAmount)

if efDeficit > 0 and freePool > 0:
  monthlyEFGoal = Math.round(efDeficit / 12)
  periodEFGoal = monthlyEFGoal

  if isProratedStart and fullPeriodDays > 0:
    periodEFGoal = Math.round(monthlyEFGoal * (daysTotal / fullPeriodDays))

  efContribution = min(periodEFGoal, Math.round(freePool * 0.20))
  efContribution = min(efContribution, efDeficit)          // don't overshoot target

else:
  efContribution = 0
```

Unit: kopecks (Int).

The EF contribution is zero if either the EF is already fully funded (`efDeficit = 0`) or there is no free pool.

**Known limitation:** `monthlyObligations` here is the raw (non-prorated) sum, even when `isProratedStart = true`. This means `efTarget` is calculated on a full month's obligations regardless of period length. This is intentional (the EF should cover a full month) but creates a slight asymmetry: the contribution itself is prorated, but the target it aims for is not. See Section 13.

### Step 10: Avalanche Pool

```
focusDebt = activeDebts.find(d => d.isFocusDebt)

Case A: focusDebt exists AND efDeficit <= 0 (EF fully funded)
  investPool = max(0, freePool - efContribution)
  if focusDebt.apr >= 0.18:
    avalanchePool = Math.round(investPool * 0.50)
  else:
    avalanchePool = Math.round(investPool * 0.25)
  avalanchePool = min(avalanchePool, focusDebt.balance)

Case B: focusDebt exists AND efDeficit > 0 AND focusDebt.apr >= 0.18
  investPool = max(0, freePool - efContribution)
  avalanchePool = Math.round(investPool * 0.30)
  avalanchePool = min(avalanchePool, focusDebt.balance)

Case C: focusDebt exists AND efDeficit > 0 AND focusDebt.apr < 0.18
  avalanchePool = 0

Case D: no focusDebt
  avalanchePool = 0
```

Unit: kopecks (Int).

The `min(avalanchePool, focusDebt.balance)` cap prevents overpaying a nearly-paid-off debt. If `focusDebt.balance` is small, `avalanchePool` will be capped. If `focusDebt.balance = 0`, `avalanchePool` will be `min(something, 0) = 0`. Active debt filtering in Step 5 (`balance > 0`) means the focus debt found here should always have `balance > 0`, but the cap is a safe guard regardless.

### Step 11: residual and s2sPeriod

```
residual = totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool
s2sPeriod = max(0, residual)
```

Unit: kopecks (Int).

`residual` may be negative (DEFICIT status). `s2sPeriod` is floored at 0. The distinction is preserved: `status = DEFICIT` is triggered by `residual < 0`, but `s2sPeriod = 0` in that case (no negative spending budget is assigned).

### Step 12: Daily Limit with Carry-Over

```
periodRemaining = s2sPeriod - totalExpensesInPeriod
s2sDaily = max(0, Math.round(periodRemaining / daysLeft))
s2sToday = max(0, s2sDaily - todayExpenses)
```

Unit: kopecks (Int).

`periodRemaining` is NOT floored at 0 inside the engine for this calculation (it is for the returned `periodRemaining` field). If `totalExpensesInPeriod > s2sPeriod`, then `periodRemaining` is negative, making `s2sDaily = 0`.

`todayExpenses` is the sum of expenses with `spentAt >= today 00:00:00 UTC`.

**Important:** In `GET /tg/dashboard` (index.ts), the live `s2sDaily` is computed differently from the engine:

```typescript
// index.ts dashboard
const daysLeft = Math.max(1, Math.ceil((activePeriod.endDate.getTime() - now.getTime()) / msPerDay));
const periodRemaining = Math.max(0, activePeriod.s2sPeriod - totalPeriodSpent);
const dynamicS2sDaily = Math.max(0, Math.round(periodRemaining / daysLeft));
const s2sToday = Math.max(0, dynamicS2sDaily - todayTotal);
```

The dashboard uses `Math.ceil` for `daysLeft` (not `daysTotal - daysElapsed + 1`), and floors `periodRemaining` at 0. This produces the same value in most cases but can differ by 1 day near period boundaries.

### Step 13: Status

```
if residual < 0:          status = 'DEFICIT'
elif todayExpenses > s2sDaily: status = 'OVERSPENT'
elif s2sToday <= s2sDaily * 0.3: status = 'WARNING'
else:                     status = 'OK'
```

Note: The dashboard (`index.ts`) uses a slightly different DEFICIT trigger:

```typescript
if (activePeriod.s2sPeriod <= 0) { s2sStatus = 'DEFICIT'; }
```

The dashboard triggers DEFICIT when `s2sPeriod = 0` (which includes the case where `residual` was negative at period creation). The engine triggers DEFICIT when `residual < 0` at calculation time. These are equivalent if `s2sPeriod` has not been manually set.

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

The color rule for WARNING and the color rule for `s2sToday <= s2sDaily * 0.3` both map to red (not orange) when the ratio is <= 0.3. Orange applies in the range (0.3, 0.7]. Green applies above 0.7.

---

## 7. Priority of Money Allocation (Visual Hierarchy)

```
totalIncome                     (trigger-selected income for this period)
  - totalObligations            (fixed costs; prorated if isProratedStart)
  - totalDebtPayments           (min payments; prorated if isProratedStart)
= afterFixed                    (may be negative → DEFICIT)
  - reserve                     (10% buffer; 5% fallback; 0 if afterFixed <= 0)
= freePool                      (base for variable allocations)
  - efContribution              (EF goal; max 20% of freePool; zero if EF funded)
  - avalanchePool               (extra debt payment; APR-dependent share of investPool)
= residual                      (may be negative even if afterFixed > 0)
= s2sPeriod                     (max(0, residual))
  ÷ daysLeft                    (carry-over: recalculated each day)
= s2sDaily                      (per-day limit)
  - todayExpenses
= s2sToday                      (remaining today)
```

---

## 8. Reserve Policy

| Condition | Reserve Rate | Notes |
|-----------|-------------|-------|
| `afterFixed > 0` | 10% | Standard case |
| `afterFixed > 0` and `afterFixed * 0.10 > afterFixed` | Impossible | The 5% fallback branch is unreachable by normal arithmetic |
| `afterFixed <= 0` | 0% | No buffer taken from a deficit |

The reserve is NOT allocated to any specific purpose. It remains in the period budget as a safety buffer. It reduces `freePool` and therefore reduces `efContribution` and `avalanchePool`. It does reduce `s2sPeriod` (via `residual`).

---

## 9. EF Contribution Policy

The emergency fund target is `monthlyObligations * targetMonths`.

Default `targetMonths = 3` (set at onboarding; stored in `EmergencyFund.targetMonths`).

Monthly contribution goal: `efDeficit / 12` (aim to fill deficit over 12 months).

For prorated periods, the contribution goal is scaled by `daysTotal / fullPeriodDays`.

The contribution is capped at:
1. 20% of `freePool` — prevents EF from consuming too much discretionary income
2. `efDeficit` — prevents overfunding

When `efDeficit <= 0`: `efContribution = 0`. EF is fully funded; the entire `freePool` (minus reserve) flows to avalanche or `s2sPeriod`.

---

## 10. Avalanche Pool Policy

Four distinct cases determined by two boolean conditions:

| EF funded (`efDeficit <= 0`) | Focus debt APR | Avalanche Rate | Basis |
|------------------------------|----------------|----------------|-------|
| Yes | >= 18% (0.18) | 50% | `investPool = freePool - efContribution` |
| Yes | < 18% | 25% | `investPool = freePool - efContribution` |
| No | >= 18% | 30% | `investPool = freePool - efContribution` |
| No | < 18% | 0% | No avalanche while EF deficit + low-APR debt |

In all cases: `avalanchePool = min(computed, focusDebt.balance)`.

If no focus debt exists: `avalanchePool = 0`.

`investPool = max(0, freePool - efContribution)`. In Case A/B/C, when `efContribution = 0` (because EF is funded), `investPool = freePool`.

---

## 11. Carry-Over Mechanism

The daily limit adjusts every day to reflect actual spending. This is the carry-over mechanism.

On day 1 of a period: `s2sDaily = s2sPeriod / daysLeft`.

If the user spends less than `s2sDaily` on day 1, the unspent amount carries forward. On day 2: `periodRemaining = s2sPeriod - day1Spent`. `s2sDaily = periodRemaining / (daysLeft - 1)`. The new `s2sDaily` is higher.

If the user overspends on day 1, `periodRemaining` shrinks more than expected. On day 2, `s2sDaily` is lower.

This mechanism is implicit — it is not stored anywhere. It is recalculated from `s2sPeriod` and `totalPeriodSpent` on every request.

---

## 12. Status and Color Rules

### Status Rules (engine.ts)

| Status | Condition | Priority |
|--------|-----------|----------|
| `DEFICIT` | `residual < 0` | 1st (highest) |
| `OVERSPENT` | `todayExpenses > s2sDaily` | 2nd |
| `WARNING` | `s2sToday <= s2sDaily * 0.3` | 3rd |
| `OK` | None of the above | Default |

### Status Rules (index.ts dashboard — slight variation)

| Status | Condition |
|--------|-----------|
| `DEFICIT` | `activePeriod.s2sPeriod <= 0` |
| `OVERSPENT` | `todayTotal > dynamicS2sDaily` |
| `WARNING` | `dynamicS2sDaily > 0 && s2sToday / dynamicS2sDaily <= 0.3` |
| `OK` | None of the above |

### Color Rules (engine.ts)

| Color | Condition |
|-------|-----------|
| `red` | `status == DEFICIT` or `status == OVERSPENT` |
| `red` | `s2sDaily > 0` and `s2sToday / s2sDaily <= 0.3` |
| `orange` | `s2sDaily > 0` and `s2sToday / s2sDaily <= 0.7` |
| `green` | All other cases (including `s2sDaily = 0`) |

Note: WARNING status and the `<= 0.3` color condition are independent checks. A WARNING status produces a red color (not orange). Orange applies only when the ratio is in `(0.3, 0.7]`.

---

## 13. Known Limitations and Gaps

These are not future improvements — they are current behaviors that must be understood to correctly interpret results.

### 13.1 triggerPayday Not Persisted

The `triggerPayday` is computed at runtime from `periodEndDate.getDate()` and `allPaydays`. It is never stored in the Period DB record. If paydays are changed between period creation and a subsequent calculation, the trigger used during recalculate may differ from the one used at period creation. Consequence: income amounts may change on recalculate even without explicit income edits.

### 13.2 efTarget Uses Full Monthly Obligations (Not Prorated)

In Step 9, `monthlyObligations = sum(obligation.amount)` uses the raw monthly amounts, not the prorated amounts used for `totalObligations`. This means:

- `efTarget` is always based on a full month's obligations.
- `efContribution` is prorated, but the target it aims for is not.
- For a user with `obligations = 60,000 ₽/month` and `targetMonths = 3`, `efTarget = 180,000 ₽` regardless of whether the current period is prorated.

This is intentional (the EF should fund a full month's obligations), but the asymmetry means prorated-period EF contributions are smaller than full-period ones while working toward the same target.

### 13.3 Integer Rounding Accumulates

Each `Math.round()` introduces up to ±0.5 kopeck of error. With 12+ intermediate operations per calculation, and hundreds of periods per year, the cumulative error is bounded but non-zero. The error is small (under ±10 kopecks total per period in typical scenarios) and is accepted as a design trade-off (see `adr/adr-002-money-in-minor-units.md`).

### 13.4 avalanchePool Cap Behavior When focusDebt.balance Approaches Zero

The `min(avalanchePool, focusDebt.balance)` cap means that when a focus debt has a very small remaining balance, `avalanchePool` will be much smaller than the APR-driven percentage suggests. The difference is not redistributed — it simply reduces `avalanchePool` and correspondingly increases `s2sPeriod` (more money remains safe-to-spend).

### 13.5 Notification Deduplication is In-Memory

`cron.ts` uses a `Map<string, Set<string>>` (`notifLog`) for dedup. This map is cleared on process restart. If the API process restarts mid-day, notifications may be sent a second time that day. There is no DB-backed dedup.

### 13.6 Period Rollover Cron Runs at 00:05 UTC

The rollover cron (`Cron 4`) runs at 00:05 UTC. Users in non-UTC timezones will experience rollover at their local equivalent of 00:05 UTC (e.g., 03:05 MSK for Moscow). A user who logs expenses after their local payday midnight but before 00:05 UTC may briefly see the old period's budget.

### 13.7 DailySnapshot at 23:55 UTC

The snapshot cron (`Cron 2`) runs at 23:55 UTC. For Moscow users (+3), this is 02:55 MSK the next day. The snapshot captures day-end state in UTC, not in the user's local time.

### 13.8 weeklyDigest Setting Exists But Is Not Implemented

`UserSettings.weeklyDigest` is stored in DB and can be toggled via `PATCH /tg/me/settings`, but no cron job reads it or sends weekly summaries. The field is a stub for future implementation.

### 13.9 sendDeficitAlert Is Never Called

`notify.ts` exports `sendDeficitAlert()` but no cron job or route calls it. Deficit alerts are not sent automatically.

### 13.10 daysLeft Computation Differs Between engine.ts and dashboard

`engine.ts`: `daysLeft = max(1, daysTotal - daysElapsed + 1)`
`index.ts` dashboard: `daysLeft = max(1, Math.ceil((endDate - now) / msPerDay))`

These agree in most cases. They can differ by 1 day when `now` is close to midnight UTC or when period dates are not aligned to UTC midnight.

---

## 14. Canonical Worked Examples

All amounts in kopecks unless marked as ₽. To convert: divide by 100.

---

### Example A: Single Payday, No Debts, No EF Deficit

**Setup:**
- Income: 12,000,000 kopecks (120,000 ₽/month), payday 15th
- Obligations: 3,000,000 kopecks (30,000 ₽/month)
- Debts: none
- EF: `currentAmount = 9,000,000` (90,000 ₽), `targetMonths = 3`
- Today: March 20, 2026
- No expenses yet

**Step 1 — Period bounds:**

`calculatePeriodBounds([15], March 20)`:
- day = 20 >= 15 → `canonicalStart = March 15`, `periodEnd = April 15`
- `isProratedStart = (20 != 15) = true`
- `actualStart = March 20`
- `fullPeriodDays = daysBetween(Mar 15, Apr 15) = 31`
- `daysTotal = daysBetween(Mar 20, Apr 15) = 26`

**Step 2 — Time variables:**
- `daysTotal = 26`
- `daysElapsed = daysBetween(Mar 20, Mar 20) = 1`
- `daysLeft = max(1, 26 - 1 + 1) = 26`

**Step 3 — triggerPayday:**
- `allPaydays = [15]`
- `endDay = 15` (April 15)
- `endDayIdx = 0` (index of 15 in [15])
- `endDayIdx > 0` is false → `triggerPayday = allPaydays[0] = 15`

Wait: `endDayIdx = 0`, so the condition `endDayIdx > 0` is false. Therefore `triggerPayday = allPaydays[allPaydays.length - 1] = allPaydays[0] = 15`. Correct.

**Step 4 — Income:**
- `hasTrigger = inc.paydays.includes(15) = true`
- `payCount = max(1, 1) = 1`
- `totalIncome = Math.round(12,000,000 / 1) = 12,000,000`

**Step 5 — Obligations (prorated):**
- `sum = 3,000,000`
- `isProratedStart = true`, `fullPeriodDays = 31`
- `totalObligations = Math.round(3,000,000 * (26 / 31)) = Math.round(2,516,129.0) = 2,516,129`

**Step 6 — Debt payments:**
- No active debts → `totalDebtPayments = 0`

**Step 7 — afterFixed:**
- `afterFixed = 12,000,000 - 2,516,129 - 0 = 9,483,871`

**Step 8 — Reserve:**
- `reserve = Math.round(9,483,871 * 0.10) = Math.round(948,387.1) = 948,387`
- `afterReserve = 9,483,871 - 948,387 = 8,535,484 > 0` → no fallback

**Step 9 — freePool:**
- `freePool = max(0, 9,483,871 - 948,387) = 8,535,484`

**Step 10 — EF contribution:**
- `monthlyObligations = 3,000,000` (raw, not prorated)
- `efTarget = 3,000,000 * 3 = 9,000,000`
- `efDeficit = max(0, 9,000,000 - 9,000,000) = 0`
- `efDeficit <= 0` → `efContribution = 0`

**Step 11 — Avalanche:**
- No debts → `focusDebt = undefined` → `avalanchePool = 0`

**Step 12 — s2sPeriod:**
- `residual = 12,000,000 - 2,516,129 - 0 - 948,387 - 0 - 0 = 8,535,484`
- `s2sPeriod = max(0, 8,535,484) = 8,535,484`

**Step 13 — Daily:**
- `periodRemaining = 8,535,484 - 0 = 8,535,484`
- `s2sDaily = max(0, Math.round(8,535,484 / 26)) = Math.round(328,288.6) = 328,289`
- `s2sToday = max(0, 328,289 - 0) = 328,289`

**Step 14 — Status / Color:**
- `residual > 0`, `todayExpenses = 0`, `s2sToday / s2sDaily = 1.0 > 0.3` → `OK`, `green`

**Summary:** Safe to spend today: 328,289 kopecks = **3,282.89 ₽**.

---

### Example B: Two Paydays — Two Separate Income Records

**Setup:**
- Income record 1: `{amount: 25,000,000, paydays: [1]}` (250,000 ₽ on 1st)
- Income record 2: `{amount: 25,000,000, paydays: [15]}` (250,000 ₽ on 15th)
- Obligations: 0
- Debts: none, EF: funded
- Today: March 20. Period bounds: March 15 → April 1

**Step 1 — Period bounds:**

`calculatePeriodBounds([1, 15], March 20)`:
- `sorted = [1, 15]`, `day = 20`
- `day >= 15` → `canonicalStart = March 15`, `periodEnd = April 1`
- `isProratedStart = false` (March 20 != March 15 ... wait)

Actually: `isProrated = startOfDay(fromDate).getTime() !== canonicalStart.getTime()`. `startOfDay(March 20) != March 15` → `isProratedStart = true`.

- `actualStart = March 20`
- `fullPeriodDays = daysBetween(Mar 15, Apr 1) = 17`
- `daysTotal = daysBetween(Mar 20, Apr 1) = 12`

**Step 2 — triggerPayday:**
- `allPaydays = [1, 15]` (union across both records)
- `endDay = 1` (April 1)
- `endDayIdx = allPaydays.indexOf(1) = 0`
- `endDayIdx > 0` is false → `triggerPayday = allPaydays[1] = 15`

**Step 3 — Income:**
- Record 1 (`paydays: [1]`): `inc.paydays.includes(15) = false` → skip
- Record 2 (`paydays: [15]`): `inc.paydays.includes(15) = true`, `payCount = 1`
  - `contribution = Math.round(25,000,000 / 1) = 25,000,000`
- `totalIncome = 25,000,000`

**Summary:** Only the 250,000 ₽ income counts this period. The income arriving on the 1st belongs to the next period (March 15 → April 1 is the "15th triggered" period).

`s2sPeriod ≈ 25,000,000` (minus prorated obligations if any, minus reserve).

---

### Example C: Single Income Record with Two Payday Dates

**Setup:**
- Income record: `{amount: 50,000,000, paydays: [1, 15]}` (500,000 ₽/month, split)
- Same period as Example B: March 15 → April 1, today March 20

**triggerPayday** = 15 (same derivation as Example B).

**Income:**
- Record: `inc.paydays.includes(15) = true`
- `payCount = max(1, 2) = 2`
- `contribution = Math.round(50,000,000 / 2) = 25,000,000`
- `totalIncome = 25,000,000`

**Result:** Identical to Example B. A single record with `paydays:[1,15]` and `amount: 50,000,000` yields the same per-period income as two records each with `amount: 25,000,000` and one payday each.

---

### Example D: EF Deficit Exists

**Setup:**
- Income: 15,000,000 kopecks (150,000 ₽/month), single payday
- Obligations: 4,000,000 (40,000 ₽/month)
- Debts: none
- EF: `currentAmount = 0`, `targetMonths = 3`
- Full period (not prorated), 30 days, no expenses

**Steps 1-7:**
- `totalIncome = 15,000,000`
- `totalObligations = 4,000,000`
- `afterFixed = 11,000,000`
- `reserve = Math.round(11,000,000 * 0.10) = 1,100,000`
- `freePool = max(0, 11,000,000 - 1,100,000) = 9,900,000`

**Step 9 — EF:**
- `monthlyObligations = 4,000,000`
- `efTarget = 4,000,000 * 3 = 12,000,000`
- `efDeficit = max(0, 12,000,000 - 0) = 12,000,000`
- `monthlyEFGoal = Math.round(12,000,000 / 12) = 1,000,000`
- `periodEFGoal = 1,000,000` (not prorated)
- `cap = Math.round(9,900,000 * 0.20) = 1,980,000`
- `efContribution = min(1,000,000, 1,980,000) = 1,000,000`
- `efContribution = min(1,000,000, 12,000,000) = 1,000,000`

**Step 11:**
- `residual = 15,000,000 - 4,000,000 - 0 - 1,100,000 - 1,000,000 - 0 = 8,900,000`
- `s2sPeriod = 8,900,000` (89,000 ₽)

**Daily (30-day period):**
- `s2sDaily = Math.round(8,900,000 / 30) = 296,667`

---

### Example E: Focus Debt, APR >= 18%, EF Funded

**Setup:**
- Income: 20,000,000 (200,000 ₽), obligations: 0
- EF funded (`efDeficit = 0`)
- Focus debt: `{balance: 30,000,000, apr: 0.24, minPayment: 500,000, isFocusDebt: true}`
- Full period, 30 days

**Steps:**
- `totalIncome = 20,000,000`
- `totalObligations = 0`, `totalDebtPayments = 500,000`
- `afterFixed = 19,500,000`
- `reserve = Math.round(19,500,000 * 0.10) = 1,950,000`
- `freePool = max(0, 19,500,000 - 1,950,000) = 17,550,000`
- `efContribution = 0` (EF funded)

**Avalanche (Case A: EF funded, APR >= 18%):**
- `investPool = max(0, 17,550,000 - 0) = 17,550,000`
- `avalanchePool = Math.round(17,550,000 * 0.50) = 8,775,000`
- `avalanchePool = min(8,775,000, 30,000,000) = 8,775,000`

**s2sPeriod:**
- `residual = 20,000,000 - 0 - 500,000 - 1,950,000 - 0 - 8,775,000 = 8,775,000`
- `s2sPeriod = 8,775,000` (87,750 ₽)
- `s2sDaily = Math.round(8,775,000 / 30) = 292,500`

Total debt payment this period: `minPayment (500,000) + avalanchePool (8,775,000) = 9,275,000` (92,750 ₽).

---

### Example F: Large Expense Today — OVERSPENT

**Setup:**
- Day 5 of period. `s2sPeriod = 20,000,000`. `totalPeriodSpent so far = 15,000,000`.
- `daysLeft = 10`, `periodRemaining = 20,000,000 - 15,000,000 = 5,000,000`
- `s2sDaily = Math.round(5,000,000 / 10) = 500,000`
- Today's expenses: `todayExpenses = 700,000`
- `s2sToday = max(0, 500,000 - 700,000) = 0`
- `todayExpenses (700,000) > s2sDaily (500,000)` → `status = OVERSPENT`, `s2sColor = red`

---

### Example G: daysLeft = 1 (Last Day of Period)

**Setup:**
- Last day of period. `s2sPeriod = 10,000,000`. `totalPeriodSpent = 8,500,000`.
- `daysLeft = 1`
- `periodRemaining = 1,500,000`
- `s2sDaily = Math.round(1,500,000 / 1) = 1,500,000`
- `todayExpenses = 300,000`
- `s2sToday = max(0, 1,500,000 - 300,000) = 1,200,000`
- Ratio: `1,200,000 / 1,500,000 = 0.8 > 0.7` → `OK`, `green`

---

### Example H: Zero/Near-Zero Residual

**Setup:**
- Income: 5,000,000 (50,000 ₽)
- Obligations: 4,800,000 (48,000 ₽)
- Debts: none, EF: funded
- Full period, 30 days

**Calculation:**
- `afterFixed = 5,000,000 - 4,800,000 = 200,000`
- `reserve = Math.round(200,000 * 0.10) = 20,000`
- `afterReserve = 180,000 > 0` → no fallback
- `freePool = max(0, 200,000 - 20,000) = 180,000`
- `efContribution = 0` (EF funded), `avalanchePool = 0`
- `residual = 200,000 - 20,000 = 180,000`
- `s2sPeriod = 180,000` (1,800 ₽ for the entire period)
- `s2sDaily = Math.round(180,000 / 30) = 6,000` (60 ₽/day)

Very tight but not a DEFICIT. Status: OK.

---

### Example I: Prorated Period

**Setup:**
- Payday: 1st. User completed onboarding on March 15.
- `calculatePeriodBounds([1], March 15)`:
  - `day = 15 >= 1` → `canonicalStart = March 1`, `periodEnd = April 1`
  - `isProratedStart = (15 != 1) = true`
  - `actualStart = March 15`
  - `fullPeriodDays = daysBetween(Mar 1, Apr 1) = 31`
  - `daysTotal = daysBetween(Mar 15, Apr 1) = 17`
- Obligations: 6,000,000 (60,000 ₽/month)
- Income: 10,000,000 (100,000 ₽/month), payday 1st

**Prorated obligations:**
- `totalObligations = Math.round(6,000,000 * (17 / 31)) = Math.round(3,290,322.6) = 3,290,323`

**EF target (not prorated):**
- `monthlyObligations = 6,000,000` (raw)
- `efTarget = 6,000,000 * 3 = 18,000,000`

**Comparison:**
- Full period would deduct 6,000,000 for obligations.
- Prorated period deducts only 3,290,323 — user pays less than a full month's obligations because they joined mid-period.

---

### Example J: Carry-Over Benefit

**Setup:**
- Period: 20 days. `s2sPeriod = 10,000,000`.
- After 10 days, total spent = 3,000,000 (under budget).

**Day 11 calculation:**
- `daysLeft = 10`
- `periodRemaining = 10,000,000 - 3,000,000 = 7,000,000`
- `s2sDaily = Math.round(7,000,000 / 10) = 700,000`
- Original day-1 `s2sDaily` would have been `Math.round(10,000,000 / 20) = 500,000`
- Carry-over bonus: `700,000 - 500,000 = 200,000` kopecks per day (2,000 ₽/day extra due to under-spending)

**Day 12 (spent 200,000 on day 11):**
- `totalPeriodSpent = 3,200,000`
- `daysLeft = 9`
- `periodRemaining = 10,000,000 - 3,200,000 = 6,800,000`
- `s2sDaily = Math.round(6,800,000 / 9) = Math.round(755,555.6) = 755,556`
- Daily limit continues to increase because under-budget spending accumulates.
