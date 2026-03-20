---
title: "Glossary"
document_type: Normative
status: Active
source_of_truth: YES
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./formulas-and-calculation-policy.md
    relation: "formula details defined there"
  - path: ./numerical-source-of-truth.md
    relation: "number sources defined there"
  - path: ./income-allocation-semantics.md
    relation: "income allocation details defined there"
  - path: ./system-spec-v1.md
    relation: "system context"
---

# Glossary

This document defines the canonical name for every concept in PFM-bot. When writing code, documentation, UI copy, or support messages, use these names exactly. Do not invent synonyms.

For formulas and calculation rules, see `./formulas-and-calculation-policy.md`. For where each displayed number comes from, see `./numerical-source-of-truth.md`. For income allocation details, see `./income-allocation-semantics.md`.

---

## Terms (Alphabetical)

---

### Active Period

**Type:** Entity state / query concept
**Definition:** The single Period record with `status = 'ACTIVE'` for a given user. Invariant: at most one ACTIVE period per user at any time. The rollover cron marks the old period COMPLETED before creating the new one. Selected by `prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } })`.
**See also:** Period, Period Status, Rollover

---

### afterFixed

**Type:** Monetary amount (intermediate calculation variable)
**Unit:** Kopecks (Int)
**Definition:** `totalIncome - totalObligations - totalDebtPayments`. Income remaining after all fixed costs and minimum debt payments. May be negative, indicating a structural deficit before any discretionary allocation. Never stored in DB.
**See also:** freePool, residual
**Formula ref:** `./formulas-and-calculation-policy.md` Step 6

---

### Avalanche Pool

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Russian context:** Part of the debt acceleration strategy (not directly labeled in UI)
**Definition:** The extra amount directed toward the focus debt this period, beyond the regular `minPayment`. Computed as a percentage of `investPool` (25%–50%) based on focus debt APR and EF funding status. Reduces `residual` and therefore `s2sPeriod`. Not a separate stored field — absorbed into the period budget calculation.

| EF funded | Focus debt APR | avalanchePool |
|-----------|----------------|---------------|
| Yes | >= 18% | 50% of `investPool` |
| Yes | < 18% | 25% of `investPool` |
| No | >= 18% | 30% of `investPool` |
| No | < 18% | 0 |
| No focus debt | — | 0 |

Always capped at `focusDebt.balance`.
**See also:** Focus Debt, investPool, freePool
**Formula ref:** `./formulas-and-calculation-policy.md` Step 10

---

### Carry-Over

**Type:** Implicit mechanism (not a named field or API value)
**Definition:** The automatic redistribution of unspent daily budget across remaining days of the period. Not stored anywhere. Emerges from recomputing `dynamicS2sDaily = periodRemaining / daysLeft` on every request. If the user spends less than `dynamicS2sDaily` on day N, tomorrow's limit will be higher. If the user overspends, tomorrow's limit will be lower.

There is no explicit "carry-over amount" in the API response or DB. The entire mechanism is implicit in `dynamicS2sDaily`.
**See also:** dynamicS2sDaily, periodRemaining
**Formula ref:** `./formulas-and-calculation-policy.md` Section 11

---

### Daily Limit

**Type:** Umbrella term for two distinct values
**Definition:** Refers to either `dynamicS2sDaily` (the live per-day limit) or `Period.s2sDaily` (the stored snapshot). Always specify which is meant. In code and docs, use `dynamicS2sDaily` for the live value and `Period.s2sDaily` for the snapshot.

**Do not use "daily limit" without qualification in technical contexts.**
**See also:** dynamicS2sDaily, Period.s2sDaily (snapshot)

---

### DailySnapshot

**Type:** Entity
**DB table:** `DailySnapshot`
**Definition:** A nightly record created at 23:55 UTC by the snapshot cron. Captures the state of each active period at that moment. Unique constraint on `(periodId, date)`.

| Field | Type | Notes |
|-------|------|-------|
| `s2sPlanned` | Int (kopecks) | `dynamicS2sDaily` at 23:55 UTC |
| `s2sActual` | Int (kopecks) | `s2sPlanned - todayTotal` — **can be negative** |
| `totalExpenses` | Int (kopecks) | Sum of today's expenses at 23:55 UTC |
| `isOverspent` | Boolean | `todayTotal > s2sPlanned` |

`s2sActual` is NOT floored at 0. The live `s2sToday` IS floored at 0. Do not compare them as equivalent.
**See also:** s2sToday
**Formula ref:** `./numerical-source-of-truth.md` §1.10

---

### Days Elapsed

**Type:** Count
**Unit:** Days (Int, minimum 1)
**API field:** Not directly returned; used internally in `daysLeft` calculation
**Definition:** The number of days from `periodStartDate` to today, inclusive. Computed as `Math.max(1, Math.ceil((now - startDate) / msPerDay))`. Used by the dashboard to compute `daysLeft = daysTotal - daysElapsed + 1`.
**See also:** daysLeft, daysTotal
**Formula ref:** `./formulas-and-calculation-policy.md` Step 1

---

### Days Left

**Type:** Count
**Unit:** Days (Int, minimum 1)
**API field:** `daysLeft` in `GET /tg/dashboard`
**Russian UI label:** "дней осталось"
**Definition:** The number of calendar days remaining in the period, inclusive of today. Computed as `max(1, daysTotal - daysElapsed + 1)`. Minimum 1 — prevents division by zero in `dynamicS2sDaily` calculation. On the last day of a period, `daysLeft = 1`.

Never stored in DB. Computed per request.
**See also:** daysTotal, daysElapsed, dynamicS2sDaily
**Formula ref:** `./formulas-and-calculation-policy.md` Step 1

---

### Days Total

**Type:** Count
**Unit:** Days (Int, minimum 1)
**DB field:** `Period.daysTotal`
**API field:** `daysTotal` in `GET /tg/dashboard`
**Definition:** The total number of days in the current period from `actualStart` to `periodEnd`. Computed by `daysBetween(actualStart, periodEnd)`. Persisted at period creation; does not change as time passes.

When `isProratedStart = true`: `daysTotal < fullPeriodDays` (period was cut short by late start).
When `isProratedStart = false`: `daysTotal == fullPeriodDays`.
**See also:** fullPeriodDays, isProratedStart
**Formula ref:** `./formulas-and-calculation-policy.md` §5.5

---

### Debt

**Type:** Entity
**DB table:** `Debt`
**Definition:** A liability belonging to the user. Has a remaining `balance`, annual percentage rate (`apr` as decimal fraction), and required `minPayment`. Used by the engine to compute `totalDebtPayments` (minimum payments) and `avalanchePool` (extra payment for focus debt).

| Field | Type | Notes |
|-------|------|-------|
| `balance` | Int (kopecks) | Remaining principal. Debts with `balance = 0` are excluded from engine calculations. |
| `apr` | Float | Stored as decimal (0.189 for 18.9%) |
| `minPayment` | Int (kopecks) | Monthly minimum required payment |
| `isFocusDebt` | Boolean | Only one should be true per user |
| `isPaidOff` | Boolean | Set when balance reaches 0 |
| `dueDay` | Int | Day of month payment is due; used by payment alert cron |

**Common confusion:** "balance" on a Debt means the remaining loan principal. It is not the same as `periodRemaining` (remaining spending budget). Always qualify: "debt balance."
**See also:** Focus Debt, minPayment, Avalanche Pool

---

### DEFICIT (Status)

**Type:** S2S status value
**Definition:** `s2sStatus = 'DEFICIT'` when the sum of all planned deductions (obligations + debt payments + reserve + EF contribution + avalanche) exceeds income. `residual < 0`. The user has no discretionary spending budget: `s2sPeriod = 0`. `s2sColor = 'red'`.

Triggered in engine by: `residual < 0`.
Triggered in dashboard by: `activePeriod.s2sPeriod <= 0`.

**Important:** DEFICIT is an S2S status, NOT a Period status. The Period record's `status` field is either `ACTIVE` or `COMPLETED`. A period with DEFICIT S2S status still has `Period.status = 'ACTIVE'`.
**See also:** S2S Status, residual, s2sPeriod, Period Status

---

### Dynamic S2S Daily

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**API field:** Returned as `s2sDaily` in `GET /tg/dashboard`
**Russian UI label:** "Дневной лимит" (in evening notification and dashboard)
**Definition:** The per-day spending limit, recomputed on every API request from `max(0, round(periodRemaining / daysLeft))`. Incorporates carry-over from previous days in the period. This is the **live** value — not the stored `Period.s2sDaily` snapshot.

Formula: `max(0, Math.round(max(0, s2sPeriod - totalPeriodSpent) / daysLeft))`

**Critical:** The dashboard always computes this live. The stored `Period.s2sDaily` is stale from the moment the first expense is logged.
**See also:** Period.s2sDaily (snapshot), s2sToday, carry-over, periodRemaining
**Formula ref:** `./formulas-and-calculation-policy.md` Step 12; `./numerical-source-of-truth.md` §1.2

---

### EF / Emergency Fund

**Type:** Entity
**DB table:** `EmergencyFund`
**Russian context:** "Подушка безопасности"
**Definition:** The user's emergency savings record. The engine uses it to compute `efContribution` — the amount to set aside this period to reach the savings target.

| Field | Type | Notes |
|-------|------|-------|
| `currentAmount` | Int (kopecks) | User-reported current savings. NOT updated automatically by the engine. |
| `targetMonths` | Int | Default 3. Multiplier for the savings target. |
| `currency` | Enum | Matches user primary currency |

`currentAmount` must be updated manually by the user via `PATCH /tg/ef` when they actually move money into their emergency fund account.
**See also:** EF Contribution, EF Deficit, EF Target

---

### EF Contribution

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**DB field:** `Period.efContribution` (snapshot)
**Russian context:** "Вклад в подушку безопасности"
**Definition:** The amount directed to the emergency fund this period. Capped at both 20% of `freePool` and the remaining `efDeficit`. Zero when the EF is fully funded or when `freePool = 0`.

Capping rules:
1. `min(periodEFGoal, Math.round(freePool * 0.20))` — max 20% of discretionary income
2. `min(result, efDeficit)` — never overshoot the target

**See also:** EF Deficit, EF Target, freePool
**Formula ref:** `./formulas-and-calculation-policy.md` Step 9

---

### EF Deficit

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** `max(0, efTarget - emergencyFund.currentAmount)`. How much more needs to be saved to reach the EF target. Zero when the fund is fully funded or overfunded. When `efDeficit = 0`, `efContribution = 0` and the avalanche rates improve (higher percentage of `investPool` goes to debt).

Never stored — computed at calculation time.
**See also:** EF Target, EF Contribution

---

### EF Target

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** `monthlyObligations * emergencyFund.targetMonths`. The total amount the emergency fund should hold. Uses the raw (non-prorated) monthly obligations sum — always based on a full month of obligations, even in prorated periods.

For a user with 40,000 ₽/month obligations and `targetMonths = 3`: `efTarget = 120,000 ₽` regardless of period length.

Never stored — computed at calculation time.
**Common confusion:** `efTarget` is NOT prorated even when `isProratedStart = true`. This is intentional: the EF should cover a full month's obligations.
**See also:** EF, EF Deficit

---

### Expense

**Type:** Entity
**DB table:** `Expense`
**Definition:** A single spending event entered by the user. Immutable after creation.

| Field | Type | Notes |
|-------|------|-------|
| `amount` | Int (kopecks) | Rounded with `Math.round()` on entry |
| `spentAt` | DateTime (UTC) | Defaults to server now(). Used to determine if expense is "today." |
| `periodId` | String | Links to the ACTIVE period at time of entry |
| `userId` | String | Owner. All queries require userId filter. |

"Today's expenses" = expenses with `spentAt >= UTC midnight` (not user's local midnight).
**See also:** expensesToday, totalPeriodSpent

---

### Focus Debt

**Type:** Debt record flag
**DB field:** `Debt.isFocusDebt = true`
**Definition:** The single debt that receives the `avalanchePool` extra payment. Selected by `determineFocusDebt()` (highest APR, then smallest balance if tied). Only one debt per user should have `isFocusDebt = true` at any time.

In the engine: `focusDebt = activeDebts.find(d => d.isFocusDebt)`. If no debt has `isFocusDebt = true`, `avalanchePool = 0`.
**See also:** Debt, Avalanche Pool

---

### Free Pool

**Type:** Monetary amount (intermediate)
**Unit:** Kopecks (Int)
**Definition:** `max(0, afterFixed - reserve)`. The discretionary money after fixed expenses and the reserve buffer. The base from which `efContribution` and `avalanchePool` are taken. Always non-negative.

Never stored — intermediate computation variable.
**See also:** afterFixed, reserve, investPool
**Formula ref:** `./formulas-and-calculation-policy.md` Step 8

---

### Full Period Days

**Type:** Count
**Unit:** Days (Int, minimum 1)
**Definition:** The total days in the canonical (non-prorated) period — from `canonicalStart` to `periodEnd`, regardless of when the user actually joined. Used as the denominator in proration calculations: `Math.round(value * (daysTotal / fullPeriodDays))`.

When `isProratedStart = false`: `fullPeriodDays == daysTotal`.
When `isProratedStart = true`: `fullPeriodDays > daysTotal`.

Not stored as a separate DB field; derivable from `calculatePeriodBounds` output.
**See also:** daysTotal, isProratedStart

---

### Income

**Type:** Entity
**DB table:** `Income`
**Definition:** A recurring income source with a monthly `amount` (kopecks) and one or more `paydays`. The `amount` is the total monthly amount for that record; the engine divides by `payCount` for per-period allocation.

| Field | Type | Notes |
|-------|------|-------|
| `amount` | Int (kopecks) | Total monthly amount for this record |
| `paydays` | Int[] | Days of month (e.g., [15] or [1, 15]) |
| `isActive` | Boolean | Soft-delete flag |
| `currency` | Enum | Must match user primary currency |

**Common confusion:** For a record with `paydays: [1, 15]`, the `amount` is the total monthly amount. Each period receives `amount / 2`. To model unequal payments, use two separate records.
**See also:** triggerPayday, payCount
**Formula ref:** `./income-allocation-semantics.md`

---

### Income Period (totalIncome)

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**DB field:** `Period.totalIncome` (snapshot)
**Definition:** The total income allocated to this period, as computed by the engine's trigger-based selection. Sum of `Math.round(inc.amount / payCount)` for all income records matching `triggerPayday`. Persisted at period creation.

Not the same as the user's full monthly income — it is the portion that counts for this specific period.
**See also:** triggerPayday, Income
**Formula ref:** `./formulas-and-calculation-policy.md` Step 3

---

### Invest Pool

**Type:** Monetary amount (intermediate)
**Unit:** Kopecks (Int)
**Definition:** `max(0, freePool - efContribution)`. The discretionary pool remaining after EF contribution, available for debt acceleration via the avalanche strategy. Used as the basis for `avalanchePool` percentage calculations.

When `efContribution = 0` (EF funded): `investPool = freePool`.

Never stored — intermediate computation variable.
**See also:** freePool, efContribution, Avalanche Pool
**Formula ref:** `./formulas-and-calculation-policy.md` Step 10

---

### Minor Units (Kopecks / Cents)

**Type:** Monetary representation convention
**Definition:** All money in PFM-bot is stored and computed as integers in the smallest currency unit. 1 ₽ = 100 kopecks. 1 $ = 100 cents. All `Int` fields representing money in the DB schema are in minor units. Float/Decimal types are never used for money.

Display: divide by 100 in the frontend. API inputs and outputs are always in minor units.

**Common confusion:** A user entering "1000 ₽" must send `amount: 100000` (100,000 kopecks) to the API. Sending 1000 will record 10 ₽.
**See also:** `../adr/adr-002-money-in-minor-units.md`

---

### Obligation

**Type:** Entity
**DB table:** `Obligation`
**Russian UI label:** "Обязательный расход" / "Фиксированный расход"
**Definition:** A fixed recurring monthly expense that must be paid regardless of discretionary spending (rent, utilities, subscriptions, loan payments, etc.). Deducted from income before computing the discretionary budget. Prorated when `isProratedStart = true`.

| Field | Type | Notes |
|-------|------|-------|
| `amount` | Int (kopecks) | Monthly cost |
| `isActive` | Boolean | Soft-delete flag |
| `dueDay` | Int (optional) | Day of month the obligation is due |

**See also:** totalObligations, isProratedStart
**Formula ref:** `./formulas-and-calculation-policy.md` Step 4

---

### OVERSPENT (Status)

**Type:** S2S status value
**Definition:** `s2sStatus = 'OVERSPENT'` when today's expenses exceed `dynamicS2sDaily`. The user has spent more today than the per-day limit allows. `s2sColor = 'red'`. `s2sToday = 0`.

Triggered when: `expensesToday > dynamicS2sDaily`.

Takes priority over WARNING. Does NOT mean the entire period budget is exhausted — only that today's allocation is exceeded.
**See also:** S2S Status, WARNING, s2sToday

---

### Period

**Type:** Entity
**DB table:** `Period`
**Definition:** The interval between two consecutive payday events during which the user operates under a fixed `s2sPeriod` budget. Begins on the user's payday (or on onboarding day if prorated) and ends on the next payday date.

| Field | Type | Notes |
|-------|------|-------|
| `s2sPeriod` | Int (kopecks) | Total discretionary budget. Floored at 0. |
| `s2sDaily` | Int (kopecks) | Snapshot at creation. NOT used in live dashboard. |
| `startDate` | DateTime | Actual start (may differ from canonical start if prorated) |
| `endDate` | DateTime | Next payday date (midnight UTC) |
| `daysTotal` | Int | Days from startDate to endDate |
| `isProratedStart` | Boolean | True when user joined mid-period |
| `totalIncome` | Int | Snapshot |
| `totalObligations` | Int | Snapshot |
| `totalDebtPayments` | Int | Snapshot |
| `efContribution` | Int | Snapshot |
| `reserve` | Int | Snapshot |
| `status` | Enum | ACTIVE or COMPLETED |
| `currency` | Enum | Inherited from income |

**See also:** Active Period, Period Status, Rollover, s2sPeriod
**Formula ref:** `./formulas-and-calculation-policy.md` Section 5

---

### Period Remaining (periodRemaining)

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Russian UI label:** "Осталось в периоде"
**Definition:** `max(0, s2sPeriod - totalPeriodSpent)`. The portion of the period budget not yet spent. Used as the numerator in `dynamicS2sDaily`. Floored at 0 for display — never negative in the API response.

Never stored — derived on every request.
**See also:** s2sPeriod, totalPeriodSpent, dynamicS2sDaily
**Formula ref:** `./numerical-source-of-truth.md` §1.5

---

### Period Status

**Type:** Enum
**Values:** `ACTIVE`, `COMPLETED`
**DB field:** `Period.status`
**Definition:** The lifecycle state of a Period record.
- `ACTIVE`: The current period in use. At most one per user.
- `COMPLETED`: Period ended by the rollover cron. Immutable after completion.

**There is no `DEFICIT` period status.** DEFICIT is an S2S status (for spending state), not a period lifecycle state. A period with `s2sPeriod = 0` still has `Period.status = 'ACTIVE'` while it is current.
**See also:** Active Period, S2S Status, Rollover

---

### Prorated Start (isProratedStart)

**Type:** Boolean flag
**DB field:** `Period.isProratedStart`
**Definition:** True when the user joined mid-period — meaning today is not on a canonical payday boundary. When true:
- `totalObligations` is scaled: `Math.round(obligations * (daysTotal / fullPeriodDays))`
- `totalDebtPayments` is scaled: `Math.round(minPayments * (daysTotal / fullPeriodDays))`
- `efContribution.periodEFGoal` is scaled
- Income is **NOT** scaled — full per-period installment is counted regardless

**Common confusion:** `isProratedStart` affects obligations and debt payments but NOT income. Income uses the `triggerPayday` / `payCount` mechanism instead.
**See also:** fullPeriodDays, daysTotal

---

### Reserve

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**DB field:** `Period.reserve` (snapshot)
**Definition:** A buffer withheld from the discretionary income before EF and avalanche allocations. Reduces `freePool` and therefore reduces `s2sPeriod`. Not allocated to any specific purpose.

| Condition | Rate |
|-----------|------|
| `afterFixed > 0` | 10% |
| `afterFixed > 0` and 10% would make `afterReserve < 0` | 5% fallback (unreachable in practice) |
| `afterFixed <= 0` | 0% |

Always `>= 0`.
**See also:** afterFixed, freePool
**Formula ref:** `./formulas-and-calculation-policy.md` Step 7, Section 8

---

### Residual

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**Definition:** `totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool`. The amount left for discretionary spending after all planned allocations. May be negative (triggers DEFICIT status). `s2sPeriod = max(0, residual)`.

Never stored as a separate field in DB — absorbed into `s2sPeriod` and `Period.status` at period creation.
**Common confusion:** Negative `residual` means the sum of all planned deductions exceeds income. The user has no discretionary budget (`s2sPeriod = 0`). DEFICIT status alerts the user.
**See also:** s2sPeriod, DEFICIT, afterFixed
**Formula ref:** `./formulas-and-calculation-policy.md` Step 11

---

### Rollover

**Type:** Process / event
**Definition:** The automatic transition from an expired ACTIVE period to a new ACTIVE period. Executed by Cron 4 at 00:05 UTC daily.

Rollover sequence:
1. Find all ACTIVE periods with `endDate <= today UTC midnight`
2. Mark each COMPLETED
3. For each user: fetch current incomes, obligations, debts, EF
4. Run `calculatePeriodBounds` and `calculateS2S` with today's date
5. Create new ACTIVE period
6. Send new-period notification

If the API is down at 00:05 UTC, rollover does not run until the next cron tick (next day). The expired period remains ACTIVE in the interim.
**See also:** Active Period, Period Status

---

### S2S / Safe to Spend

**Type:** Concept / product feature name
**Russian UI label:** "Safe to Spend" (used untranslated in UI)
**Definition:** The product's core feature. A calculated daily spending limit that tells the user how much they can spend today while staying on track to cover all obligations, debt payments, emergency fund contributions, and debt acceleration before the next payday.

"S2S" is both the feature name and a prefix for the family of specific calculated values: `s2sPeriod`, `dynamicS2sDaily`, `s2sToday`.
**See also:** s2sPeriod, dynamicS2sDaily, s2sToday

---

### S2S Color

**Type:** Enum
**Values:** `green`, `orange`, `red`
**Definition:** Display color for the S2S value. Computed per request.

| Color | Condition |
|-------|-----------|
| `red` | `s2sStatus == 'DEFICIT'` or `s2sStatus == 'OVERSPENT'` |
| `red` | `s2sDaily > 0` and `s2sToday / s2sDaily <= 0.3` (WARNING territory) |
| `orange` | `s2sDaily > 0` and `s2sToday / s2sDaily` in `(0.3, 0.7]` |
| `green` | Ratio `> 0.7`, or `s2sDaily = 0` with no deficit |

**Common confusion:** WARNING status maps to **red**, not orange. Orange only applies in the ratio range `(0.3, 0.7]`. Green applies when the user has substantial remaining headroom.
**See also:** S2S Status
**Formula ref:** `./formulas-and-calculation-policy.md` Step 14

---

### S2S Daily (Snapshot)

**Type:** Monetary amount (stored snapshot)
**Unit:** Kopecks (Int)
**DB field:** `Period.s2sDaily`
**Definition:** The `dynamicS2sDaily` value computed at period creation (or last recalculate), stored in the `Period` DB record. Equals `max(0, round(s2sPeriod / daysTotal))` at creation time, with `totalExpenses = 0`. Becomes stale immediately after the first expense is logged.

**Used only in:** completed period summary (`GET /tg/periods/last-completed`), new period notification, and the raw period object.
**NOT used by:** the live dashboard. The dashboard always computes `dynamicS2sDaily` fresh.
**See also:** dynamicS2sDaily
**Formula ref:** `./numerical-source-of-truth.md` §1.3

---

### S2S Period (s2sPeriod)

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**DB field:** `Period.s2sPeriod`
**Russian UI label:** "Бюджет периода"
**Definition:** The total safe-to-spend budget for the entire period. Computed by `calculateS2S` as `max(0, residual)`. Persisted at period creation and at each recalculate. Does not change as expenses are added.

`s2sPeriod` is the budget cap. To get the remaining balance: `max(0, s2sPeriod - totalPeriodSpent)`.
**See also:** residual, periodRemaining, dynamicS2sDaily
**Formula ref:** `./formulas-and-calculation-policy.md` Step 11

---

### S2S Status

**Type:** Enum
**Values:** `OK`, `WARNING`, `OVERSPENT`, `DEFICIT`
**API field:** `s2sStatus` in `GET /tg/dashboard`
**Definition:** The computed status for the current daily spending position.

| Status | Condition (dashboard) | Priority |
|--------|-----------------------|----------|
| `DEFICIT` | `s2sPeriod <= 0` | 1st (highest) |
| `OVERSPENT` | `todayTotal > dynamicS2sDaily` | 2nd |
| `WARNING` | `dynamicS2sDaily > 0` and `s2sToday / dynamicS2sDaily <= 0.3` | 3rd |
| `OK` | None of the above | Default |

**WARNING and OVERSPENT are mutually exclusive** (OVERSPENT takes priority). A user can receive WARNING without overspending today — if they spent 70–100% of `dynamicS2sDaily`.

**Common confusion:** WARNING maps to `s2sColor = 'red'` (not orange), because the WARNING threshold (≤ 0.3) equals the red color threshold.
**See also:** S2S Color, DEFICIT, OVERSPENT, WARNING
**Formula ref:** `./formulas-and-calculation-policy.md` Step 13

---

### S2S Today (s2sToday)

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**API field:** `s2sToday` in `GET /tg/dashboard`
**Russian UI label:** "Можно сегодня" (implied by dashboard header number)
**Definition:** The amount the user can still spend today without exceeding the daily limit. `max(0, dynamicS2sDaily - expensesToday)`. Always non-negative.

Never stored in DB. Derived on every API request.
**See also:** dynamicS2sDaily, expensesToday
**Formula ref:** `./formulas-and-calculation-policy.md` Step 12; `./numerical-source-of-truth.md` §1.1

---

### Today Total (expensesToday)

**Type:** Monetary amount
**Unit:** Kopecks (Int)
**API field:** `todayTotal` in `GET /tg/dashboard`
**Russian UI label:** "Потрачено сегодня"
**Definition:** The sum of all expense amounts with `spentAt >= today 00:00:00 UTC`. "Today" is UTC midnight — not the user's local midnight.

For Moscow users (+3): expenses logged between 00:00 and 02:59 MSK are in "yesterday UTC" and are NOT counted in `todayTotal`.

Never stored — aggregated live.
**See also:** s2sToday, dynamicS2sDaily
**Formula ref:** `./numerical-source-of-truth.md` §1.7

---

### Trigger Payday

**Type:** Day-of-month integer
**Unit:** Integer 1–31
**Definition:** The payday that caused the current period to begin. Derived at runtime from `periodEndDate.getDate()` and `allPaydays`. Income records with this payday in their `paydays[]` are selected for the period. Never stored in DB.

Derivation:
```
allPaydays  = sorted unique union of all inc.paydays
endDay      = periodEndDate.getDate()
endDayIdx   = allPaydays.indexOf(endDay)

if endDayIdx > 0:
  triggerPayday = allPaydays[endDayIdx - 1]
else:
  triggerPayday = allPaydays[allPaydays.length - 1]   // wrap-around
```

**Common confusion:** `triggerPayday` determines which income is counted, not when the period starts. The period start comes from `calculatePeriodBounds`. The trigger is the payday **before** the period-end payday in the sorted `allPaydays` list.
**See also:** Income, allPaydays, S2S Period
**Formula ref:** `./income-allocation-semantics.md` Section 4; `./formulas-and-calculation-policy.md` Step 2

---

### WARNING (Status)

**Type:** S2S status value
**Definition:** `s2sStatus = 'WARNING'` when `dynamicS2sDaily > 0` and `s2sToday / dynamicS2sDaily <= 0.3`. The user has used 70% or more of today's daily limit but has not yet exceeded it. `s2sColor = 'red'` (same as DEFICIT and OVERSPENT).

**Common confusion:** WARNING produces a **red** color, not orange. Orange is for the `(0.3, 0.7]` ratio range. The WARNING threshold (≤ 0.3) equals the red color threshold.
**See also:** S2S Status, S2S Color, OVERSPENT

---

## Deprecated and Ambiguous Terms

The following terms appear in informal usage, old comments, or early drafts. Do not use them in new code, UI copy, or documentation. Use the canonical term listed.

| Avoid | Use Instead | Reason |
|-------|-------------|--------|
| "daily limit" (unqualified) | `dynamicS2sDaily` or "daily limit (live)" | Ambiguous — does not distinguish live vs snapshot |
| "today available" | `s2sToday` | Unclear what "available" means |
| "balance" (unqualified) | "debt balance" (`Debt.balance`) or "periodRemaining" | Critically ambiguous — two different concepts |
| "left this period" | `periodRemaining` | Informal; does not distinguish from `daysLeft` |
| "budget" (unqualified) | `s2sPeriod` or `freePool` depending on context | Too vague |
| "daily budget" as a fixed value | `dynamicS2sDaily` + note that it changes with carry-over | Implies a fixed value |
| "available today" | `s2sToday` | Same as "today available" |
| "income per period" | `totalIncome` (engine output) | Use the variable name |
| "emergency fund balance" | `emergencyFund.currentAmount` | "Balance" is ambiguous |
| "how much I can spend" | `s2sToday` | Informal; for UI copy only, not docs/code |
| "rollover" (unqualified) | "period rollover" or "period end / new period creation" | Ambiguous with debt rollovers |
| "s2s limit" | `dynamicS2sDaily` | "Limit" is vague — daily? period? Use the variable name |
| "DEFICIT period" | "period with DEFICIT s2sStatus" | DEFICIT is not a Period.status value |
