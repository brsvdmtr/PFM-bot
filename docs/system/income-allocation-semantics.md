# Income Allocation Semantics

<!-- Document metadata -->
Document Type: Normative
Status: Active — Verified Against Code
Source of Truth: YES — for all income allocation questions
Verified Against Code: Yes (`apps/api/src/engine.ts` calculateS2S steps 2-3)
Last Updated: 2026-03-20
Related Docs:
  - system/formulas-and-calculation-policy.md
  - system/glossary.md

---

## 1. The Core Question

When a user has one or more income records with one or more payday dates, how much of that income counts toward a given period's budget?

The answer depends on three things:
1. Which period is currently active (determined by `periodEndDate`)
2. Which payday "triggered" this period (the `triggerPayday`)
3. How each income record's `paydays[]` array relates to that trigger

This document resolves every configuration case unambiguously.

---

## 2. Three Income Configurations

### Config A: Single Income Record, Single Payday

**Example:** `{amount: 10,000,000, paydays: [15]}` (100,000 ₽/month, paid on the 15th)

Period: March 15 → April 15 (triggered by payday 15).

- `allPaydays = [15]`
- `endDay = 15` (April), `endDayIdx = 0`
- `endDayIdx > 0` is false → `triggerPayday = allPaydays[0] = 15`
- Income record: `inc.paydays.includes(15) = true`
- `payCount = 1`
- `contribution = 10,000,000 / 1 = 10,000,000`

**Rule:** The full monthly income amount counts once per period.

---

### Config B: Two Separate Income Records, Each with One Payday

**Example:**
- Record 1: `{amount: 25,000,000, paydays: [1]}` — salary advance, 250,000 ₽ on the 1st
- Record 2: `{amount: 25,000,000, paydays: [15]}` — main salary, 250,000 ₽ on the 15th

This represents a single employer who pays half on the 1st (advance) and half on the 15th.

**Period March 15 → April 1 (triggered by payday 15):**
- `allPaydays = [1, 15]`
- `endDay = 1` (April), `endDayIdx = 0`
- `endDayIdx > 0` is false → `triggerPayday = allPaydays[1] = 15`
- Record 1 (`paydays: [1]`): `inc.paydays.includes(15) = false` → skipped
- Record 2 (`paydays: [15]`): `inc.paydays.includes(15) = true`, `payCount = 1`
- `totalIncome = 25,000,000`

**Period April 1 → April 15 (triggered by payday 1):**
- `endDay = 15`, `endDayIdx = 1`
- `endDayIdx > 0` is true → `triggerPayday = allPaydays[0] = 1`
- Record 1 (`paydays: [1]`): `inc.paydays.includes(1) = true`, `payCount = 1`
- `totalIncome = 25,000,000`

**Rule:** Each record counts exactly once per period — in the period triggered by its payday. Income arriving on the 1st is never counted in a period triggered by the 15th, and vice versa.

---

### Config C: Single Income Record with Two Payday Dates

**Example:** `{amount: 50,000,000, paydays: [1, 15]}` — one employer, pays 500,000 ₽/month in two installments

**Period March 15 → April 1 (triggered by payday 15):**
- `allPaydays = [1, 15]`
- `triggerPayday = 15` (same derivation as Config B)
- Record: `inc.paydays.includes(15) = true`
- `payCount = max(1, 2) = 2`
- `contribution = Math.round(50,000,000 / 2) = 25,000,000`
- `totalIncome = 25,000,000`

**Period April 1 → April 15 (triggered by payday 1):**
- `triggerPayday = 1`
- Record: `inc.paydays.includes(1) = true`
- `payCount = 2`
- `contribution = Math.round(50,000,000 / 2) = 25,000,000`
- `totalIncome = 25,000,000`

**Rule:** A single record with `paydays: [a, b]` contributes `amount / 2` per period. It matches the trigger in both periods but is divided by `payCount = 2`.

---

### Mathematical Equivalence of Config B and Config C

For equal-split monthly income:

| Config | `totalIncome` per period |
|--------|------------------------|
| B: Two records × 250,000 ₽ | 250,000 ₽ (one record counts) |
| C: One record × 500,000 ₽ with [1,15] | 500,000 / 2 = 250,000 ₽ |

Both produce **identical** `totalIncome`. The user may enter data either way; the engine produces the same result.

---

### Config D: Asymmetric Split (Unequal Payments on Different Dates)

**Example:**
- Record 1: `{amount: 30,000,000, paydays: [1]}` — 300,000 ₽ advance on the 1st
- Record 2: `{amount: 20,000,000, paydays: [15]}` — 200,000 ₽ remainder on the 15th

This is correctly handled. Each record's amount counts only in the period triggered by its respective payday. The two periods have different budgets (300,000 ₽ vs 200,000 ₽).

**This is the correct way to model unequal split payments.** Using a single record `{amount: 50,000,000, paydays: [1, 15]}` would produce 250,000 ₽ per period regardless of the actual transfer amounts.

---

## 3. triggerPayday Algorithm (Step by Step)

### Source Code (engine.ts, calculateS2S)

```typescript
const allPaydays = [...new Set(incomes.flatMap((inc) => inc.paydays))].sort((a, b) => a - b);
const endDay = periodEndDate.getDate();
const endDayIdx = allPaydays.indexOf(endDay);
const triggerPayday = endDayIdx > 0
  ? allPaydays[endDayIdx - 1]
  : allPaydays[allPaydays.length - 1];
```

### Step-by-Step Explanation

1. **Build `allPaydays`:** Take the union of all `paydays` arrays across all income records. Deduplicate and sort ascending. Example: records with `[1]` and `[15]` → `allPaydays = [1, 15]`.

2. **Find `endDay`:** Extract the day-of-month from `periodEndDate`. This is the payday that will end the current period (and start the next).

3. **Find `endDayIdx`:** Look up `endDay` in `allPaydays`. This is the position of the period-ending payday in the sorted list.

4. **Derive `triggerPayday`:**
   - If `endDayIdx > 0`: the trigger is the payday immediately before the end payday. (`allPaydays[endDayIdx - 1]`)
   - If `endDayIdx == 0`: the trigger is the last payday in the list (wrap-around to previous cycle). (`allPaydays[allPaydays.length - 1]`)
   - If `endDayIdx == -1`: `endDay` is not in `allPaydays`. Fallback: `hasTrigger = true` for all records (all income is included).

### Why endDate Not startDate?

The trigger is derived from `periodEndDate` because the period end date is what uniquely identifies the period. The period March 15 → April 1 ends on April 1 (payday index 0), so the trigger is the preceding payday (index -1 wraps to last = 15). This means "the period was started by the 15th payday."

Using `startDate` would be less reliable because `startDate` may be adjusted for `isProratedStart`.

### Worked Example: allPaydays = [1, 15]

| Period | endDate | endDay | endDayIdx | triggerPayday |
|--------|---------|--------|-----------|---------------|
| March 15 → April 1 | April 1 | 1 | 0 | allPaydays[1] = **15** |
| April 1 → April 15 | April 15 | 15 | 1 | allPaydays[0] = **1** |
| April 15 → May 1 | May 1 | 1 | 0 | allPaydays[1] = **15** |

The trigger alternates: 15, 1, 15, 1, ... This means income with `paydays:[15]` is counted in the first and third periods; income with `paydays:[1]` is counted in the second.

---

## 4. Income Filtering and Splitting

### Filtering (hasTrigger)

```typescript
const hasTrigger = endDayIdx !== -1 ? inc.paydays.includes(triggerPayday) : true;
```

- Normal case (`endDayIdx != -1`): only income records whose `paydays[]` contains `triggerPayday` are included.
- Fallback (`endDayIdx == -1`): ALL income records are included (no filtering). This fallback fires when the period's `endDate` doesn't match any known payday — possible if paydays were edited after the period was created.

### Splitting (payCount)

```typescript
const payCount = Math.max(1, inc.paydays.length);
return sum + Math.round(inc.amount / payCount);
```

The income amount is divided by the number of paydays on the record. This prorates a monthly income across the number of periods it participates in within a month.

- Record with `paydays: [15]` → `payCount = 1` → full amount counts
- Record with `paydays: [1, 15]` → `payCount = 2` → half amount counts
- Record with `paydays: [5, 10, 20]` → `payCount = 3` → one-third counts

**The split always uses the total count of paydays on the record, regardless of how many periods exist in a month.** If a record has `paydays: [1, 15]`, it will always contribute `amount / 2` when selected, regardless of whether the month has 28 or 31 days.

### Why Separate Records Avoid Double-Counting

With Config B (two separate records):
- Record 1 (`paydays: [1]`) is only selected in periods where `triggerPayday = 1`.
- Record 2 (`paydays: [15]`) is only selected in periods where `triggerPayday = 15`.
- Each record has `payCount = 1`, so the full record amount is counted once.

There is no mechanism that would select both records in the same period unless both paydays are the same (which would be a data entry error).

---

## 5. When Paydays Change

If the user edits their income record's paydays (via the settings screen or income edit), the following must happen for the change to take effect:

### Step 1: Income Record Updated in DB

`PATCH /tg/incomes/:id` updates the `paydays` column. This change is immediate but does NOT automatically affect the active period.

### Step 2: Recalculate Called

`POST /tg/periods/recalculate` must be called (either by user action or automatically if the payday settings screen triggers it). This:
1. Fetches all current income records from DB (with new paydays)
2. Calls `calculatePeriodBounds(allPaydays, today)` to recompute period bounds using new paydays
3. Calls `calculateS2S` with new bounds and updated income
4. Updates the active `Period` record: `startDate`, `endDate`, `daysTotal`, `isProratedStart`, `totalIncome`, `s2sPeriod`, `s2sDaily`, etc.

### What Changes After Recalculate

- Period `startDate` and `endDate` may change if the new paydays create different boundaries
- `isProratedStart` is recomputed (today vs new canonicalStart)
- `s2sPeriod` is recomputed from scratch
- `period.s2sDaily` is updated to new snapshot value
- Existing expenses are not moved or deleted

### What Does NOT Change

- Existing expense records — their `periodId` still points to the same period, which is now updated in-place
- `period.s2sPeriod` for completed periods — recalculate only updates the ACTIVE period

### Old period.s2sDaily Becomes Stale

After recalculate, `period.s2sDaily` reflects the new calculation with `totalExpenses` passed in (from existing period expenses). The dashboard will compute a new live `s2sDaily` from this new `s2sPeriod`. Any cached UI showing the old `s2sDaily` value should be refreshed.

---

## 6. UX Guidance

### What the Onboarding UI Explains

Currently, the onboarding UI accepts `amount` and `paydays[]` per income entry. The `paydays` field allows multiple dates.

Users should understand:
- "Payday" means the day of the month when you receive this income
- If you receive two separate transfers from the same employer, you can enter them as two separate records, each with one payday date
- If you receive one transfer but want to track it as monthly and have it split evenly across two payday periods, enter one record with both dates in `paydays`
- The amount entered for a record is the **total monthly amount** for that record

### What the Income Edit Screen Explains

Currently, the income edit screen (`PATCH /tg/incomes/:id`) does not warn about the payCount division. Users who add a second date to `paydays` on an existing record will silently receive half the income per period without explanation.

**Gap:** No UI warning when `paydays.length` changes on a record that already has `amount` set.

### How to Phrase "Per Period" vs "Per Month"

For UI copy:
- The `amount` field on an income record is always a **monthly** amount
- `s2sPeriod` is a **period** amount — it equals approximately `amount / payCount` minus allocations
- "Daily limit" (`s2sDaily`) is a **period** daily average, not a fixed monthly daily average

Avoid saying "daily budget" as a fixed value. Use "today's safe-to-spend limit" to indicate it changes with carry-over.

### Current UX Gaps

1. **No confirmation when payday change triggers recalculate.** The settings screen calls recalculate after payday save, but the user sees only "saved" without explanation of what changed.

2. **No display of triggerPayday.** Users with two paydays cannot see which payday is "active" for the current period from the dashboard UI.

3. **No explanation of Config B vs Config C trade-off.** Users who entered unequal split payments as a single record with two paydays will get equal-split amounts, not the actual transfer amounts.

4. **payCount division is silent.** No UI shows the user that a record with `paydays: [1, 15]` contributes `amount / 2` per period.

---

## 7. Canonical Examples with Numbers

### Example 1: Standard Two-Payday Salary (Config B)

User earns 500,000 ₽/month, paid 250,000 ₽ on the 1st (advance) and 250,000 ₽ on the 15th.

**Income records:**
- Record A: `{amount: 25,000,000, paydays: [1]}`
- Record B: `{amount: 25,000,000, paydays: [15]}`

**Period March 15 → April 1:**
- `triggerPayday = 15`
- Record A: excluded (paydays:[1] does not include 15)
- Record B: included, `payCount = 1`, `contribution = 25,000,000`
- `totalIncome = 25,000,000` (250,000 ₽)

**Period April 1 → April 15:**
- `triggerPayday = 1`
- Record A: included, `payCount = 1`, `contribution = 25,000,000`
- Record B: excluded (paydays:[15] does not include 1)
- `totalIncome = 25,000,000` (250,000 ₽)

Result: Each half-period correctly gets its 250,000 ₽ paycheck. No double-counting, no under-counting.

---

### Example 2: Salary + Freelance with Different Paydays

User has:
- Salary: `{amount: 15,000,000, paydays: [5]}` (150,000 ₽ on the 5th)
- Freelance: `{amount: 5,000,000, paydays: [25]}` (50,000 ₽ on the 25th, when client typically pays)

**Period March 5 → April 5:**
- `allPaydays = [5, 25]`
- `endDay = 5` (April), `endDayIdx = 0`
- `triggerPayday = allPaydays[1] = 25`
- Salary record (`paydays:[5]`): `inc.paydays.includes(25) = false` → excluded
- Freelance record (`paydays:[25]`): `inc.paydays.includes(25) = true`, `payCount = 1`
- `totalIncome = 5,000,000` (50,000 ₽)

Wait — this does not seem right. The period March 5 → April 5 should include the salary paid on March 5.

Re-examine: period March 5 → April 5. `endDate = April 5`. `endDay = 5`. `allPaydays = [5, 25]`. `endDayIdx = indexOf(5) = 0`. `endDayIdx > 0` is false → `triggerPayday = allPaydays[1] = 25`.

The trigger is the payday BEFORE the end payday in the sorted list. Period ends April 5, meaning it was triggered by payday 25 (the previous period-ending trigger). So this period covers March 25 → April 5? No — the period bounds are computed by `calculatePeriodBounds`, not by triggerPayday.

**Clarification:** The period *bounds* are from `calculatePeriodBounds` (March 5 → April 5 for payday [5] or [5,25] where day >= 5). The *income selection* within that period is determined separately by `triggerPayday`. They are independent calculations.

For this example with `today = March 20`:
- `calculatePeriodBounds([5, 25], March 20)`:
  - `day = 20`, `a = 5`, `b = 25`
  - `day >= a and day < b` → `periodStart = March 5`, `periodEnd = March 25`
- So the period is March 5 → March 25, NOT March 5 → April 5.

Let's redo with the correct period March 5 → March 25:
- `endDay = 25`, `endDayIdx = indexOf(25) = 1`
- `endDayIdx > 0` is true → `triggerPayday = allPaydays[0] = 5`
- Salary (`paydays:[5]`): `inc.paydays.includes(5) = true`, `payCount = 1`, `contribution = 15,000,000`
- Freelance (`paydays:[25]`): `inc.paydays.includes(5) = false` → excluded
- `totalIncome = 15,000,000` (150,000 ₽)

The period March 5 → March 25 captures only the salary paycheck from March 5. The freelance income from March 25 will be in the next period (March 25 → April 5).

**Rule:** Salary and freelance with different paydays are naturally separated into their own periods. Only the income matching the period's trigger payday is counted. No cross-contamination.

---

### Example 3: User Changes Payday from 15th to 10th

Setup:
- Original: `{amount: 12,000,000, paydays: [15]}`
- Today: March 20 (active period: March 15 → April 15)

User edits income record: `paydays` becomes `[10]`. Then saves (recalculate is triggered).

**After recalculate:**
- `calculatePeriodBounds([10], March 20)`:
  - `day = 20 >= 10` → `canonicalStart = March 10`, `periodEnd = April 10`
  - `isProratedStart = (20 != 10) = true`
  - `actualStart = March 20`
  - `fullPeriodDays = daysBetween(Mar 10, Apr 10) = 31`
  - `daysTotal = daysBetween(Mar 20, Apr 10) = 21`

**triggerPayday for new period (ends April 10):**
- `allPaydays = [10]`
- `endDay = 10`, `endDayIdx = 0`
- `triggerPayday = allPaydays[0] = 10`

**Income:**
- Record: `inc.paydays.includes(10) = true`, `payCount = 1`
- `totalIncome = 12,000,000`

**Result:** Period is now March 20 → April 10 (prorated). Budget is recalculated using the new period length. Expenses already logged between March 15 and March 19 remain in the period (the period record is updated in-place, not replaced).

**What changed:** Period end moved from April 15 to April 10 (5 days shorter). `daysTotal` dropped from 26 to 21. `s2sPeriod` and `s2sDaily` were recomputed.
