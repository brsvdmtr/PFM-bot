---
title: "ADR-004: Debt Repayment via Avalanche Method (Highest APR First)"
document_type: ADR
status: Accepted
source_of_truth: NO
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./ARCHITECTURE.md
    relation: "parent document"
  - path: ./adr-003-s2s-formula.md
    relation: "avalanche pool is computed in the S2S formula"
---

# ADR-004: Debt Repayment via Avalanche Method (Highest APR First)

## Status

Accepted

## Context

Users of PFM Bot may carry multiple debts simultaneously: credit cards (18–30% APR), personal loans (12–20% APR), car loans (8–15% APR), mortgages (5–12% APR). A strategy is needed to determine:

1. Which debt to prioritize with extra payments beyond minimums (the "focus debt")
2. How to estimate the payoff timeline for the UI

Two well-known strategies exist:

**Snowball** (Dave Ramsey): Pay off smallest balance first regardless of APR. The psychological win from closing a debt account motivates continued repayment.

**Avalanche**: Pay off highest APR first. Minimizes total interest paid over the lifetime of all debts.

A third option — **equal split** — distributes extra cash equally across all debts, which is mathematically suboptimal in all cases.

## Decision

PFM Bot uses **avalanche**: the debt with the highest APR is designated `isFocusDebt = true` and receives the extra payment pool in addition to its minimum payment.

**Tie-breaking rule**: When two debts share the same APR, the one with the smaller balance is prioritized first (pays it off faster, freeing its minimum payment for the next debt sooner).

Implemented in `apps/api/src/avalanche.ts`:

```ts
const sorted = [...active].sort((a, b) => {
  if (b.apr !== a.apr) return b.apr - a.apr;
  return a.balance - b.balance; // smaller balance on equal APR
});
```

`isFocusDebt` is reassigned automatically at three trigger points:

- **Onboarding** (step 3): debts submitted, sorted by APR desc; first one gets `isFocusDebt: true`
- **Debt deletion** (`DELETE /tg/debts/:id`): if focus debt is deleted, `determineFocusDebt()` reassigns to next highest APR
- **Payment completion** (`POST /tg/debts/:id/payment`): when `newBalance === 0`, focus reassigns to next

### Extra payment pool allocation

The avalanche pool comes from the `investPool` (free cash after obligations, minimums, reserve, and EF), computed in `engine.ts`:

| Condition | Pool rate |
|-----------|-----------|
| EF not funded, focus APR ≥ 18% | 30% of investPool |
| EF funded, focus APR ≥ 18% | 50% of investPool |
| EF funded, focus APR < 18% | 25% of investPool |

The pool is capped at `focusDebt.balance` to avoid overshooting.

### Plan estimation

`buildAvalanchePlan()` in `avalanche.ts` simulates payoff month by month:

```ts
while (balance > 0 && months < 600) {
  const monthInterest = Math.round(balance * monthlyRate);
  balance = balance + monthInterest - payment;
  months++;
}
```

After the focus debt is paid off, its freed minimum payment is added to `rollingExtra` for the next debt — the classic avalanche "snowball-of-freed-payments" effect.

## Consequences

### Positive

- **Mathematically optimal**: Minimizes total interest paid. For a 21.9% APR credit card, every month of delay costs ~1.8% of remaining balance in interest.
- **Simple to explain**: "Pay the most expensive debt first" is intuitive to financially-aware users.
- **Automatic focus reassignment**: When a debt is paid off or deleted, the system automatically selects the next focus debt — no user action needed.

### Negative / Trade-offs

- **Psychologically harder for some users**: A large high-APR debt (e.g., a mortgage) may never visibly shrink, which can demotivate users accustomed to snowball.
- **Simplified APR simulation**: `buildAvalanchePlan()` uses a fixed APR for the entire simulation. Variable-rate debt estimates can be off by 10–20%.
- **No mixed strategy**: Users cannot configure per-debt priority. The strategy is global. Snowball is a planned v2/PRO feature.
- **Plan estimation uses a proxy for monthlyExtra**: `GET /tg/debts/avalanche-plan` estimates `monthlyExtra` as `s2sPeriod × 10% / (daysTotal / 30)`. This is a rough proxy, not the actual `avalanchePool` from the S2S engine.

## Implementation Status

Implemented and in production. `isFocusDebt` flag is set on the `Debt` model. `determineFocusDebt()` in `avalanche.ts` handles all reassignment logic.

The avalanche pool calculation is part of the S2S engine (`engine.ts`). The plan estimation endpoint uses a simplified proxy rather than the exact engine output — this is a known approximation.

## Related

- [ADR-003](./adr-003-s2s-formula.md) — S2S formula, including avalanche pool computation
- [../system/formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md) — canonical formula reference
