# ADR-003: Safe-to-Spend (S2S) Formula

**Status**: Accepted
**Date**: 2025-12
**Author**: Dmitriy

## Context

The core value proposition of PFM Bot is a single number: "how much can I safely spend today?" This requires a formula that accounts for:

- Income received in the current period
- Fixed obligations (rent, utilities, subscriptions) that must be paid regardless
- Debt minimum payments
- Debt accelerated payoff (avalanche extra payments)
- Emergency fund building
- A safety buffer to avoid precision errors and surprise expenses
- Carry-over: if I underspent yesterday, today's limit should increase

A pure calendar-month approach ("income / 30") is too blunt — it ignores that paydays don't align with calendar months, and it doesn't adjust when the user has already spent part of the period.

## Decision

The S2S calculation is implemented as a pure function in `apps/api/src/engine.ts` (`calculateS2S`). The formula in two stages:

### Stage 1: Period budget (s2sPeriod)

```
afterFixed    = totalIncome - totalObligations - totalDebtPayments
reserve       = afterFixed * 0.10   (reduced to 5% or 0 if afterFixed is tight)
freePool      = afterFixed - reserve
efContribution = min(efDeficit / 12, freePool * 0.20)   (if EF not funded)
avalanchePool  = investPool * 0.50  (if focusDebt.apr >= 18%)
               | investPool * 0.25  (if focusDebt.apr < 18%)
               (investPool = freePool - efContribution; capped at focusDebt.balance)

s2sPeriod = totalIncome - totalObligations - totalDebtPayments
            - reserve - efContribution - avalanchePool
s2sPeriod = max(0, residual)
```

### Stage 2: Daily limit with carry-over

```
periodRemaining = s2sPeriod - totalExpensesInPeriod
s2sDaily        = max(0, round(periodRemaining / daysLeft))
s2sToday        = max(0, s2sDaily - todayExpenses)
```

`daysLeft` includes today: `max(1, daysTotal - daysElapsed + 1)`.

### Proration

When a period starts mid-period (user onboarded on day 8 of a 15-day period), obligations and debt payments are scaled:
```
totalObligations = round(totalObligations * (daysTotal / fullPeriodDays))
```

### Multi-payday income (trigger payday logic)

For users with two paydays (e.g., `[1, 15]`), the engine determines the "trigger payday" — which payday triggered the current period — and only counts income whose `paydays` array includes that trigger. This prevents double-counting two separate income records in a single period (see ADR details in the income split gap analysis).

```ts
// period ends April 1  → triggerPayday = 15 (received March 15)
// period ends April 15 → triggerPayday = 1  (received April 1)
const endDay = periodEndDate.getDate();
const endDayIdx = allPaydays.indexOf(endDay);
const triggerPayday = endDayIdx > 0
  ? allPaydays[endDayIdx - 1]
  : allPaydays[allPaydays.length - 1];
```

### Status thresholds

| Status | Condition |
|--------|-----------|
| `DEFICIT` | `residual < 0` (obligations exceed income) |
| `OVERSPENT` | `todayExpenses > s2sDaily` |
| `WARNING` | `s2sToday <= s2sDaily * 0.30` |
| `OK` | None of the above |

Color: `green` → OK, `orange` → WARNING (s2sToday/s2sDaily ≤ 0.7), `red` → OVERSPENT or DEFICIT.

### Numeric example

User profile:
- Income: 80 000 ₽/month (8 000 000 kopecks), payday = 15th
- Obligations: 20 000 ₽ (rent 15k + utilities 5k)
- Debts: credit card 50 000 ₽ balance, 21.9% APR, min payment 5 000 ₽/month
- EF: 0 ₽ current, target 3 months of obligations = 60 000 ₽
- Period: March 15 → April 15, 31 days, today = March 20 (day 6), 5 days elapsed

Calculation (all in kopecks):
```
totalIncome           = 8_000_000
totalObligations      = 2_000_000
totalDebtPayments     = 500_000
afterFixed            = 8_000_000 - 2_000_000 - 500_000 = 5_500_000
reserve (10%)         = 550_000
freePool              = 5_500_000 - 550_000 = 4_950_000
efDeficit             = 6_000_000 - 0 = 6_000_000
monthlyEFGoal         = 6_000_000 / 12 = 500_000
efContribution        = min(500_000, 4_950_000 * 0.20) = min(500_000, 990_000) = 500_000
investPool            = 4_950_000 - 500_000 = 4_450_000   (but EF not yet funded)
avalanchePool (EF not funded, APR=21.9% ≥ 18%) = round(4_450_000 * 0.30) = 1_335_000
  capped at balance:  min(1_335_000, 5_000_000) = 1_335_000

residual    = 8_000_000 - 2_000_000 - 500_000 - 550_000 - 500_000 - 1_335_000 = 3_115_000
s2sPeriod   = 3_115_000  (31 150 ₽ for the period)

daysLeft        = 31 - 6 + 1 = 26
periodRemaining = 3_115_000 - 0 (no expenses yet) = 3_115_000
s2sDaily        = round(3_115_000 / 26) = 119_808  (~1 198 ₽/day)
s2sToday        = 119_808 - 0 = 119_808

After spending 800 ₽ (80_000 kopecks) on lunch:
s2sToday = 119_808 - 80_000 = 39_808  (~398 ₽ remaining today)
```

## Consequences

### Positive
- **Adapts to actual spending**: Carry-over means saving yesterday increases tomorrow's limit, and overspending reduces it. Users are never "reset" to a fixed daily limit.
- **Pure function**: `calculateS2S` in `engine.ts` has no side effects. It's trivially testable with any input combination.
- **Holistic**: The formula accounts for savings goals (EF) and debt acceleration simultaneously, not just discretionary spending.

### Negative / Tradeoffs
- **Formula complexity**: Seven deduction layers (obligations, debt payments, reserve, EF, avalanche, residual, daily) are hard to explain to users.
- **Avalanche estimate is simplified**: `buildAvalanchePlan` simulates months sequentially with a fixed `monthlyExtra`, not accounting for APR-driven balance changes on non-focus debts during the wait period.
- **EF contribution paused but not reset**: When `efDeficit <= 0` (target met), the EF branch is skipped entirely. If the user later raises `targetMonths`, the deficit becomes positive again but the formula re-engages correctly — however there is no notification or UX prompt for this.
- **Reserve reduction is heuristic**: Reducing reserve from 10% to 5% when `afterFixed - reserve < 0` is a fallback heuristic, not a principled budget constraint.

### Open Questions
- Should "yesterday's savings" (periodRemaining increase from underspending) be displayed explicitly as a carry-over amount in the UI?
- Should the EF contribution be shown to the user as a separate "locked" budget line, or is silent deduction better UX?
- Should the avalanche pool size be user-configurable (e.g., "aggressive" vs "balanced" payoff mode)?

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| `income / daysInMonth` (fixed daily) | Ignores all obligations, debts, EF — not useful |
| Calendar-month budgets | Doesn't match payday-to-payday cash flow reality |
| Zero-based budgeting (every kopeck assigned) | Too complex for onboarding; requires category management |
| Envelope budgeting | Requires category setup; out of scope for MVP |
