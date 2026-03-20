---
title: "Technical Debt Register"
document_type: Gap-Audit
status: Active
source_of_truth: YES — for all known technical debt and gap tracking
verified_against_code: Partial
last_updated: "2026-03-20"
---

# Technical Debt Register

**Project**: PFM Bot
**Last updated**: 2026-03-20

## Legend

- **Type**: tech-debt / gap / security / ops
- **Severity**: P0 = fix now, P1 = fix soon, P2 = fix eventually, P3 = known tradeoff / low urgency
- **Trust-Critical**: Yes = could cause wrong financial numbers shown to user
- **Blocks Release**: Yes = must fix before next release of affected area
- **Status**: open / in-progress / fixed

---

## Top 5 Trust-Critical Debts

Items that could cause wrong financial numbers to be shown to a user, or create legal/trust risk.

1. **GAP-003 / TD-009**: Notification dedup is in-memory, lost on restart → user gets double notification on API restart during notification window
2. **TD-001**: No rate limiting → service availability can be affected; malicious actor can flood expense creation
3. **GAP-008 / TD-007**: /delete user data not implemented → legal risk, GDPR right to erasure not supported
4. **GAP-001 / TD-011**: Trigger payday not persisted → if user changes paydays mid-period, current period's trigger recomputes retroactively, producing wrong s2sToday
5. **GAP-004 / TD-003**: Period rollover UTC timing offset → period starts at wrong local time for non-UTC users

---

## Full Register

### TD-001: No rate limiting on API

| Field | Value |
|-------|-------|
| ID | TD-001 |
| Type | security |
| Severity | P1 |
| Status | open |
| Trust-critical | No |
| Blocks release | No |
| Debt type | missing-feature |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

Any user or bot can flood `POST /tg/expenses` or spam `/tg/dashboard`, causing DB overload. Fix: add `express-rate-limit` middleware per userId at ~60 req/min on `/tg/*`.

---

### TD-003: Period rollover at 00:05 UTC, not user's local midnight

| Field | Value |
|-------|-------|
| ID | TD-003 |
| Type | tech-debt |
| Severity | P2 |
| Status | open |
| Trust-critical | Yes |
| Blocks release | No |
| Debt type | wrong-behavior |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

Previously tracked as GAP-004. Users in UTC+5 to UTC+12 have mid-morning rollovers. Expenses before rollover may land in wrong period. Requires per-user rollover scheduling in `apps/api/src/cron.ts`.

---

### TD-005: prisma db push vs migrate deploy in production

| Field | Value |
|-------|-------|
| ID | TD-005 |
| Type | ops |
| Severity | P2 |
| Status | open |
| Trust-critical | No |
| Blocks release | No |
| Debt type | ops |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

Verify that production Dockerfile uses `prisma migrate deploy` (not `prisma db push`). The `db push` command is destructive in production — it skips migration history. Check `Dockerfile.api` and `docker-compose.yml` entrypoint.

---

### TD-007: /delete user data command not implemented

| Field | Value |
|-------|-------|
| ID | TD-007 |
| Type | gap / security |
| Severity | P1 |
| Status | open |
| Trust-critical | No |
| Blocks release | No |
| Debt type | missing-feature |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

Also tracked as GAP-008. Users cannot delete their account. GDPR right to erasure not supported. Implement `/delete` bot command + `DELETE /tg/me` API endpoint with Prisma cascade. Workaround: manual deletion by administrator upon written request.

---

### TD-008: s2sActual could be negative in DailySnapshot

| Field | Value |
|-------|-------|
| ID | TD-008 |
| Type | tech-debt |
| Severity | P2 |
| Status | fixed |
| Trust-critical | Yes |
| Blocks release | No |
| Debt type | wrong-behavior |
| Owner | — |
| Target date | — |
| Dependency | none |
| Fixed in | 2026-03-20 |

`s2sActual` was not floored at 0 in DailySnapshot. Fixed — now clamped to non-negative.

---

### TD-009: Notification dedup is in-memory, lost on restart

| Field | Value |
|-------|-------|
| ID | TD-009 |
| Type | gap |
| Severity | P1 |
| Status | open |
| Trust-critical | No |
| Blocks release | No |
| Debt type | missing-feature |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

Also tracked as GAP-003. API restart at notification time → double notification send. Fix: move dedup to `NotificationLog` DB table with `userId + type + date` unique constraint.

---

### GAP-001: Trigger payday not persisted in Period

| Field | Value |
|-------|-------|
| ID | GAP-001 |
| Type | gap |
| Severity | P1 |
| Status | open |
| Trust-critical | Yes |
| Blocks release | No |
| Debt type | missing-feature |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

`triggerPayday` is recomputed at runtime from current income paydays. If user changes paydays mid-period, current period's trigger changes retroactively → wrong `s2sToday`. Fix: add `triggerPayday Int?` to `Period` table; persist at period creation time.

---

### GAP-003: Notification dedup lost on container restart

See TD-009 above.

---

### GAP-004: Period rollover UTC timing offset

See TD-003 above.

---

### GAP-007: EF contribution not resuming after target change

| Field | Value |
|-------|-------|
| ID | GAP-007 |
| Type | gap |
| Severity | P2 |
| Status | open |
| Trust-critical | No |
| Blocks release | No |
| Debt type | wrong-behavior |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

No UI prompt when daily limit decreases due to new EF target. User is surprised by lower `s2sToday`. Fix: add recalculate trigger on EF settings save; notify user of limit change.

---

### GAP-008: /delete user data not implemented

See TD-007 above.

---

### GAP-012: s2sDaily snapshot vs dynamic value divergence

| Field | Value |
|-------|-------|
| ID | GAP-012 |
| Type | gap |
| Severity | P2 |
| Status | open |
| Trust-critical | No |
| Blocks release | No |
| Debt type | wrong-behavior |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

`Period.s2sDaily` is stored at period creation. The live dashboard recalculates `dynamicS2sDaily = (s2sPeriod - totalSpent) / daysLeft`. These diverge after the first expense. The DailySnapshot stores the static `s2sDaily`, not the dynamic value. By design but creates user confusion when they compare DailySnapshot history to live dashboard value.

---

### GAP-013: emergencyFund.targetAmount computed from current obligations

| Field | Value |
|-------|-------|
| ID | GAP-013 |
| Type | gap |
| Severity | P2 |
| Status | open |
| Trust-critical | No |
| Blocks release | No |
| Debt type | wrong-behavior |
| Owner | (unassigned) |
| Target date | — |
| Dependency | none |
| Fixed in | N/A |

EF `targetAmount` is computed from the current period's total obligations. If obligations change, the target shifts. User may reach "target" before they actually have enough. No versioning of EF targets.

---

## Closed Items

| ID | Title | Resolution | Closed |
|----|-------|------------|--------|
| TD-C001 | Cron rollover used incomes[0] for prorate | Fixed — now prorates each income individually by period length | 2026-03-20 |
| TD-C002 | CORS open (no origin restriction) | Fixed — restricted to `https://mytodaylimit.ru` origin | 2026-03-20 |
| TD-C003 | No auth_date freshness check on initData | Fixed — added 1h TTL check on `auth_date` field | 2026-03-20 |
| GAP-011 | Duplicate incomes on onboarding re-run | Fixed — dedup check added on onboarding re-entry | 2026-03-20 |
| TD-008 | s2sActual could be negative in DailySnapshot | Fixed — clamped to non-negative | 2026-03-20 |
| TD-009-OLD | daysLeft formula diverged between engine/dashboard/cron | Fixed — unified formula | 2026-03-20 |
