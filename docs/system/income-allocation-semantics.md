---
title: "Income Allocation Semantics"
document_type: Normative
status: Active
source_of_truth: YES
verified_against_code: Yes
last_updated: "2026-03-21"
related_docs:
  - path: ./formulas-and-calculation-policy.md
    relation: "Steps 2–3 described there"
  - path: ./glossary.md
    relation: "term definitions"
  - path: ./system-spec-v1.md
    relation: "system context"
---

# Income Allocation Semantics

This document is the authoritative source for how income is allocated to periods in PFM-bot.
It covers the `startNominalPayday` algorithm, canonical per-payout semantics, the income matching
rule, and UX implications.

**Breaking change 2026-03-21:** The engine migrated from Semantics A (monthly total ÷ payCount)
to **Semantics B (per-payout amount)**. All `income.amount` values now represent one paycheck,
not a monthly total. The `payCount` division was removed from the engine. See Section 6 for the
migration record.

---

## 1. The Core Question

When a user has one or more income records with one or more payday dates, how much of that income
counts toward a given period's budget?

The answer depends on two things:
1. Which nominal payday started the current period (`startNominalPayday`)
2. Whether each income record's `paydays[]` array contains `startNominalPayday`

**Rule:** `income.amount` is the amount received on a single payout. If `paydays.includes(startNominalPayday)` → the full `amount` is added. Otherwise → excluded. No division.

---

## 2. Why Naive Counting Is Wrong (Double-Counting)

Consider a user who receives salary in two transfers, each 250 000 ₽:
- Record A: `{amount: 25_000_000, paydays: [1]}`
- Record B: `{amount: 25_000_000, paydays: [15]}`

A naive implementation that includes both records in every period would compute:
```
totalIncome = 25_000_000 + 25_000_000 = 50_000_000 per half-month period
```

But the user only receives 25 000 000 kopecks in each half-month period. The naive approach
**doubles the income** and produces an inflated budget.

The `startNominalPayday` filter prevents this by selecting only the income record that matches the
payday that started the period.

---

## 3. Canonical Income Configurations

### Configuration A: Single Record, Single Payday

**When to use:** The user receives one payment on one fixed day.

**Example:** `{amount: 10_000_000, paydays: [15]}` — 100 000 ₽ on the 15th every month.

**Period started by payday 15 (March 13 actual, 15 nominal):**
- `startNominalPayday = 15`
- `paydays.includes(15) = true`
- `totalIncome = 10_000_000` (100 000 ₽)

**Rule:** The full per-payout amount counts once per period.

---

### Configuration B: Two Separate Records, Each with One Payday

**When to use:** The user receives two separate transfers on different days.

**Example:**
- Record A: `{amount: 25_000_000, paydays: [1]}` — 250 000 ₽ advance on the 1st
- Record B: `{amount: 25_000_000, paydays: [15]}` — 250 000 ₽ main salary on the 15th

**Period started by payday 15 (March 13 actual, 15 nominal):**
- `startNominalPayday = 15`
- Record A (`paydays: [1]`): excluded
- Record B (`paydays: [15]`): included → `totalIncome = 25_000_000`

**Period started by payday 1 (March 31 actual, 1 nominal):**
- `startNominalPayday = 1`
- Record A (`paydays: [1]`): included → `totalIncome = 25_000_000`
- Record B (`paydays: [15]`): excluded

**Rule:** Each record counts exactly once per period — in the period whose nominal start matches its payday.

---

### Configuration C: Single Record, Two Paydays (Dmitriy's actual config)

**When to use:** The user receives the same amount on two dates, entered as one record.

**Example:** `{amount: 25_000_000, paydays: [1, 15]}` — same transfer amount on both the 1st and 15th.

**Period started by payday 15:**
- `startNominalPayday = 15`
- `paydays.includes(15) = true`
- `totalIncome = 25_000_000` ✓

**Period started by payday 1:**
- `startNominalPayday = 1`
- `paydays.includes(1) = true`
- `totalIncome = 25_000_000` ✓

**Key difference from legacy Semantics A:** The engine no longer divides by `paydays.length`. The
`amount` field must already represent one paycheck. If the user enters the full monthly total
(500 000 ₽ = 50 000 000 kopecks), they would get double-credited in every period. The correct
entry for Config C is the per-payout amount.

**UX copy for Config C:** "Укажите сумму за одну выплату (не за месяц)."

---

### Configuration D: Asymmetric Split (Unequal Amounts on Different Dates)

**When to use:** The user receives genuinely different amounts on different days.

**Example:**
- Record A: `{amount: 30_000_000, paydays: [1]}` — 300 000 ₽ advance
- Record B: `{amount: 20_000_000, paydays: [15]}` — 200 000 ₽ remainder

Each record counts only in the period started by its payday. The two periods have different budgets
(300 000 ₽ vs 200 000 ₽ before obligations). This is the only correct model for unequal amounts.

---

## 4. The `startNominalPayday` Algorithm

### Source of Truth

**File:** `apps/api/src/domain/finance/buildActualPayPeriods.ts`, function `calculateActualPeriodBounds`.

`startNominalPayday` is the nominal (calendar) day-of-month of the payday that triggered the
current period. It is NOT stored in DB — computed in memory on every request.

### How It Is Determined

```
1. now = current time in user's local timezone
2. allPaydays = sorted union of paydays across all income records
3. lastActualPayday = getLastActualPayday(allPaydays, now, useRussianWorkCalendar)
   → finds the most recent actual payout date (work-calendar adjusted)
4. startNominalPayday = findNominalPayday(lastActualPayday, allPaydays, tz)
   → resolves which nominal day-of-month maps to that actual date
   → checks current month ± adjacent months to handle month-end shifts
5. Period.startDate = toUserLocalMidnightUtc(lastActualPayday, tz)
   → UTC representation of midnight on the actual payday in user's TZ
```

### Why Nominal, Not Actual

`startNominalPayday = 15` even if the actual payout was March 13 (because March 15 is Saturday →
moved to Friday March 13 by Russian work calendar). Income matching uses the nominal payday
because income records store nominal paydays, not adjusted dates.

### Worked Example: allPaydays = [1, 15], today = 2026-03-21, tz = Europe/Moscow, useRuCal = true

```
getLastActualPayday([1, 15], 2026-03-21, useRuCal=true)
  → checks March 15 → Saturday → work-calendar adjusts → March 13 (Friday)
  → March 13 <= March 21 → lastActualPayday = 2026-03-13

findNominalPayday(2026-03-13, [1, 15], 'Europe/Moscow')
  → getActualPayday(2026, 3, 15, useRuCal=true) = March 13 → match: nominalPayday = 15

startNominalPayday = 15

getNextActualPayday([1, 15], 2026-03-21, useRuCal=true)
  → checks April 1 → Tuesday → April 1 (no adjustment needed)
  → periodEnd = April 1 midnight Moscow = 2026-03-31T21:00:00.000Z

Period: [2026-03-12T21:00:00.000Z, 2026-03-31T21:00:00.000Z)
```

Income matching for `{amount: 25_000_000, paydays: [1, 15]}`:
- `paydays.includes(15) = true`
- `totalIncome = 25_000_000` ✓

---

## 5. Income Computation Rule

```typescript
// From apps/api/src/domain/finance/computeS2S.ts
const totalIncome = incomes.reduce((sum, inc) => {
  if (!inc.paydays.includes(startNominalPayday)) return sum;
  return sum + inc.amount;  // Semantics B: no division
}, 0);
```

There is **no** `payCount` division. `inc.amount` must already be the per-payout amount. If a user
enters a monthly total with `paydays: [1, 15]`, the engine will use the full monthly amount for
every period — incorrect. The UX must enforce per-payout entry when `paydays.length > 1`.

### Comparison with Legacy Semantics A (pre-2026-03-21)

| Property | Semantics A (old) | Semantics B (current) |
|----------|-------------------|----------------------|
| `income.amount` meaning | Monthly total | Per-payout amount |
| Division in engine | `Math.round(amount / payCount)` | None |
| Trigger derivation | `endDate.getDate()` → `endDayIdx` lookup | `startNominalPayday` from `calculateActualPeriodBounds` |
| Period boundaries | Nominal calendar (UTC day-of-month) | Actual payout dates (work-calendar adjusted) |
| Source file | `apps/api/src/engine.ts` | `apps/api/src/domain/finance/` |
| Dmitriy's `income.amount` | `50_000_000` kopecks | `25_000_000` kopecks |

---

## 6. Data Migration Record (2026-03-21)

**Performed on production DB, 2026-03-21:**

| Change | SQL | Verification |
|--------|-----|--------------|
| `income.amount` 50M → 25M kopecks (Semantics A → B) | `UPDATE "Income" SET amount = 25000000 WHERE id = 'cmmzgm719000dsq01ylaljmvm'` | `SELECT amount FROM "Income"` → `25000000` |
| `useRussianWorkCalendar` false → true | `UPDATE "Income" SET use_russian_work_calendar = true WHERE id = 'cmmzgm719000dsq01ylaljmvm'` | `SELECT use_russian_work_calendar FROM "Income"` → `t` |

**Golden fixture:** Statically committed in `apps/api/src/domain/finance/__fixtures__/golden_user_dima_march_2026.ts`. All golden tests (35/35) confirm correct behavior post-migration.

---

## 7. When Paydays Change

### What Happens

`PATCH /tg/incomes/:id` updates `paydays` immediately. `POST /tg/periods/recalculate` (or any
debt payment event) triggers `rebuildActivePeriodSnapshot(userId)`.

`rebuildActivePeriodSnapshot`:
1. Fetches all income records (with updated paydays)
2. Calls `calculateActualPeriodBounds(allPaydays, now, tz, useRuCal)` → new actual boundaries
3. Re-matches expenses by `effectiveLocalDateInPeriod` (local TZ, not UTC)
4. Calls `buildDashboardView` (pure) → new `s2sPeriod`, `s2sDaily`, etc.
5. Updates `Period` record in-place

### What Changes After Recalculate

- Period `startDate` / `endDate` may change (actual payout dates, not calendar dates)
- `startNominalPayday` changes if the dominant payday changed
- `totalIncome` recomputed from new `startNominalPayday` × matching income records
- `s2sPeriod` recomputed from scratch
- Expenses re-matched by actual local date (not UTC)

---

## 8. UX Implications

### What Users Must Understand

| Scenario | User must enter |
|----------|----------------|
| One salary, one payday | `amount` = that paycheck amount |
| Two equal paydays | `amount` = each individual paycheck (NOT the monthly total) |
| Two unequal paydays | Two separate records, each with the actual per-transfer amount |

### UX Gaps (open)

**UX-001:** No UI hint on the amount field when `paydays.length > 1`. A user who enters the full
monthly total with two paydays will silently have double-income in every period. Fix: add subtitle
"Укажите сумму за одну выплату, не за месяц" when `paydays.length > 1`.

**UX-002:** No display of `startNominalPayday` on the dashboard. Users with two paydays cannot
see which payday triggered the current period. Fix: add "Период начат выплатой 15-го числа" badge.
