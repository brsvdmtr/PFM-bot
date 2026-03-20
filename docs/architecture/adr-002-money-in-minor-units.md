---
title: "ADR-002: All Monetary Values Stored as Int in Minor Units (Kopecks)"
document_type: ADR
status: Accepted
source_of_truth: NO
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./ARCHITECTURE.md
    relation: "parent document"
  - path: ../system/formulas-and-calculation-policy.md
    relation: "formula implementation"
---

# ADR-002: All Monetary Values Stored as Int in Minor Units (Kopecks)

## Status

Accepted

## Context

PFM Bot performs arithmetic on monetary values throughout the calculation pipeline: income splits, obligation proration, debt minimum payments, reserve computation, and EF contributions. These calculations involve division and multiplication across potentially large values (a Moscow salary of 100 000 ₽ = 10 000 000 kopecks).

Three storage strategies were evaluated:

- **Float**: JavaScript's `number` is IEEE 754 double-precision. Classic example: `0.1 + 0.2 === 0.30000000000000004`. Unacceptable for financial display.
- **Decimal/Numeric (PostgreSQL)**: Arbitrary precision, no float error. Requires a Decimal library in JavaScript (e.g. `decimal.js`), adds a dependency, and Prisma's `Decimal` type requires explicit casting at every read/write boundary.
- **Int in minor units (kopecks)**: Store `10050000` for 100 500 ₽. All arithmetic is integer arithmetic. No precision bugs possible.

The Russian ruble's smallest unit is the kopeck (1/100 of a ruble). The US dollar equivalent is cents. No sub-kopeck precision is ever needed.

## Decision

All monetary fields in the Prisma schema are `Int`, representing the value in **kopecks** (or cents for USD). Examples:

- `Income.amount: Int` — monthly income. 75 000 ₽ → stored as `7500000`
- `Obligation.amount: Int` — monthly obligation. 12 000 ₽ → stored as `1200000`
- `Debt.balance: Int`, `Debt.minPayment: Int`
- `Period.s2sPeriod: Int`, `Period.s2sDaily: Int`
- `Expense.amount: Int`
- `EmergencyFund.currentAmount: Int`
- `Subscription.starsPrice: Int` (Telegram Stars are already integer units)

Division in the engine (`engine.ts`) uses `Math.round()` at every boundary:

```ts
const payCount = Math.max(1, inc.paydays.length);
return sum + Math.round(inc.amount / payCount);
```

The UI layer (`apps/web`) divides by 100 before display and multiplies by 100 before sending to the API:

```ts
// Display: 7500000 → "75 000 ₽"
(amount / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

// Input: "75000" → 7500000
Math.round(parseFloat(input) * 100)
```

The bot (`apps/bot`) does the same:

```ts
const amountKop = Math.round(amount * 100); // /spend 500 → 50000
```

## Consequences

### Positive

- **No floating-point bugs**: All arithmetic in `engine.ts` and `avalanche.ts` is integer. `Math.round()` at division boundaries means at most ±1 kopeck rounding error per operation, which is acceptable.
- **No external library dependency**: No `decimal.js`, no `big.js`.
- **Fast comparisons**: Integer equality checks for zero-balance detection, overspend detection, etc. are exact.
- **Consistent across services**: Both `api` and `bot` use the same unit; the Prisma client returns plain `number` (JS) in both.

### Negative / Trade-offs

- **UI layer must always divide by 100**: If any client-side code forgets this, it will display values 100x too large. This has caused display bugs in the past (e.g., showing "1,500,000 ₽" instead of "15,000 ₽").
- **Input layer must always multiply by 100**: User types "500" → must send `50000` to API. Decimal input (e.g., "499.99") must be multiplied: `Math.round(499.99 * 100) = 49999`.
- **Large numbers / Int overflow risk**: 1 000 000 ₽ = 100 000 000 kopecks. PostgreSQL `Int` (32-bit signed) caps at 2 147 483 647 ≈ 21 million rubles. Mortgage balances over 21M ₽ would overflow. This is a known future risk — large mortgage balances may need `BigInt`.

## Implementation Status

Implemented and enforced across all services. The schema uses `Int` for all monetary fields. The engine uses `Math.round()` at every division boundary.

The 21M ₽ Int ceiling is a documented limitation (see also Section 9 of ARCHITECTURE.md). No overflow handling exists today.

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — known limitations section
- [../system/formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md) — canonical formula reference
