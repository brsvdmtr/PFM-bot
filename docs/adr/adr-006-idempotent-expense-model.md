# ADR-006: Immutable Expense Model — No Edit, Delete as Correction

**Status**: Accepted
**Date**: 2025-12
**Author**: Dmitriy

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
- **No concurrent write conflicts**: Two simultaneous POSTs create two records. The user can see both and delete the duplicate. This is worse UX than silent dedup, but the model is consistent.
- **No stale data**: There is no concept of "the current state" of an expense — there is only the original creation.

### Negative / Tradeoffs
- **Double-submit creates duplicates**: If the Mini App's fetch times out and the user retries, two expense records are created. The user must notice the duplicate in today's list and delete one.
- **No edit**: Entering "5000" instead of "500" requires: delete the wrong record, re-enter 500. Two taps instead of one.
- **Mobile UX expectation mismatch**: Users of banking apps expect to edit transactions. PFM Bot's delete-only model may feel primitive.
- **No idempotency key on the roadmap**: This was explicitly deferred as a TODO (`// TODO: idempotency key in header`) and not yet implemented.

### Open Questions
- Should the Mini App implement client-side dedup by disabling the submit button for 2 seconds after a successful POST?
- Should `POST /tg/expenses` accept an optional `clientId` field and deduplicate within a 30-second window?

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| Idempotency-Key header + server-side dedup store | Adds Redis or DB table for key storage; deferred to future iteration |
| Upsert by `spentAt` timestamp | `spentAt` is server-generated (`now()`); two rapid POSTs get different timestamps, so upsert key would always be unique anyway |
| `PATCH /expenses/:id` edit endpoint | Adds `updatedAt` audit complexity; immutable model simpler for MVP |
| Soft delete (`isDeleted` flag) | Adds query complexity everywhere; hard delete is simpler for financial records that users explicitly chose to remove |
