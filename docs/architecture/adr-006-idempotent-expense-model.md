---
title: "ADR-006: Immutable Expense Model — No Edit, Delete as Correction"
document_type: ADR
status: Accepted
source_of_truth: NO
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./ARCHITECTURE.md
    relation: "parent document"
  - path: ./adr-003-s2s-formula.md
    relation: "expenses feed the S2S carry-over calculation"
---

# ADR-006: Immutable Expense Model — No Edit, Delete as Correction

## Status

Accepted

## Context

When a user records an expense, two failure modes are possible:

1. **Double-submit**: The user taps "Add" twice due to slow network, or the Mini App sends the POST twice. Both requests succeed, creating duplicate records.
2. **Wrong amount**: The user entered 5 000 ₽ instead of 500 ₽. They need to fix it.

The standard approaches are:

- **Idempotency key**: Client sends a unique request ID in a header (e.g., `Idempotency-Key: uuid`). The server stores the key and returns the same response for duplicate requests.
- **Upsert by timestamp**: If an expense at the same `spentAt` timestamp already exists for this user, update it rather than create a new one.
- **Full CRUD with edit endpoint**: Allow `PATCH /expenses/:id` to correct amount or note.

## Decision

**No idempotency key, no upsert, no edit endpoint.** Each `POST /tg/expenses` unconditionally creates a new record:

```ts
const expense = await prisma.expense.create({
  data: {
    userId,
    periodId: activePeriod.id,
    amount: Math.round(amount),
    note: note || null,
    currency: activePeriod.currency,
    // spentAt defaults to now() via Prisma schema
  },
});
```

**Delete is the only correction mechanism.** `DELETE /tg/expenses/:id` permanently removes the record. The Mini App displays today's expenses as a list; the user taps to delete a wrong entry and re-enters the correct amount.

The `spentAt` field (`DateTime @default(now())`) is set server-side at creation time. The `Expense` model has no `updatedAt` field by design — records are immutable after creation.

The `source` field (`ExpenseSource: MANUAL | IMPORT`) is present in the schema for future import functionality, but IMPORT source expenses would follow the same immutable model.

## Consequences

### Positive

- **Maximum simplicity**: The expense write path is a single `prisma.create()`. No dedup logic, no key storage, no conflict resolution.
- **Audit trail integrity**: Every expense record represents a real creation event. The `spentAt` timestamp is reliable — it cannot be back-dated or modified after the fact.
- **No concurrent write conflicts**: Two simultaneous POSTs create two records. The user can see both and delete the duplicate.
- **No stale data**: There is no concept of "the current state" of an expense — there is only the original creation.

### Negative / Trade-offs

- **Double-submit creates duplicates**: If the Mini App's fetch times out and the user retries, two expense records are created. The user must notice the duplicate in today's list and delete one.
- **No edit**: Entering "5000" instead of "500" requires deleting the wrong record and re-entering. Two taps instead of one.
- **Mobile UX expectation mismatch**: Users of banking apps expect to edit transactions. Delete-only may feel primitive.
- **No idempotency key on the roadmap**: This was explicitly deferred as a TODO in the codebase (`// TODO: idempotency key in header`) and not yet implemented.

## Implementation Status

Implemented and in production. `POST /tg/expenses` creates without dedup. `DELETE /tg/expenses/:id` hard-deletes. There is no `PATCH /tg/expenses/:id` endpoint.

The idempotency key mechanism remains a future improvement. Client-side double-submit protection (disabling the submit button for a short window after a successful POST) is the current mitigation in the UI.

## Related

- [ADR-003](./adr-003-s2s-formula.md) — expenses feed the S2S carry-over recalculation
- [ADR-002](./adr-002-money-in-minor-units.md) — amounts stored as kopecks
