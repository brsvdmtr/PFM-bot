# Glossary

<!-- Document metadata -->
Document Type: Normative
Status: Active
Source of Truth: YES — for terminology only
Verified Against Code: Yes (`apps/api/src/engine.ts`, `apps/api/src/index.ts`)
Last Updated: 2026-03-20
Related Docs:
  - system/formulas-and-calculation-policy.md
  - system/numerical-source-of-truth.md
  - system/income-allocation-semantics.md

---

## Purpose

This document defines the canonical name for every concept in PFM-bot. When writing code, docs, UI copy, or support messages, use these names exactly. Do not invent synonyms.

For formulas and detailed calculation rules, this glossary defers to `system/formulas-and-calculation-policy.md`. For where each number comes from, see `system/numerical-source-of-truth.md`.

---

## Terms

---

### S2S / Safe to Spend

**Type:** Concept / product name
**Russian UI label:** "Safe to Spend" (used untranslated in UI)
**Definition:** The product's core feature. A calculated daily spending limit that tells the user how much they can spend today while staying on track to cover all obligations, debt payments, and savings goals before the next payday. Covers the S2S family of values: `s2sPeriod`, `s2sDaily`, `s2sToday`.
**Canonical source:** `system/formulas-and-calculation-policy.md`
**Common confusion:** "S2S" is both the product feature name and a prefix for the specific calculated values. Context determines which is meant.

---

### s2sToday

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Russian UI label:** Shown as the main number in the dashboard header; labeled in morning notifications as "Safe to Spend сегодня"
**Definition:** The amount the user can still spend today without exceeding the daily limit. Equals `max(0, s2sDaily - todayExpenses)`. Always non-negative.
**Persisted:** No — derived on every API request
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 12; `system/numerical-source-of-truth.md` §1.1
**Common confusion:** Users expect this to equal `s2sDaily` at the start of the day. It does — until any expense is logged. After expenses, `s2sToday` decreases. It cannot go below 0 in the API response.

---

### s2sDaily (live)

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Russian UI label:** "из дневного лимита" (in morning notification); "Дневной лимит" (in evening notification and dashboard)
**Definition:** The per-day spending limit, recalculated on every request from `periodRemaining / daysLeft`. Incorporates carry-over from previous days in the period. This is the live value, not the stored snapshot.
**Persisted:** No — computed per request in `GET /tg/dashboard`
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 12; `system/numerical-source-of-truth.md` §1.2
**Common confusion:** Do not confuse with `period.s2sDaily` (the stored snapshot). The dashboard always computes this live. The stored `period.s2sDaily` is stale from the moment the first expense is logged.

---

### period.s2sDaily

**Type:** Monetary amount (stored snapshot)
**Unit:** Kopecks (Int)
**Definition:** The `s2sDaily` value computed at period creation (or last recalculate), stored in the `Period` DB record. Equals `max(0, round(s2sPeriod / daysTotal))` at the time of creation, with `totalExpenses = 0`. Becomes stale immediately after expenses are logged.
**Persisted:** Yes — `Period.s2sDaily` column
**Canonical source:** `system/numerical-source-of-truth.md` §1.3
**Common confusion:** This is a snapshot, not the live limit. The live dashboard does NOT use this field for computing `s2sDaily`. Used in: completed period summaries, new-period notifications.

---

### s2sPeriod

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Russian UI label:** "Бюджет периода"
**Definition:** The total safe-to-spend budget for the entire period. Computed by `calculateS2S` as `max(0, residual)`. Persisted at period creation and at each recalculate. Does not change as expenses are added.
**Persisted:** Yes — `Period.s2sPeriod` column
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 11
**Common confusion:** `s2sPeriod` is the budget cap, not the remaining balance. Subtract `totalPeriodSpent` to get `periodRemaining`.

---

### periodRemaining

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Russian UI label:** "Осталось в периоде"
**Definition:** `max(0, s2sPeriod - totalPeriodSpent)`. The portion of the period budget not yet spent. Used as the numerator in the live `s2sDaily` calculation.
**Persisted:** No — derived on every request
**Canonical source:** `system/numerical-source-of-truth.md` §1.5

---

### totalPeriodSpent

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Russian UI label:** "Потрачено за период"
**Definition:** The sum of all `Expense.amount` values linked to the current ACTIVE period. Aggregated live from the expenses table on each request.
**Persisted:** No — aggregated live
**Canonical source:** `system/numerical-source-of-truth.md` §1.6
**Common confusion:** This is the cumulative total for the whole period, not just today. Compare with `expensesToday` for the daily figure.

---

### expensesToday

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Russian UI label:** "Потрачено сегодня"
**Definition:** The sum of all `Expense.amount` values with `spentAt >= today 00:00:00 UTC`. Aggregated live. Used to compute `s2sToday = max(0, s2sDaily - expensesToday)`.
**Persisted:** No — aggregated live
**Canonical source:** `system/numerical-source-of-truth.md` §1.7
**Common confusion:** "Today" is UTC midnight, not the user's local midnight. For Moscow users (+3), expenses logged before 03:00 MSK are counted as yesterday.

---

### carryOver

**Type:** Implicit mechanism (not a named field)
**Definition:** The automatic redistribution of unspent daily budget across remaining days. Not stored anywhere. Emerges from recomputing `s2sDaily = periodRemaining / daysLeft` on every request. If the user spends less than `s2sDaily` on day N, `periodRemaining` is larger than expected, and `s2sDaily` increases on day N+1.
**Persisted:** No — implicit in the carry-over arithmetic
**Canonical source:** `system/formulas-and-calculation-policy.md` §11

---

### daysLeft

**Type:** Count
**Unit:** Days (Int, minimum 1)
**Definition:** The number of calendar days remaining in the period, inclusive of today. Computed as `max(1, ceil((endDate - now) / msPerDay))` in the dashboard. Never less than 1 (prevents division by zero in `s2sDaily` calculation).
**Persisted:** No — computed per request
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 1; `system/numerical-source-of-truth.md` §1.8

---

### daysTotal

**Type:** Count
**Unit:** Days (Int, minimum 1)
**Definition:** The total number of days in the current period from `actualStart` to `periodEnd`. Computed by `daysBetween(actualStart, periodEnd)`. When `isProratedStart = true`, `daysTotal < fullPeriodDays`. Persisted at period creation.
**Persisted:** Yes — `Period.daysTotal` column (snapshot at creation)
**Canonical source:** `system/formulas-and-calculation-policy.md` §5.2

---

### daysElapsed

**Type:** Count
**Unit:** Days (Int, minimum 1)
**Definition:** The number of days from `periodStartDate` to `today`, inclusive. Computed as `daysBetween(periodStartDate, today)` in the engine. Used to compute `daysLeft = daysTotal - daysElapsed + 1`.
**Persisted:** No — computed in engine
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 1

---

### Period

**Type:** Entity
**DB table:** `Period`
**Definition:** The interval between two consecutive payday events during which the user operates under a fixed `s2sPeriod` budget. Begins on the user's payday (or on onboarding day if prorated) and ends on the next payday date. Has status ACTIVE, COMPLETED, or (if residual < 0 at creation) records with `s2sPeriod = 0`.
**Key fields:** `startDate`, `endDate`, `s2sPeriod`, `s2sDaily` (snapshot), `isProratedStart`, `daysTotal`, `status`
**Canonical source:** `system/formulas-and-calculation-policy.md` §5

---

### isProratedStart

**Type:** Flag (Boolean)
**Definition:** True when the user joined mid-period (today is not the canonical period start date). When true, obligations and debt payments are scaled by `daysTotal / fullPeriodDays`. Income is not prorated — it uses trigger-based selection instead.
**Persisted:** Yes — `Period.isProratedStart` column
**Canonical source:** `system/formulas-and-calculation-policy.md` §5.3
**Common confusion:** `isProratedStart` affects obligations and debt payments but NOT income. Income proration is handled differently through `payCount` splitting.

---

### fullPeriodDays

**Type:** Count
**Unit:** Days (Int, minimum 1)
**Definition:** The total days in the canonical (non-prorated) period — i.e., from the canonical `periodStart` to `periodEnd`, regardless of when the user actually joined. Used as the denominator in proration: `prorated = Math.round(value * (daysTotal / fullPeriodDays))`.
**Persisted:** Passed to engine as input; not separately stored in Period table (can be derived from `startDate` and `endDate` of the canonical bounds)
**Canonical source:** `system/formulas-and-calculation-policy.md` §5.2

---

### triggerPayday

**Type:** Day-of-month integer
**Unit:** Integer 1–31
**Definition:** The payday that caused the current period to begin. Derived at runtime from `periodEndDate.getDate()` and `allPaydays`. The period was "triggered by" this payday, meaning income records with this payday in their `paydays[]` are selected for the period. Never stored in DB.
**Persisted:** No — computed at runtime
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 2; `system/income-allocation-semantics.md` §3
**Common confusion:** `triggerPayday` determines which income is counted, not when the period starts. The period start date comes from `calculatePeriodBounds`. The trigger is the payday *before* the period end payday in the sorted `allPaydays` list.

---

### payday / paydays[]

**Type:** Day-of-month integer / array of integers
**Unit:** Integer(s) 1–31
**Definition:** The day(s) of the month when an income record is received. Stored as an integer array (`Int[]`) on the `Income` DB record. Used by `calculatePeriodBounds` to determine period boundaries and by `calculateS2S` to determine which income counts in a given period.
**Persisted:** Yes — `Income.paydays` column (Int[])
**Canonical source:** `system/income-allocation-semantics.md`
**Common confusion:** A record with `paydays: [1, 15]` means the record participates in two periods per month, contributing `amount / 2` each time. This is different from two records each with one payday.

---

### Income

**Type:** Entity
**DB table:** `Income`
**Definition:** A recurring income source with a monthly `amount` (kopecks) and one or more `paydays`. The `amount` is the total monthly amount for that record; the engine divides by `payCount` for per-period allocation.
**Key fields:** `amount`, `paydays`, `title`, `isActive`, `currency`
**Canonical source:** `system/income-allocation-semantics.md`

---

### Obligation

**Type:** Entity
**DB table:** `Obligation`
**Definition:** A fixed recurring monthly expense that must be paid regardless of discretionary spending (rent, utilities, subscriptions, etc.). The `amount` is the monthly cost in kopecks. Deducted from income before computing the discretionary budget. Prorated when `isProratedStart = true`.
**Key fields:** `amount`, `title`, `type`, `isActive`, `dueDay`
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 4

---

### Debt / focusDebt / isFocusDebt

**Type:** Entity / flag
**DB table:** `Debt`
**Definition:** A liability with a remaining `balance`, annual percentage rate (`apr`), and `minPayment`. The debt with `isFocusDebt = true` is the target for avalanche extra payments. Only one debt per user should have `isFocusDebt = true` at any time. `focusDebt` (in engine context) is the first active debt with `isFocusDebt = true`.
**Key fields:** `balance`, `apr`, `minPayment`, `isFocusDebt`, `isPaidOff`, `type`, `dueDay`
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 10
**Common confusion:** "balance" on a Debt record means the remaining loan balance, not the period budget balance. Always qualify: "debt balance" not just "balance."

---

### minPayment

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** The minimum required monthly payment on a debt. Deducted from income before computing the discretionary budget. Prorated when `isProratedStart = true`. Stored on the `Debt` record.
**Persisted:** Yes — `Debt.minPayment` column
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 5

---

### avalanchePool

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** The extra amount directed toward the focus debt this period, beyond the regular `minPayment`. Computed from a percentage of `investPool`, adjusted by focus debt APR and EF funding status. Reduces `s2sPeriod`. This money is earmarked for debt acceleration, not for discretionary spending.
**Persisted:** Not separately stored on Period (included in the `s2sPeriod` reduction via `residual`)
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 10; `system/glossary.md`

---

### investPool

**Type:** Monetary amount (intermediate)
**Unit:** Kopecks (Int)
**Definition:** `max(0, freePool - efContribution)`. The discretionary pool remaining after EF contribution, available for debt acceleration. Used as the basis for `avalanchePool` percentage calculations.
**Persisted:** No — intermediate computation variable
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 10

---

### freePool

**Type:** Monetary amount (intermediate)
**Unit:** Kopecks (Int)
**Definition:** `max(0, afterFixed - reserve)`. Discretionary money after fixed expenses and reserve buffer. The base from which `efContribution` and `avalanchePool` are taken. Always non-negative.
**Persisted:** No — intermediate computation variable
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 8

---

### afterFixed

**Type:** Monetary amount (intermediate)
**Unit:** Kopecks (Int)
**Definition:** `totalIncome - totalObligations - totalDebtPayments`. Income remaining after all fixed costs and minimum debt payments. May be negative, indicating a structural deficit even before any discretionary spending.
**Persisted:** No — intermediate computation variable
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 6

---

### reserve

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** A buffer retained from `afterFixed` before any variable allocation. Target rate is 10% of `afterFixed`. Falls back to 5% if 10% would cause `afterReserve < 0`, and to 0% if `afterFixed <= 0`. Reduces `freePool` and therefore reduces `s2sPeriod`.
**Persisted:** Yes — `Period.reserve` column (snapshot)
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 7, §8

---

### efContribution

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** The amount directed to the emergency fund this period. Capped at 20% of `freePool` and at the remaining `efDeficit`. Zero if the emergency fund is already fully funded.
**Persisted:** Yes — `Period.efContribution` column (snapshot)
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 9

---

### efTarget

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** `monthlyObligations * emergencyFund.targetMonths`. The total amount the emergency fund should hold. Uses the raw (non-prorated) monthly obligations sum. For a user with 40,000 ₽/month obligations and `targetMonths = 3`, `efTarget = 120,000 ₽` regardless of period length.
**Persisted:** No — computed at calculation time
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 9
**Common confusion:** `efTarget` is NOT prorated even in prorated periods. It always represents a full month's obligations × targetMonths.

---

### efDeficit

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** `max(0, efTarget - emergencyFund.currentAmount)`. How much more needs to be saved to reach the emergency fund target. Zero if the fund is fully funded or over-funded.
**Persisted:** No — computed at calculation time
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 9

---

### emergencyFund

**Type:** Entity
**DB table:** `EmergencyFund`
**Definition:** The user's emergency savings record. Holds `currentAmount` (kopecks currently saved), `targetMonths` (multiplier for target; default 3), and `currency`.
**Key fields:** `currentAmount`, `targetMonths`, `currency`
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 9
**Common confusion:** `EmergencyFund.currentAmount` is not updated automatically by the engine. It must be updated manually when the user actually moves money into their emergency fund account.

---

### residual

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** `totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool`. The amount left for discretionary spending after all planned allocations. May be negative (triggers `DEFICIT` status). `s2sPeriod = max(0, residual)`.
**Persisted:** Yes — returned in `S2SResult` from engine; not separately stored in Period table
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 11
**Common confusion:** A negative `residual` means the sum of all planned deductions exceeds income. The user has no discretionary budget and `s2sPeriod = 0`. The DEFICIT status alerts the user to this condition.

---

### DailySnapshot

**Type:** Entity
**DB table:** `DailySnapshot`
**Definition:** A daily record created by Cron 2 at 23:55 UTC. Captures `s2sPlanned` (live `s2sDaily` at that moment), `s2sActual` (`s2sPlanned - todayTotal`, NOT floored at 0), `totalExpenses` (today's spend), and `isOverspent` (`todayTotal > s2sPlanned`). One record per period per day, keyed by `(periodId, date)`.
**Persisted:** Yes — DailySnapshot table, upsert by `(periodId, date)`
**Canonical source:** `system/numerical-source-of-truth.md` §1.10
**Common confusion:** `DailySnapshot.s2sActual` can be negative (overspent). `s2sToday` in the live API is floored at 0. Do not compare them as if they measure the same thing.

---

### PeriodStatus

**Type:** Enum
**Values:** `ACTIVE`, `COMPLETED`
**Definition:** The lifecycle state of a Period record. `ACTIVE` = current period in use. `COMPLETED` = period ended (set by cron rollover or by onboarding). There is no `DEFICIT` period status — deficit is an S2SStatus, not a period lifecycle state.
**Persisted:** Yes — `Period.status` column
**Common confusion:** "DEFICIT" appears in `S2SStatus` (below) but NOT as a `PeriodStatus`. A period with `s2sPeriod = 0` (due to deficit) still has `status = ACTIVE`. The two enums are independent.

---

### S2SStatus

**Type:** Enum
**Values:** `OK`, `WARNING`, `OVERSPENT`, `DEFICIT`
**Definition:** The computed status for the current daily spending position.
- `DEFICIT`: `residual < 0` at calculation time (engine) or `s2sPeriod <= 0` (dashboard)
- `OVERSPENT`: `todayExpenses > s2sDaily`
- `WARNING`: `s2sToday <= s2sDaily * 0.3`
- `OK`: none of the above
**Persisted:** No — computed per request
**Canonical source:** `system/formulas-and-calculation-policy.md` §12
**Common confusion:** `WARNING` and `OVERSPENT` are mutually exclusive (OVERSPENT takes priority). A user can be `WARNING` without having overspent today — if they spent between 70% and 100% of `s2sDaily`, they get WARNING color (orange) but OVERSPENT status only triggers if `todayExpenses > s2sDaily`.

---

### S2SColor

**Type:** Enum
**Values:** `green`, `orange`, `red`
**Definition:** The display color for the S2S value. Determined by:
- `red`: status is `DEFICIT` or `OVERSPENT`, OR `s2sToday / s2sDaily <= 0.3`
- `orange`: `s2sToday / s2sDaily` in range `(0.3, 0.7]`
- `green`: ratio > 0.7, or `s2sDaily = 0` with no deficit
**Persisted:** No — computed per request
**Canonical source:** `system/formulas-and-calculation-policy.md` Step 14
**Common confusion:** WARNING status maps to red (not orange) because the WARNING threshold (<=0.3) equals the red color threshold. Orange applies in the range (0.3, 0.7].

---

### minor units / kopecks

**Type:** Monetary representation convention
**Definition:** All money in the PFM-bot system is stored and computed as integers in the smallest currency unit (kopecks for RUB, cents for USD). 1 RUB = 100 kopecks. Display conversion: divide by 100. This convention prevents floating-point rounding errors in monetary arithmetic.
**Canonical source:** `adr/adr-002-money-in-minor-units.md`; `system/formulas-and-calculation-policy.md` §3
**Common confusion:** API inputs and outputs are in minor units. A user entering "1000 ₽" should send `amount: 100000` (100,000 kopecks) to the API. If the frontend sends rubles instead of kopecks, all calculations will be off by a factor of 100.

---

## Deprecated / Ambiguous Terms to Avoid

The following terms appear in informal usage, old comments, or early drafts. Do not use them in new code, UI copy, or documentation. Use the canonical term instead.

| Avoid | Use Instead | Reason |
|-------|-------------|--------|
| "daily limit" | `s2sDaily` | Ambiguous — does not distinguish live vs snapshot |
| "today available" | `s2sToday` | Unclear what "available" means |
| "balance" (unqualified) | "debt balance" or "periodRemaining" | Critically ambiguous — debt balance and period remaining are different concepts |
| "left this period" | `periodRemaining` | Informal; does not distinguish from `daysLeft` |
| "budget" (unqualified) | `s2sPeriod` or `freePool` depending on context | Too vague |
| "daily budget" (as fixed value) | `s2sDaily` + note that it changes with carry-over | Implies a fixed value; actually varies daily |
| "available today" | `s2sToday` | Same as "today available" |
| "income per period" | `totalIncome` (as computed by engine) | "Per period" is correct but `totalIncome` is the canonical variable name |
| "emergency fund balance" | `emergencyFund.currentAmount` | "Balance" is ambiguous; use the field name |
| "how much I can spend" | `s2sToday` | Informal phrasing for UI copy only; not for docs/code |
| "rollover" (for periods) | "period rollover" or "period end / new period creation" | "Rollover" is ambiguous with debt rollovers |
| "s2s limit" | `s2sDaily` | "Limit" is vague — daily limit? Period? Use the variable name. |
