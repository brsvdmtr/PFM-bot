# ADR-004: Debt Repayment via Avalanche Method (Highest APR First)

**Status**: Accepted
**Date**: 2025-12
**Author**: Dmitriy

## Context

Users of PFM Bot may carry multiple debts simultaneously: credit cards (18–30% APR), personal loans (12–20% APR), car loans (8–15% APR), mortgages (5–12% APR). A strategy is needed to determine:

1. Which debt to prioritize with extra payments beyond minimums ("focus debt")
2. How to estimate payoff timeline for the UI

Two well-known strategies exist:

**Snowball** (Dave Ramsey): Pay off smallest balance first regardless of APR. The psychological win from closing a debt account motivates continued repayment.

**Avalanche**: Pay off highest APR first. Minimizes total interest paid over the lifetime of all debts.

A third option — **equal split** — distributes extra cash equally across all debts, which is mathematically suboptimal in all cases.

## Decision

PFM Bot uses **avalanche**: the debt with the highest APR is designated `isFocusDebt = true` and receives the extra payment pool in addition to its minimum payment.

**Tie-breaking rule**: When two debts share the same APR, the one with the smaller balance is prioritized first (pays it off faster, freeing minimum payment for the next debt sooner).

Implemented in `apps/api/src/avalanche.ts`:

```ts
const sorted = [...active].sort((a, b) => {
  if (b.apr !== a.apr) return b.apr - a.apr;
  return a.balance - b.balance; // smaller balance on equal APR
});
```

The focus debt is determined at:
- Onboarding step 3: debts submitted sorted by APR desc, first one gets `isFocusDebt: true`
- Debt deletion (`DELETE /tg/debts/:id`): if focus debt is deleted, `determineFocusDebt()` reassigns to the next highest APR
- Payment completion (`POST /tg/debts/:id/payment`): when `newBalance === 0`, focus is reassigned to next

### Extra payment pool allocation

The avalanche extra payment pool is computed in `engine.ts`. It comes from the `investPool` (free cash after obligations, debt minimums, reserve, and EF). The allocation rate depends on whether the EF is funded:

- **EF not funded, focus debt APR ≥ 18%**: 30% of investPool to avalanche
- **EF funded, focus debt APR ≥ 18%**: 50% of investPool to avalanche
- **EF funded, focus debt APR < 18%**: 25% of investPool to avalanche

The pool is capped at `focusDebt.balance` to avoid overshooting.

### Plan estimation

`buildAvalanchePlan()` simulates payoff month by month:

```ts
while (balance > 0 && months < 600) {
  const monthInterest = Math.round(balance * monthlyRate);
  balance = balance + monthInterest - payment;
  months++;
}
```

After the focus debt is paid off, its freed minimum payment is added to `rollingExtra` for the next debt — the classic avalanche "snowball-of-freed-payments" effect.

### Example

Debts:
- Credit card: 50 000 ₽ balance, 21.9% APR, min payment 5 000 ₽/month → **Focus**
- Car loan: 200 000 ₽ balance, 12.0% APR, min payment 8 000 ₽/month → 2nd
- Personal loan: 30 000 ₽ balance, 15.0% APR, min payment 3 000 ₽/month → 3rd

Sort order: 21.9% → 15.0% → 12.0%

With monthlyExtra = 3 000 ₽:
- Credit card: payment = 5 000 + 3 000 = 8 000 ₽/month
  - Estimated payoff: ~7 months, total interest ~4 200 ₽
- Personal loan: payment = 3 000 + (freed 5 000 + 3 000) = 11 000 ₽/month
  - Estimated payoff: ~3 months after credit card
- Car loan: payment = 8 000 + (freed 3 000 + 11 000) = 22 000 ₽/month
  - Estimated payoff: ~10 months after personal loan

Total debt-free: ~20 months. Snowball would take ~22 months with ~6 000 ₽ more total interest.

## Consequences

### Positive
- **Mathematically optimal**: Minimizes total interest paid. For a 21.9% APR credit card, every month of delay costs ~1.8% of remaining balance in interest.
- **Simple to explain**: "Pay the most expensive debt first" is intuitive to financially-aware users.
- **Automatic focus reassignment**: When a debt is paid off or deleted, the system automatically selects the next focus debt — no user action needed.

### Negative / Tradeoffs
- **Psychologically harder for some users**: A large high-APR debt (e.g., mortgage at 10% with 3 000 000 ₽ balance) may never visibly shrink. Users accustomed to snowball may disengage.
- **Simplified APR simulation**: `buildAvalanchePlan()` uses a fixed APR for the entire simulation. In reality, credit card APR can change, variable-rate loans fluctuate. The estimate can be off by 10–20% for variable-rate debts.
- **No mixed strategy**: Users cannot configure "pay off the credit card snowball-style for psychological win, then switch to avalanche." The strategy is global.
- **Pool estimate uses 10% of s2sPeriod as proxy**: `GET /tg/debts/avalanche-plan` estimates `monthlyExtra` as `s2sPeriod * 0.10 / (daysTotal / 30)`. This is a rough proxy, not the actual avalanchePool from the S2S engine.

### Open Questions
- Should the user be able to choose between avalanche and snowball in settings?
- Should `buildAvalanchePlan` receive the actual `avalanchePool` value from the engine rather than a 10% proxy?

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| Snowball (smallest balance first) | ~6–15% more total interest paid; mathematically suboptimal |
| Equal split across all debts | Always worse than avalanche or snowball |
| User-configurable per-debt priority | Adds UX complexity; most users benefit from default avalanche |
| Debt consolidation advice | Out of scope — requires financial advisory licensing |
