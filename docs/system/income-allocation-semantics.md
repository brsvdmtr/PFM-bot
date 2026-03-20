---
title: "Income Allocation Semantics"
document_type: Normative
status: Active
source_of_truth: YES
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./formulas-and-calculation-policy.md
    relation: "Steps 2–3 described there"
  - path: ./glossary.md
    relation: "term definitions"
  - path: ./system-spec-v1.md
    relation: "system context"
---

# Income Allocation Semantics

This document is the authoritative source for how income is allocated to periods in PFM-bot. It covers the triggerPayday algorithm, three income configurations, the double-counting problem and how it is prevented, proration behavior, and UX implications.

---

## 1. The Core Question

When a user has one or more income records with one or more payday dates, how much of that income counts toward a given period's budget?

The answer depends on three things:
1. Which period is currently active (determined by `periodEndDate`)
2. Which payday "triggered" this period (the `triggerPayday`)
3. How each income record's `paydays[]` array relates to that trigger

**This document resolves every configuration case unambiguously.**

---

## 2. Why Naive Counting Is Wrong

Consider a user who receives salary in two transfers:
- 250,000 ₽ on the 1st of the month (advance)
- 250,000 ₽ on the 15th of the month (main payment)

They create two income records:
- Record A: `{amount: 25,000,000, paydays: [1]}`
- Record B: `{amount: 25,000,000, paydays: [15]}`

A naive implementation that includes both records in every period would compute:
```
totalIncome = 25,000,000 + 25,000,000 = 50,000,000 per half-month period
```

But the user only receives 25,000,000 in each half-month period (the 1st payment in the first half, the 15th payment in the second half). The naive approach **doubles the income** and produces an inflated budget.

The `triggerPayday` algorithm prevents this by selecting only the income record that matches the period's trigger.

---

## 3. Three Income Configurations

### Configuration A: Single Income Record, Single Payday

**When to use:** The user receives one salary payment on one fixed day.

**Example:** `{amount: 10,000,000, paydays: [15]}` — 100,000 ₽ on the 15th every month.

**Period March 15 → April 15:**
- `allPaydays = [15]`
- `endDay = 15`, `endDayIdx = 0`
- `endDayIdx > 0` is false → `triggerPayday = allPaydays[0] = 15`
- Record: `inc.paydays.includes(15) = true`, `payCount = 1`
- `totalIncome = Math.round(10,000,000 / 1) = 10,000,000` (100,000 ₽)

**Rule:** The full monthly income amount counts once per period.

---

### Configuration B: Two Separate Records, Each with One Payday

**When to use:** The user receives two separate transfers on different days, possibly for different amounts.

**Example:**
- Record A: `{amount: 25,000,000, paydays: [1]}` — 250,000 ₽ advance on the 1st
- Record B: `{amount: 25,000,000, paydays: [15]}` — 250,000 ₽ main salary on the 15th

**Period March 15 → April 1** (triggered by payday 15):
- `allPaydays = [1, 15]`
- `endDay = 1` (April 1), `endDayIdx = 0`
- `endDayIdx > 0` is false → `triggerPayday = allPaydays[1] = 15`
- Record A (`paydays: [1]`): `inc.paydays.includes(15) = false` → **skipped**
- Record B (`paydays: [15]`): `inc.paydays.includes(15) = true`, `payCount = 1`
- `totalIncome = 25,000,000` (250,000 ₽) ✓

**Period April 1 → April 15** (triggered by payday 1):
- `endDay = 15`, `endDayIdx = 1`
- `endDayIdx > 0` is true → `triggerPayday = allPaydays[0] = 1`
- Record A (`paydays: [1]`): `inc.paydays.includes(1) = true`, `payCount = 1`
- Record B (`paydays: [15]`): `inc.paydays.includes(1) = false` → **skipped**
- `totalIncome = 25,000,000` (250,000 ₽) ✓

**Rule:** Each record counts exactly once per period — in the period triggered by its payday.

---

### Configuration C: Single Record with Two Payday Dates

**When to use:** The user wants to enter one record representing a monthly salary that is distributed across two periods. Both paydays produce the same split.

**Example:** `{amount: 50,000,000, paydays: [1, 15]}` — 500,000 ₽/month, split across both periods.

**Period March 15 → April 1** (same as Config B):
- `triggerPayday = 15` (same derivation)
- Record: `inc.paydays.includes(15) = true`
- `payCount = max(1, 2) = 2`
- `contribution = Math.round(50,000,000 / 2) = 25,000,000`
- `totalIncome = 25,000,000` (250,000 ₽) ✓

**Period April 1 → April 15:**
- `triggerPayday = 1`
- Record: `inc.paydays.includes(1) = true`
- `payCount = 2`
- `contribution = Math.round(50,000,000 / 2) = 25,000,000`
- `totalIncome = 25,000,000` (250,000 ₽) ✓

**Rule:** A single record with `paydays: [a, b]` contributes `amount / 2` per period.

---

### Mathematical Equivalence of Config B and Config C

For equal-split monthly income, Configs B and C are identical in effect:

| Configuration | totalIncome per period |
|---------------|----------------------|
| B: Two records × 25,000,000 kopecks (one fires per period) | 25,000,000 |
| C: One record × 50,000,000 kopecks with `paydays: [1, 15]` | 50,000,000 / 2 = 25,000,000 |

**Both produce identical results.** The user may enter data either way.

---

### Configuration D: Asymmetric Split (Unequal Amounts on Different Dates)

**When to use:** The user receives genuinely different amounts on different days.

**Example:**
- Record A: `{amount: 30,000,000, paydays: [1]}` — 300,000 ₽ advance
- Record B: `{amount: 20,000,000, paydays: [15]}` — 200,000 ₽ remainder

Each record's amount counts only in the period triggered by its respective payday. The two periods have different budgets (300,000 ₽ vs 200,000 ₽ before obligations).

**This is the correct model for unequal payments.** Using a single record `{amount: 50,000,000, paydays: [1, 15]}` would produce 250,000 ₽ per period regardless of actual transfer amounts — incorrect for this case.

---

## 4. The triggerPayday Algorithm

### Source Code (`engine.ts`, `calculateS2S`)

```typescript
const allPaydays = [...new Set(incomes.flatMap((inc) => inc.paydays))].sort((a, b) => a - b);
const endDay = periodEndDate.getDate();
const endDayIdx = allPaydays.indexOf(endDay);
const triggerPayday = endDayIdx > 0
  ? allPaydays[endDayIdx - 1]
  : allPaydays[allPaydays.length - 1];
```

### Step-by-Step Explanation

**Step 1 — Build `allPaydays`:**
Take the union of all `paydays` arrays across all income records. Deduplicate with `new Set()`. Sort ascending. Example: records with `[1]` and `[15]` → `allPaydays = [1, 15]`.

**Step 2 — Find `endDay`:**
Extract the day-of-month integer from `periodEndDate`. This is the payday that ends the current period (and starts the next).

**Step 3 — Find `endDayIdx`:**
Look up `endDay` in `allPaydays` with `indexOf`. Returns the 0-based position, or -1 if not found.

**Step 4 — Derive `triggerPayday`:**
- If `endDayIdx > 0`: trigger = the payday immediately before the end payday. `allPaydays[endDayIdx - 1]`
- If `endDayIdx == 0`: trigger = the last payday in the list (wrap-around). `allPaydays[allPaydays.length - 1]`
- If `endDayIdx == -1`: fallback — `hasTrigger = true` for all records. All income is included.

### Why endDate, Not startDate?

The trigger is derived from `periodEndDate` because:
1. The end date uniquely identifies the period: period "March 15 → April 1" ends on April 1 (payday index 0), so the trigger is the preceding payday (wraps to index last = 15), meaning "this period was started by the 15th payday."
2. `startDate` may be adjusted for `isProratedStart`, making it unreliable as a payday reference.

### Worked Example: allPaydays = [1, 15]

| Period | endDate | endDay | endDayIdx | triggerPayday | Income that counts |
|--------|---------|--------|-----------|---------------|-------------------|
| Mar 15 → Apr 1 | Apr 1 | 1 | 0 | allPaydays[1] = **15** | paydays includes 15 |
| Apr 1 → Apr 15 | Apr 15 | 15 | 1 | allPaydays[0] = **1** | paydays includes 1 |
| Apr 15 → May 1 | May 1 | 1 | 0 | allPaydays[1] = **15** | paydays includes 15 |

The trigger alternates: 15, 1, 15, 1, ... Each period gets exactly one income installment.

### Worked Example: allPaydays = [5, 25]

| Period | endDate | endDay | endDayIdx | triggerPayday |
|--------|---------|--------|-----------|---------------|
| Mar 5 → Mar 25 | Mar 25 | 25 | 1 | allPaydays[0] = **5** |
| Mar 25 → Apr 5 | Apr 5 | 5 | 0 | allPaydays[1] = **25** |

The period Mar 5 → Mar 25 captures the income from the 5th payday. The period Mar 25 → Apr 5 captures income from the 25th payday.

---

## 5. Income Filtering and Splitting

### Filtering (hasTrigger)

```typescript
const hasTrigger = endDayIdx !== -1 ? inc.paydays.includes(triggerPayday) : true;
```

- **Normal case** (`endDayIdx != -1`): Only income records whose `paydays[]` contains `triggerPayday` are included. All others are skipped.
- **Fallback** (`endDayIdx == -1`): ALL income records are included. This fires when `periodEndDate.getDate()` is not in `allPaydays` — possible if paydays were edited after the period was created. This prevents a zero-income period due to stale period data.

### Splitting (payCount)

```typescript
const payCount = Math.max(1, inc.paydays.length);
contribution = Math.round(inc.amount / payCount);
```

The income amount is divided by the count of paydays on the record. This distributes a monthly total across the number of periods the record participates in per month.

| `paydays` length | `payCount` | Fraction of `amount` |
|-----------------|------------|---------------------|
| `[15]` — 1 payday | 1 | Full amount (÷ 1) |
| `[1, 15]` — 2 paydays | 2 | Half amount (÷ 2) |
| `[5, 10, 20]` — 3 paydays | 3 | One-third (÷ 3) |

**The split always uses the total count of paydays on the record, regardless of month length.** A record with `paydays: [1, 15]` always contributes `amount / 2`, whether the month has 28 or 31 days.

### Why Separate Records (Config B) Avoid Double-Counting

With Config B (two separate records):
- Record A (`paydays: [1]`) is only selected when `triggerPayday = 1`.
- Record B (`paydays: [15]`) is only selected when `triggerPayday = 15`.
- Each has `payCount = 1`, so the full record amount counts once.

No mechanism exists that would select both records in the same period, unless both records have the same payday value (a data entry error).

---

## 6. Income Proration Rules

### What Is Prorated

When `isProratedStart = true` (user joined mid-period):
- `totalObligations` is prorated: `Math.round(sum(obligations) * (daysTotal / fullPeriodDays))`
- `totalDebtPayments` is prorated: `Math.round(sum(minPayments) * (daysTotal / fullPeriodDays))`
- `efContribution.periodEFGoal` is prorated

### What Is NOT Prorated

**Income is NOT prorated.** The full period installment counts regardless of how many days into the period the user joined.

**Reason:** Income was received in full on the payday. If a user joins on March 20 and their payday was March 15, they already have the full 15th paycheck. The engine correctly counts the full income for the trigger payday, regardless of `isProratedStart`.

The proration only reduces the obligations and debt payments to reflect that the user is only responsible for obligations covering the actual period length (not the full canonical period they missed the start of).

---

## 7. When Paydays Change

### Step 1: Income Record Updated

`PATCH /tg/incomes/:id` updates the `paydays` column in DB immediately. This does NOT automatically affect the active period.

### Step 2: Recalculate Called

`POST /tg/periods/recalculate` must be called. The payday settings screen triggers this automatically on save.

Recalculate:
1. Fetches all current income records (with new paydays)
2. Calls `calculatePeriodBounds(allPaydays, today)` — may produce different period bounds
3. Calls `calculateS2S` with new bounds and updated income
4. Updates the active `Period` record in-place: `startDate`, `endDate`, `daysTotal`, `isProratedStart`, `totalIncome`, `s2sPeriod`, `s2sDaily`, etc.

### What Changes After Recalculate

- Period `startDate` and `endDate` may change if new paydays create different boundaries
- `isProratedStart` is recomputed (today vs new `canonicalStart`)
- `s2sPeriod` is recomputed from scratch with updated `totalIncome`
- `Period.s2sDaily` snapshot is updated to reflect new calculation
- Existing expenses are not moved or deleted

### What Does NOT Change

- Existing `Expense` records — their `periodId` still points to the same (now updated) period
- `Period.s2sPeriod` for completed periods — recalculate only updates the ACTIVE period

---

## 8. Worked Examples

### Example 1: Standard Two-Payday Salary (Config B)

User earns 500,000 ₽/month, paid 250,000 ₽ on the 1st and 250,000 ₽ on the 15th.

**Records:**
- A: `{amount: 25,000,000, paydays: [1]}`
- B: `{amount: 25,000,000, paydays: [15]}`

**Period March 15 → April 1:**
- `triggerPayday = 15`
- Record A: excluded (paydays:[1] does not include 15)
- Record B: included, `payCount = 1`, `contribution = 25,000,000`
- `totalIncome = 25,000,000` (250,000 ₽)

**Period April 1 → April 15:**
- `triggerPayday = 1`
- Record A: included, `payCount = 1`, `contribution = 25,000,000`
- Record B: excluded
- `totalIncome = 25,000,000` (250,000 ₽)

Each half-period correctly gets its paycheck. No double-counting, no under-counting.

---

### Example 2: Before the Fix — Double-Counting Bug (Historical)

Before the triggerPayday algorithm was implemented, the engine included ALL income records in every period. With Config B:

```
Period March 15 → April 1:
  totalIncome = 25,000,000 (Record A) + 25,000,000 (Record B) = 50,000,000
```

But the user only receives 25,000,000 in that period. The engine doubled the budget. With a user spending to their daily limit, they would overshoot their actual income by 100%.

**After the fix:** Only the record matching `triggerPayday` is counted. `totalIncome = 25,000,000` for each period.

---

### Example 3: Salary + Freelance on Different Paydays

**Records:**
- Salary: `{amount: 15,000,000, paydays: [5]}` — 150,000 ₽ on the 5th
- Freelance: `{amount: 5,000,000, paydays: [25]}` — 50,000 ₽ on the 25th

**Period bounds for today = March 20:**
- `calculatePeriodBounds([5, 25], March 20)`:
  - `day = 20`, `a = 5`, `b = 25`
  - `day >= a and day < b` → `canonicalStart = March 5`, `periodEnd = March 25`
- Period: March 5 → March 25

**Income selection:**
- `allPaydays = [5, 25]`, `endDay = 25`, `endDayIdx = 1`
- `endDayIdx > 0` → `triggerPayday = allPaydays[0] = 5`
- Salary (`paydays:[5]`): included, `payCount = 1`, `contribution = 15,000,000`
- Freelance (`paydays:[25]`): excluded (does not include 5)
- `totalIncome = 15,000,000` (150,000 ₽)

The period March 5 → March 25 captures the salary from the 5th. The freelance income from March 25 will be in the next period (March 25 → April 5, where `triggerPayday = 25`).

**Result:** Salary and freelance income are naturally separated into their own periods. No cross-contamination.

---

### Example 4: User Changes Payday from 15th to 10th

**Original:** `{amount: 12,000,000, paydays: [15]}`
**Today:** March 20 (active period: March 15 → April 15, prorated start)

User edits income: `paydays = [10]`. Settings screen triggers recalculate.

**After recalculate:**
- `calculatePeriodBounds([10], March 20)`:
  - `day = 20 >= 10` → `canonicalStart = March 10`, `periodEnd = April 10`
  - `isProratedStart = (20 != 10) = true`, `actualStart = March 20`
  - `fullPeriodDays = daysBetween(Mar 10, Apr 10) = 31`
  - `daysTotal = daysBetween(Mar 20, Apr 10) = 21`

**Income (new period ends April 10):**
- `allPaydays = [10]`, `endDay = 10`, `endDayIdx = 0`
- `triggerPayday = allPaydays[0] = 10`
- Record: `inc.paydays.includes(10) = true`, `payCount = 1`
- `totalIncome = 12,000,000`

**What changed:** Period end moved from April 15 to April 10 (5 days shorter). `daysTotal` dropped from 26 to 21. `s2sPeriod` and `Period.s2sDaily` were recomputed. Existing expenses remain linked to the same period.

---

### Example 5: Single Record Config C — Equivalent Periods

**Record:** `{amount: 60,000,000, paydays: [1, 15]}` — 600,000 ₽/month, evenly split.

**Period March 1 → March 15:**
- `allPaydays = [1, 15]`, `endDay = 15`, `endDayIdx = 1`
- `triggerPayday = allPaydays[0] = 1`
- Record: `paydays.includes(1) = true`, `payCount = 2`
- `contribution = Math.round(60,000,000 / 2) = 30,000,000` (300,000 ₽)

**Period March 15 → April 1:**
- `endDay = 1`, `endDayIdx = 0`
- `triggerPayday = allPaydays[1] = 15`
- Record: `paydays.includes(15) = true`, `payCount = 2`
- `contribution = Math.round(60,000,000 / 2) = 30,000,000` (300,000 ₽)

Each period gets exactly 300,000 ₽. Total across both periods = 600,000 ₽ (the full monthly amount).

---

## 9. UX Implications and User Confusion Prevention

### What Users Must Understand

| Scenario | User must know |
|----------|---------------|
| Entering a single salary with one payday | `amount` = full monthly amount. No split. |
| Entering salary paid in two transfers | Two options: (a) two separate records with actual per-transfer amounts, or (b) one record with `amount` = monthly total and `paydays = [date1, date2]`. Both are correct and equivalent when the two transfers are equal. |
| Unequal split payments | Must use two separate records with the actual per-transfer amounts. A single record with two paydays always splits `amount / 2`. |
| Adding a second payday to an existing record | The `amount` on that record will be divided by 2 going forward. The total monthly income is preserved only if the user also doubles the `amount` on that record. |

### Current UX Gaps

1. **No warning when `paydays.length` changes on an existing record.** A user who adds a second payday date to a record will silently receive half the per-period income without explanation. No UI warning is shown.

2. **No display of active `triggerPayday`.** Users with two paydays cannot see which payday triggered the current period from the dashboard UI.

3. **No explanation of Config B vs Config C trade-off.** Users who entered unequal split payments as a single record with two paydays will receive the equal-split amount instead of the actual transfer amounts.

4. **`payCount` division is silent.** No UI shows that a record with `paydays: [1, 15]` contributes `amount / 2` per period.

5. **No confirmation dialog on payday change + recalculate.** The settings screen calls recalculate after saving a payday change, but the user sees only "saved" without seeing what the new period dates or `s2sPeriod` will be.

### Recommended UX Copy

- For `amount` field on income record: "Ежемесячная сумма" (monthly total for this income source)
- When `paydays.length = 2`: show "Per-period amount: X ₽ (monthly ÷ 2)"
- For the `triggerPayday` in a period context: "Этот период начат выплатой X числа"
- Avoid "daily budget" as a fixed value. Use "сегодняшний лимит" to convey that it changes.
