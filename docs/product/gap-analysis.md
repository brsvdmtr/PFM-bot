---
title: "Gap Analysis: Known Gaps Registry"
document_type: Gap-Audit
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-21"
related_docs:
  - path: ../system/formulas-and-calculation-policy.md
    relation: "canonical formula source"
  - path: north-star-product-spec.md
    relation: "feature status"
---

# Gap Analysis: Known Gaps Registry

**Project**: PFM Bot — Safe to Spend
**Scope**: All known gaps between intended design and actual implementation as of 2026-03-20
**Purpose**: Managed registry of open issues. Items marked Fixed are kept for reference.

---

## Summary Table

| ID | Title | Category | Severity | Status |
|----|-------|----------|----------|--------|
| GAP-001 / TD-011 | Trigger payday not persisted in Period | code | P1 | fixed |
| GAP-003 / TD-009 | Notification dedup lost on container restart | code | P1 | open |
| GAP-004 / TD-003 | Period rollover timing off by UTC offset | code | P2 | open |
| GAP-007 | EF contribution not resuming after target change | code | P2 | open |
| GAP-008 / TD-007 | /delete user data command not implemented | code | P1 | open |
| GAP-011 | Duplicate incomes on onboarding re-run | code | — | fixed |
| GAP-014 | No cash anchor / mid-period onboarding | code | P2 | fixed |
| GAP-015 | Income Semantics A (monthly total ÷ payCount) — wrong period income | code | P0 | **fixed 2026-03-21** |
| GAP-016 | Period boundaries based on UTC calendar dates, not actual payout dates | code | P0 | **fixed 2026-03-21** |
| GAP-017 | Today's expenses filtered by UTC midnight, not user's local TZ | code | P1 | **fixed 2026-03-21** |
| GAP-018 | totalDebtPayments was static at period creation, not updated on payments | code | P1 | **fixed 2026-03-21** |
| GAP-012 | s2sDaily in Period snapshot diverges from dynamic daily | docs | P2 | open |
| GAP-013 | emergencyFund.targetAmount computed in API, not stored | code | P2 | open |
| TD-001 | No rate limiting on API | security | P1 | open |
| TD-005 | Dockerfile uses prisma db push in production | ops | P1 | open |
| TD-C002 | CORS open to all origins | security | — | fixed |
| TD-C003 | auth_date not validated (replay attack) | security | — | fixed |
| TD-C001 | Cron rollover used incomes[0].paydays | code | — | fixed |

---

## Code Gaps

---

### GAP-001 / TD-011: Trigger Payday Not Persisted in Period

| Field | Value |
|-------|-------|
| ID | GAP-001 (also tracked as TD-011 in technical-debt-register) |
| Title | Trigger payday not persisted in Period |
| Category | code |
| Severity | P1 |
| Status | fixed |
| User-visible symptom | Was: Period.s2sDaily snapshot is correct at creation but the trigger payday is not stored — cannot audit which income fired for a given period. If a user changes paydays mid-period, the active period's income may be recalculated with a different trigger, potentially changing the daily limit with no warning or explanation. |
| Root cause | Was: `calculateS2S()` in `engine.ts` computed `triggerPayday` at runtime from `endDate.getDate()` and the current `allPaydays` list. The `Period` table had no `triggerPayday` column. |
| Affected code | `packages/db/prisma/schema.prisma` (Period model), `apps/api/src/engine.ts`, `apps/api/src/cron.ts` (rollover), `apps/api/src/index.ts` (onboarding complete handler) |
| Affected docs | `formulas-and-calculation-policy.md` |
| Current behavior | Fixed: `triggerPayday` is computed and stored in `Period.triggerPayday` on create/recalculate/rollover. |
| Migration needed | Yes — schema migration in `packages/db/prisma/migrations/20260320000000_cash_anchor_and_ru_calendar/` |
| Fixed in | v2 release 2026-03-20 |

---

### GAP-003: Notification Dedup Lost on Container Restart

| Field | Value |
|-------|-------|
| ID | GAP-003 |
| Title | Notification dedup lost on container restart |
| Category | code |
| Severity | P1 |
| Status | open |
| User-visible symptom | After API container restart (deploy, OOM kill), morning or evening notification may be sent twice in the same day. |
| Root cause | Dedup state is stored in a module-level in-memory `Map` in `apps/api/src/cron.ts`. The map is empty on every process start. If the API restarts during the notification window (09:00–09:05 or 21:00–21:05 user-local), it fires again for users already notified. |
| Affected code | `apps/api/src/cron.ts` (notification cron, `hasNotified`/`markNotified` functions) |
| Affected docs | None — not documented in user-facing content |
| Current behavior | In-memory `Map<string, Set<string>>` tracks notified users per day. Cleared on restart. |
| Target behavior | Persist dedup in DB: `NotificationLog` table with `(userId, type, sentDate)` unique constraint. `markNotified` does DB upsert; `hasNotified` queries DB. Restart-safe. |
| Workaround | Avoid deploying during 09:00–09:05 or 21:00–21:05 UTC. Accept double-notification risk otherwise. |
| Migration needed | Yes — new `NotificationLog` table |
| Fixed in | N/A |

---

### GAP-004: Period Rollover Timing Off by UTC Offset

| Field | Value |
|-------|-------|
| ID | GAP-004 |
| Title | Period rollover timing off by UTC offset |
| Category | code |
| Severity | P2 |
| Status | open |
| User-visible symptom | For Moscow users (UTC+3), new period starts at 03:05 local time, not at midnight. For users in UTC+5 and higher, the gap is even larger. Users in UTC+5–12 may see "0 days left" on payday morning for several hours until the cron fires. |
| Root cause | Rollover cron fires at `5 0 * * *` UTC. For Moscow (UTC+3) this means 03:05 local — acceptable for MVP. For Novosibirsk (UTC+7) it means 07:05 AM. For Vladivostok (UTC+10) it means 10:05 AM. |
| Affected code | `apps/api/src/cron.ts` (rollover cron, line ~50) |
| Affected docs | `faq-mvp.md` — notes this behavior, describes 00:05–03:05 MSK window |
| Current behavior | Cron fires at 00:05 UTC daily. Rolls over all periods where `endDate <= now`. |
| Target behavior | Per-user timezone-aware rollover. `Period` table has `rolloverAt DateTime` computed at creation as `endDate` adjusted for user's stored timezone. Rollover cron fires every minute and rolls over periods where `rolloverAt <= now`. |
| Workaround | Acceptable for MVP for Moscow-timezone user base. Eastern Russia users must wait. |
| Migration needed | Yes — schema migration to add `rolloverAt DateTime?` to `Period` |
| Fixed in | N/A |

---

### GAP-007: EF Contribution Not Resuming After Target Change

| Field | Value |
|-------|-------|
| ID | GAP-007 |
| Title | EF contribution not resuming after target change |
| Category | code |
| Severity | P2 |
| Status | open |
| User-visible symptom | If user increases EF targetMonths (e.g., from 3 to 6), their daily limit drops silently on the next recalculate or period rollover. No notification or explanation is shown in the UI. |
| Root cause | When `targetMonths` increases, `efDeficit > 0` immediately resumes EF contributions in `engine.ts`. The recalculate API response includes the new `s2sDaily` but the settings screen does not show a before/after diff. |
| Affected code | `apps/api/src/index.ts` (EF settings save handler), `apps/web/src/app/miniapp/MiniApp.tsx` (settings/EF screen) |
| Affected docs | `faq-mvp.md` — EF section does not explain limit change on target increase |
| Current behavior | EF contribution silently resumes on next recalculate/rollover when `efDeficit > 0`. No UI feedback. |
| Target behavior | After saving EF settings (which triggers recalculate), show: "Ваш дневной лимит изменился с X ₽ до Y ₽ из-за нового целевого размера аварийного фонда." |
| Workaround | User notices the change on dashboard and returns to settings to understand why. |
| Migration needed | No |
| Fixed in | N/A |

---

### GAP-008: /delete User Data Command Not Implemented

| Field | Value |
|-------|-------|
| ID | GAP-008 |
| Title | /delete user data command not implemented |
| Category | code |
| Severity | P1 |
| Status | open |
| User-visible symptom | Users cannot delete their account and all associated data through the bot. No `/deletedata` or `/delete` command exists. |
| Root cause | The command handler was never implemented in `apps/bot/src/index.ts`. The Prisma `User` model has `onDelete: Cascade` on all relations, so DB deletion would cascade correctly if triggered — the bot-layer entrypoint is simply missing. |
| Affected code | `apps/bot/src/index.ts`, `apps/api/src/index.ts` (add `DELETE /tg/me` endpoint) |
| Affected docs | Privacy policy (has TODO placeholder); `faq-mvp.md` (notes manual admin deletion as current workaround) |
| Current behavior | No self-service data deletion. Manual DB deletion by admin only. |
| Target behavior | `/deletedata` command shows confirmation step ("Введите YES для подтверждения"), then calls `DELETE /tg/me` → `prisma.user.delete()`. All cascades fire automatically. |
| Workaround | Manual DB deletion by admin. Not scalable. |
| Migration needed | No |
| Fixed in | N/A |

---

### GAP-012: s2sDaily in Period Snapshot Diverges from Dynamic Daily

| Field | Value |
|-------|-------|
| ID | GAP-012 |
| Title | s2sDaily in Period snapshot diverges from dynamic daily on dashboard |
| Category | docs |
| Severity | P2 |
| Status | open (by design, but confusing) |
| User-visible symptom | Documentation and code comments use `s2sDaily` to mean two different things: (1) the live carry-over value shown on the dashboard — recalculated on every request; (2) the `period.s2sDaily` snapshot frozen at period creation. Anyone reading the codebase or docs cannot tell which is meant. |
| Root cause | No canonical definition document clearly distinguishes the two values. The dashboard returns `s2sDaily` meaning the live value, but `period.s2sDaily` in the DB is the creation-time baseline. |
| Affected code | `apps/api/src/engine.ts`, `apps/api/src/cron.ts` (snapshot cron) |
| Affected docs | `formulas-and-calculation-policy.md`, `how-we-calculate-copy.md`, `dashboard-ui-data-contract.md` |
| Current behavior | Dashboard response field `s2sDaily` = live carry-over value. `period.s2sDaily` in DB = baseline at creation. Two different things with the same name. |
| Target behavior | `formulas-and-calculation-policy.md` defines: `s2sDaily (live)` = carry-over daily recalculated on fetch; `s2sPlanned (snapshot)` = baseline from period creation. All docs use these exact terms. |
| Workaround | `dashboard-ui-data-contract.md` notes this distinction for dashboard consumers. |
| Migration needed | No |
| Fixed in | N/A |
| v2 update (2026-03-20) | New dashboard explainability fields added: `nextIncomeDate`, `cashOnHand`, `cashAnchorAt`, `lastIncomeDate`, `nextIncomeAmount`, `daysToNextIncome`, `reservedUpcoming`, `reservedUpcomingObligations`, `reservedUpcomingDebtPayments`, `windowStart`, `windowEnd`, `usesLiveWindow`. These fields provide context for the Cash Anchor live window model (see `formulas-and-calculation-policy.md` §Cash Anchor Live Window). |

---

### GAP-013: emergencyFund.targetAmount Computed in API, Not Stored

| Field | Value |
|-------|-------|
| ID | GAP-013 |
| Title | emergencyFund.targetAmount computed in API from obligations sum, not stored in DB |
| Category | code |
| Severity | P2 |
| Status | open |
| User-visible symptom | If obligations change after the EF record was created, the `targetAmount` shown on the dashboard changes automatically — without any user action or notification. The EF progress bar can jump up or down when obligations are edited. |
| Root cause | `targetAmount` is computed server-side in the dashboard handler as `sum(activeObligations) * emergencyFund.targetMonths`. It is not stored on the `EmergencyFund` record. Any change to obligations immediately changes the displayed target. |
| Affected code | `apps/api/src/index.ts` (dashboard handler, EF section) |
| Affected docs | `dashboard-ui-data-contract.md` — notes this behavior |
| Current behavior | `targetAmount = sum(obligations.amount) * targetMonths` computed live on each dashboard request. |
| Target behavior | Either store `targetAmount` on `EmergencyFund` and update on obligations change, or document clearly that target is always derived from current obligations (current behavior, acceptable if documented). |
| Workaround | Behavior is internally consistent — target always reflects current obligations. Only confusing if user changes obligations and expects target to stay fixed. |
| Migration needed | No (if accepted as by-design) |
| Fixed in | N/A |

---

## Security Gaps

---

### TD-001: No Rate Limiting on API

| Field | Value |
|-------|-------|
| ID | TD-001 |
| Title | No rate limiting on API |
| Category | security |
| Severity | P1 |
| Status | open |
| User-visible symptom | No direct user symptom under normal use. Under abuse: service degradation for all users (slow queries, storage exhaustion from spam expenses). |
| Root cause | `apps/api/src/index.ts` has no rate limiting middleware. Any client with a valid `X-TG-Init-Data` can make unlimited requests. Internal routes (`/internal/*`) rely only on `ADMIN_KEY` — a leaked key allows unlimited subscription activations. |
| Affected code | `apps/api/src/index.ts` |
| Affected docs | None |
| Current behavior | No rate limiting anywhere in the API. |
| Target behavior | `express-rate-limit`: 60 req/min per `userId` on `/tg/*`; 10 req/min per IP on `/internal/*`. |
| Workaround | Nginx or Cloudflare rate limiting at the reverse-proxy layer (partial mitigation). |
| Migration needed | No |
| Fixed in | N/A |

---

## UX/Explanation Gaps

These are not code bugs but places where the product's behavior is correct but unexplained, causing user confusion.

**UX-001: No guidance on "per-payday vs monthly total" amount input**
When a user adds a second payday date to an income record, there is no UI hint that the amount field means "per payday, not monthly total." Users who enter their full monthly salary will silently have it halved by the engine. Fix: add a subtitle under the amount field when `paydays.length > 1` saying "Укажите сумму за одну выплату."

**UX-002: EF contribution silently changes daily limit**
No UI feedback when EF contribution changes the daily limit (on rollover, recalculate, or target change). User sees a different number with no explanation. Fix: show before/after diff after recalculate.

**UX-003: Period rollover timing is invisible to user**
Users in UTC+5–12 experience a window where the old period shows "0 days left" but the new period has not started. Dashboard shows a zero-state with no explanation. Fix: show a banner "Новый период начнётся сегодня. Пока считаем…" when daysLeft=0 and period is still ACTIVE.

**UX-004: weeklyDigest toggle has no effect**
Settings screen shows a weeklyDigest toggle. The feature is not implemented — the setting saves to DB but no cron reads it. No "coming soon" label. Fix: disable toggle with "(скоро)" label, or remove from settings until implemented.

**UX-005: deficitAlerts toggle has no effect**
`sendDeficitAlert` function exists in `notify.ts` but is never called from cron. Users who enable deficit alerts will never receive them. Fix: wire `sendDeficitAlert` into morning cron (check `s2sStatus === 'DEFICIT'` and `user.settings.deficitAlerts`).

---

## Ops Gaps

**OPS-001: notification dedup lost on restart** — See GAP-003 above.

**OPS-002: period rollover UTC-only** — See GAP-004 above.

---

---

### GAP-015: Income Semantics A — Monthly Total Divided by payCount

| Field | Value |
|-------|-------|
| ID | GAP-015 |
| Title | Income Semantics A (monthly total ÷ payCount) produced wrong per-period income |
| Category | code |
| Severity | P0 |
| Status | **fixed 2026-03-21** |
| User-visible symptom | Was: user with `income.amount=50_000_000, paydays=[1,15]` received `50_000_000/2=25_000_000` per period, which was correct in absolute terms only because the amount field meant "monthly total." But the UX concept was ambiguous, and when `useRussianWorkCalendar` changed the actual payout date, the `endDay`-based trigger could silently compute the wrong period income. |
| Root cause | `engine.ts` `calculateS2S` divided `inc.amount / payCount` where `payCount = inc.paydays.length`. `inc.amount` was expected to be a monthly total. `triggerPayday` was derived from `periodEndDate.getDate()` (UTC) — breaking if the actual end date shifted due to work-calendar adjustment. |
| Fix | Migrated to Semantics B: `income.amount` = per-payout. Engine no longer divides. DB updated: `50_000_000 → 25_000_000` kopecks. `startNominalPayday` (from `calculateActualPeriodBounds`) replaces `endDay`/`endDayIdx` derivation. |
| Fixed in | domain/finance migration, 2026-03-21 |

---

### GAP-016: Period Boundaries Based on Nominal Calendar Dates

| Field | Value |
|-------|-------|
| ID | GAP-016 |
| Title | Period `startDate`/`endDate` were nominal calendar UTC dates, not actual payout dates |
| Category | code |
| Severity | P0 |
| Status | **fixed 2026-03-21** |
| User-visible symptom | Was: `periodStart` showed March 15 (Sunday) even though the user was paid on March 13 (Friday, work-calendar adjusted). UI showed "day 3 of period" when it was actually day 8. `daysLeft` and `s2sToday` were wrong. |
| Root cause | `calculateCanonicalPeriodBounds` used nominal payday day-of-month as UTC midnight, ignoring `useRussianWorkCalendar`. Period start was `2026-03-15T00:00:00.000Z`, not `2026-03-12T21:00:00.000Z` (= March 13 midnight Moscow). |
| Fix | `calculateActualPeriodBounds` uses `getLastActualPayday`/`getNextActualPayday` (work-calendar aware), then converts to user's local midnight UTC via `toUserLocalMidnightUtc`. Golden test confirms `periodStart = 2026-03-12T21:00:00.000Z`. |
| Fixed in | domain/finance migration, 2026-03-21 |

---

### GAP-017: Today's Expenses Filtered by UTC Midnight

| Field | Value |
|-------|-------|
| ID | GAP-017 |
| Title | `todayTotal` used UTC midnight boundary instead of user's local TZ midnight |
| Category | code |
| Severity | P1 |
| Status | **fixed 2026-03-21** |
| User-visible symptom | Was: Moscow user (+3) who spent money at 01:00 MSK saw it counted in "yesterday" on the dashboard. `s2sToday` did not reflect that expense until 03:00 MSK (UTC midnight). |
| Root cause | `index.ts` dashboard handler filtered `todayExpenses` with `spentAt >= new Date(new Date().setHours(0,0,0,0))` — which is UTC midnight, not Moscow midnight. |
| Fix | `effectiveLocalDateInPeriod` in `domain/finance/matchEventsToPeriod.ts` uses `toZonedTime(date, tz)` to check local date. `todayTotal` is now computed in the user's TZ. |
| Fixed in | domain/finance migration, 2026-03-21 |

---

### GAP-018: totalDebtPayments Not Updated on Debt Payments

| Field | Value |
|-------|-------|
| ID | GAP-018 |
| Title | `Period.totalDebtPayments` was a static snapshot; debt payments didn't affect `s2sToday` |
| Category | code |
| Severity | P1 |
| Status | **fixed 2026-03-21** |
| User-visible symptom | Was: after paying a debt minimum payment, `s2sToday` did not increase — the budget already reserved for debt payments was not freed up even after the payment was recorded. Users who were disciplined about debt payments saw no reward in their daily limit. |
| Root cause | `Period.totalDebtPayments` was set once at period creation (sum of all active debt `minPayment` values). `DebtPaymentEvent` records existed but were never used to reduce `totalDebtPayments`. `s2sPeriod` was never rebuilt on debt payment events. |
| Fix | `computeDebtPeriodSummaries` computes `remainingRequiredThisPeriod = max(0, required - paid)` per debt. `totalDebtPaymentsRemainingForPeriod = sum(remainingRequiredThisPeriod)` is fed to `computeS2S`. `rebuildActivePeriodSnapshot` is called on every `DebtPaymentEvent` → `Period.s2sPeriod` is rebuilt immediately, freeing the paid amount into the discretionary budget. |
| Fixed in | domain/finance migration, 2026-03-21 |

---

## Fixed (for Reference)

---

### GAP-011: Duplicate Incomes on Onboarding Re-Run

| Field | Value |
|-------|-------|
| ID | GAP-011 |
| Title | Duplicate incomes on onboarding re-run |
| Category | code |
| Severity | — |
| Status | fixed |
| User-visible symptom | Was: Re-running onboarding doubled income records, roughly halving the daily limit due to doubled `s2sPeriod` calculation. |
| Root cause | Was: `POST /tg/onboarding/income` created a new `Income` record without removing the existing one. |
| Current behavior | Fixed: `apps/api/src/index.ts:364–365` calls `prisma.income.deleteMany({ where: { userId } })` before creating the new record. Same pattern applied to obligations and debts. |
| Migration needed | No |
| Fixed in | d785b05 |

---

### GAP-014: No Cash Anchor / Mid-Period Onboarding

| Field | Value |
|-------|-------|
| ID | GAP-014 |
| Title | No cash anchor / mid-period onboarding |
| Category | code |
| Severity | P2 |
| Status | fixed |
| User-visible symptom | Was: users who joined mid-period or wanted to update their current cash balance had no way to tell the system how much money they actually have in hand. The period-based model assumed income arrived at period start and tracked spending from there, with no way to anchor to reality. |
| Root cause | Was: `Period` model had no `cashAnchorAmount`/`cashAnchorAt` fields. The dashboard calculation always used the period-based formula regardless of when the user actually had money. |
| Affected code | `packages/db/prisma/schema.prisma` (Period model), `apps/api/src/index.ts` (dashboard handler, new `POST /tg/cash-anchor` endpoint) |
| Affected docs | `formulas-and-calculation-policy.md`, `api-v1.md`, `dashboard-ui-data-contract.md` |
| Current behavior | Fixed: user can provide current cash via `POST /tg/cash-anchor`. System stores `Period.cashAnchorAmount` and `Period.cashAnchorAt`, then computes live S2S from that anchor (Cash Anchor Live Window model). See `formulas-and-calculation-policy.md` §Cash Anchor Live Window. |
| Migration needed | Yes — schema migration in `packages/db/prisma/migrations/20260320000000_cash_anchor_and_ru_calendar/` |
| Fixed in | v2 release 2026-03-20 |

---

### TD-C002: CORS Open to All Origins

| Field | Value |
|-------|-------|
| ID | TD-C002 |
| Title | CORS open to all origins |
| Category | security |
| Severity | — |
| Status | fixed |
| User-visible symptom | Was: any web origin could make authenticated requests to the API. |
| Current behavior | Fixed: CORS restricted to `mytodaylimit.ru`. |
| Migration needed | No |
| Fixed in | 2026-03-20 |

---

### TD-C003: auth_date Not Validated (Replay Attack)

| Field | Value |
|-------|-------|
| ID | TD-C003 |
| Title | auth_date not validated — replay attack possible |
| Category | security |
| Severity | — |
| Status | fixed |
| User-visible symptom | Was: captured initData could be replayed indefinitely to impersonate a user. |
| Current behavior | Fixed: `auth_date` validated with 1-hour TTL. Requests with older auth_date are rejected. |
| Migration needed | No |
| Fixed in | 2026-03-20 |

---

### TD-C001: Cron Rollover Used incomes[0].paydays

| Field | Value |
|-------|-------|
| ID | TD-C001 |
| Title | Cron rollover used incomes[0].paydays instead of allPaydays |
| Category | code |
| Severity | — |
| Status | fixed |
| User-visible symptom | Was: users with multiple income records had only the first record's paydays used for period rollover, causing incorrect period boundaries. |
| Current behavior | Fixed: rollover cron now uses `allPaydays` collected from all income records. |
| Migration needed | No |
| Fixed in | 2026-03-20 |
