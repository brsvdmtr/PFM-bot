---
title: "ADR-003: Safe-to-Spend (S2S) Formula"
document_type: ADR
status: Accepted
source_of_truth: NO
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./ARCHITECTURE.md
    relation: "parent document"
  - path: ../system/formulas-and-calculation-policy.md
    relation: "canonical formula source of truth"
---

# ADR-003: Safe-to-Spend (S2S) Formula

## Status

Accepted

## Context

The core value proposition of PFM Bot is a single number: "how much can I safely spend today?" This requires a formula that accounts for:

- Income received in the current period
- Fixed obligations (rent, utilities, subscriptions) that must be paid regardless
- Debt minimum payments
- Debt accelerated payoff (avalanche extra payments)
- Emergency fund building
- A safety buffer to avoid surprise expenses
- Carry-over: if I underspent yesterday, today's limit should increase; overspending reduces it

A pure calendar-month approach ("income / 30") is too blunt — it ignores that paydays don't align with calendar months, and it doesn't adjust when the user has already spent part of the period.

## Decision

The S2S calculation is implemented as a pure function `calculateS2S` in `apps/api/src/engine.ts`. The formula operates in two stages:

### Stage 1: Period budget (s2sPeriod)

```
afterFixed    = totalIncome - totalObligations - totalDebtPayments
reserve       = afterFixed × 10%   (reduced to 5% or 0% if afterFixed is tight)
freePool      = afterFixed - reserve
efContrib     = min(efDeficit / 12, freePool × 20%)   [if EF target not met]
investPool    = freePool - efContrib
avalanchePool = investPool × 30%   [EF not funded, APR ≥ 18%]
              | investPool × 50%   [EF funded, APR ≥ 18%]
              | investPool × 25%   [EF funded, APR < 18%]
              capped at focusDebt.balance

s2sPeriod = max(0, totalIncome - totalObligations - totalDebtPayments
                   - reserve - efContrib - avalanchePool)
```

### Stage 2: Daily limit with carry-over

```
periodRemaining = s2sPeriod - totalExpensesInPeriod
daysLeft        = max(1, daysTotal - daysElapsed + 1)   (includes today)
s2sDaily        = max(0, round(periodRemaining / daysLeft))
s2sToday        = max(0, s2sDaily - todayExpenses)
```

Carry-over is automatic: every day's limit is recalculated from the remaining period budget divided by remaining days. Underspending yesterday increases today's limit implicitly.

### Proration (mid-period onboarding)

When a user onboards mid-period (e.g., joins on day 8 of a 15-day period), obligations and debt payments are scaled proportionally:

```
totalObligations = round(totalObligations × (daysTotal / fullPeriodDays))
```

### Multi-payday income (trigger payday logic)

For users with two paydays (e.g., `[1, 15]`), the engine determines which payday triggered the current period and counts only income whose `paydays` array includes that trigger. This prevents double-counting income sources across sub-periods:

```ts
const endDay = periodEndDate.getDate();
const endDayIdx = allPaydays.indexOf(endDay);
const triggerPayday = endDayIdx > 0
  ? allPaydays[endDayIdx - 1]
  : allPaydays[allPaydays.length - 1];
```

### Status thresholds

| Status | Condition |
|--------|-----------|
| `DEFICIT` | `residual < 0` — obligations exceed income |
| `OVERSPENT` | `todayExpenses > s2sDaily` |
| `WARNING` | `s2sToday <= s2sDaily × 0.30` |
| `OK` | None of the above |

UI color: green → OK, orange → WARNING (s2sToday/s2sDaily ≤ 0.7), red → OVERSPENT or DEFICIT.

## Consequences

### Positive

- **Adapts to actual spending**: Carry-over means saving yesterday increases tomorrow's limit, and overspending reduces it. Users are never "reset" to a fixed daily limit.
- **Pure function**: `calculateS2S` has no side effects. It is testable with any input combination.
- **Holistic**: The formula accounts for savings goals (EF) and debt acceleration simultaneously, not just discretionary spending.

### Negative / Trade-offs

- **Formula complexity**: Seven deduction layers (obligations, debt payments, reserve, EF, avalanche, residual, daily) are hard to explain to users.
- **Avalanche estimate is simplified**: `buildAvalanchePlan` simulates months sequentially with a fixed `monthlyExtra`, not accounting for APR-driven balance changes on non-focus debts during the wait period.
- **Reserve reduction is heuristic**: Reducing reserve from 10% to 5% when `afterFixed - reserve < 0` is a fallback heuristic, not a principled budget constraint.
- **EF contribution pauses silently**: When `efDeficit <= 0` (target met), the EF branch is skipped with no UX notification.

## Implementation Status

Implemented and in production. The formula runs in `apps/api/src/engine.ts` (`calculateS2S`). The canonical formula specification (with exact pseudocode and rounding rules) lives in [../system/formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md) — that file is the source of truth for calculations, not this ADR.

## Related

- [../system/formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md) — canonical formula source of truth
- [ADR-004](./adr-004-debt-avalanche.md) — avalanche pool allocation
- [ADR-002](./adr-002-money-in-minor-units.md) — minor units for all monetary values
