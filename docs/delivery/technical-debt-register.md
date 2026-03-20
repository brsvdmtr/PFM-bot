---
title: "Technical Debt Register"
document_type: Gap/Audit
status: Active
source_of_truth: "YES — for all known technical debt and gap tracking"
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - ../ops/production-checklist.md
  - ../ops/release-rules.md
  - bug-report-template.md
  - logic-issue-template.md
---

# Technical Debt Register

**Project**: PFM Bot
**Last updated**: 2026-03-20

## Legend

- **Debt Type**: security / correctness / ops / UX / analytics / architecture
- **Impact**: What breaks or degrades if this is not addressed
- **Effort**: S = hours, M = 1–3 days, L = 1+ week
- **Priority**: P0 = fix now, P1 = fix soon, P2 = fix eventually, P3 = known tradeoff / low urgency
- **Trust-Critical**: Yes = could cause wrong financial numbers shown to user
- **Blocks Release**: Yes = must fix before next release of affected area
- **Status**: Open / In Progress / Done / Closed

---

## Top 5 Trust-Critical Debts

Items marked Trust-Critical = Yes that could cause wrong financial numbers to be shown to a user.

1. **TD-011**: `triggerPayday` not persisted — recomputed at runtime. If user changes paydays mid-period, current period's trigger changes retroactively, producing wrong s2sToday.
2. **TD-015**: `avalanchePool` not zero-checked before `min()` with `focusDebt.balance`. Negative `investPool` inflates `s2sPeriod`. Currently harmless if budget is non-negative, but fragile.
3. **TD-021**: EF target uses full monthly obligations even in prorated periods — contributions are over-calculated for users who onboard mid-period.
4. **TD-010** (renamed): EF contribution not resumed when `targetMonths` increases — no UI prompt. User sees unexplained drop in daily limit. *(No wrong number shown, but trust impact via surprise.)*
5. **TD-017**: `GET /tg/expenses/today` uses UTC midnight, not user's local midnight. Moscow users' expenses 00:00–02:59 local time appear as "yesterday" in today's S2S calc.

---

## Full Register

| ID | Title | Debt Type | Area | Impact | Effort | Priority | Trust-Critical | Blocks Release | Owner | Status | Notes |
|----|-------|-----------|------|--------|--------|----------|----------------|----------------|-------|--------|-------|
| TD-001 | No rate limiting on API | security | API | Any user or bot can flood POST /tg/expenses or spam /tg/dashboard, causing DB overload | S | P1 | No | No | Dmitriy | Open | Add `express-rate-limit` middleware per `userId` extracted from initData |
| TD-002 | Avalanche estimate ignores APR changes over time | correctness | Formula | `buildAvalanchePlan()` uses fixed APR. Variable-rate debts may be off by 10–20%. | M | P2 | No | No | Dmitriy | Open | `apps/api/src/avalanche.ts` line 106; needs APR schedule input |
| TD-003 | Period rollover at 00:05 UTC, not user's local midnight | correctness | Cron | Users in UTC+5 to UTC+12 have mid-morning rollovers. Expenses before rollover may land in wrong period. | L | P2 | Yes | No | Dmitriy | Open | `apps/api/src/cron.ts`; requires per-user rollover scheduling |
| TD-004 | DailySnapshot saved at 23:55 UTC, not per-user timezone | correctness | Cron | For Vladivostok (UTC+10) snapshot is 09:55 AM — mid-day, not end-of-day. `isOverspent` flag misleading for eastern timezones. | M | P2 | No | No | Dmitriy | Open | `apps/api/src/cron.ts` line 156; run per-user snapshot at 23:55 local time |
| TD-005 | No idempotency key for expense creation | UX | API | Slow network + retry creates duplicate expense records. User must notice and manually delete. | S | P1 | No | No | Dmitriy | Open | Add `Idempotency-Key` header handling in `POST /tg/expenses`; 60s TTL |
| TD-006 | GOD_MODE grants full access with no audit log | security | API | No `AdminAuditLog`. No record of which god-mode user accessed or modified what. | M | P2 | No | No | Dmitriy | Open | `apps/api/src/index.ts` `ensureUser`; add audit middleware for god-mode requests |
| TD-007 | /delete user data command not implemented | UX | Bot | Users cannot delete their account (GDPR right to erasure). | M | P1 | No | No | Dmitriy | Open | Implement `/delete` in bot; call `DELETE /tg/me` API; cascade via Prisma |
| TD-008 | No import/export of expenses | UX | API | Users cannot export CSV or import from bank statements. `ExpenseSource.IMPORT` enum exists but unused. | L | P3 | No | No | Dmitriy | Open | Out of scope for MVP |
| TD-009 | Notification dedup is in-memory, lost on restart | ops | Cron | API restart at notification time → double notification send. | S | P1 | No | No | Dmitriy | Open | Move dedup to `NotificationLog` DB table with `userId + type + date` unique constraint |
| TD-010 | EF contribution not resumed when targetMonths increases | UX | Formula | No UI prompt when daily limit decreases due to new EF target. User surprised by lower s2sToday. | S | P2 | No | No | Dmitriy | Open | Add recalculate trigger on EF settings save; notify user of limit change |
| TD-011 | Period does not store triggerPayday — computed at runtime | correctness | Data model | If paydays change mid-period, current period's trigger recomputed retroactively. Wrong s2sToday. | M | P1 | Yes | No | Dmitriy | Open | Add `triggerPayday Int?` to `Period` table; persist at period creation time |
| TD-012 | No skeleton loaders on initial web page load | UX | Web | Dashboard numbers flash from 0 to real values on first open. Perceived performance poor. | S | P2 | No | No | Dmitriy | Open | Add Tailwind skeleton pulse classes to dashboard number slots |
| TD-013 | /help text does not clarify decimal amounts accepted | UX | Bot | `parseFloat` used in `/spend` but help text says "сумма в рублях" without clarifying decimals. Misleading docs only — parsing is correct. | S | P3 | No | No | Dmitriy | Open | Update /help text |
| TD-014 | No alert when subscription is about to expire | UX | Cron | Users discover subscription lapsed when PRO features stop working. No 3-day warning. | S | P2 | No | No | Dmitriy | Open | Add Cron 5: daily check for subscriptions expiring in ≤3 days |
| TD-015 | avalanchePool not zero-checked before min() with focusDebt.balance | correctness | Formula | Negative `investPool` → negative `avalanchePool` → `Math.min(negative, positive)` returns negative → inflates `s2sPeriod`. Fragile if budget goes negative. | S | P0 | Yes | No | Dmitriy | Open | `engine.ts` lines 197–204: add `avalanchePool = Math.max(0, avalanchePool)` |
| TD-016 | Bot calls API with X-TG-DEV header in all environments | security | Bot | Bot's /today and /spend fail silently in production (401 returned). Bot should use /internal/* routes with X-Internal-Key. | M | P1 | No | No | Dmitriy | Open | `apps/bot/src/index.ts` lines 100, 167 |
| TD-017 | GET /tg/expenses/today uses UTC midnight, not user's local midnight | correctness | API | Moscow users' expenses 00:00–02:59 local time appear as "yesterday." Affects dashboard s2sToday. | M | P2 | Yes | No | Dmitriy | Open | Pass user timezone and compute local midnight in query |
| TD-018 | pnpm lockfile mismatch on deploy when package.json changes | ops | Deploy | `pnpm install --frozen-lockfile` fails if lockfile not regenerated before commit. Manual fix required. | S | P1 | No | No | Dmitriy | Open | Add pre-commit hook to verify lockfile; or use `--no-frozen-lockfile` in Dockerfiles |
| TD-019 | sendDeficitAlert is dead code | ops | Notify | Function exists in `notify.ts`, never called from cron or API. Dead code. | S | P2 | No | No | Dmitriy | Open | Either wire up to cron or delete |
| TD-020 | weeklyDigest setting with no cron implementation | UX | Cron | `weeklyDigest` boolean exists in UserSettings schema. No cron job sends it. Setting has no effect. | M | P2 | No | No | Dmitriy | Open | Implement weekly digest cron or remove the setting |
| TD-021 | EF target uses full monthly obligations in prorated periods | correctness | Formula | EF contribution calculation uses full monthly obligations even when period is prorated. Over-calculates EF contributions for mid-period onboarding. | M | P1 | Yes | No | Dmitriy | Open | Prorate EF obligation base by period length ratio |
| TD-022 | POSTGRES_PASSWORD cannot contain special chars | ops | Infra | Special chars in password cause DATABASE_URL parse failures. Configuration is non-standard. | S | P2 | No | No | Dmitriy | Open | Encode password separately in DATABASE_URL construction; or document constraint |
| TD-023 | No automated DB backup | ops | Infra | Manual backup only. No crontab on server. Data loss risk on server failure. | S | P1 | No | No | Dmitriy | Open | Set up crontab per runbook-backup-restore.md |

---

## Closed Items

| ID | Title | Resolution | Closed |
|----|-------|------------|--------|
| TD-C001 | Cron rollover used incomes[0] for prorate | Fixed — now prorates each income individually by period length | 2026-03-20 |
| TD-C002 | CORS open (no origin restriction) | Fixed — restricted to `https://mytodaylimit.ru` origin | 2026-03-20 |
| TD-C003 | No auth_date freshness check on initData | Fixed — added 1h TTL check on `auth_date` field | 2026-03-20 |
