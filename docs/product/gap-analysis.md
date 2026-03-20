---
title: "Gap Analysis: Intended vs Actual Implementation"
document_type: Gap/Audit
status: Active
source_of_truth: Yes
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - ../system/formulas-and-calculation-policy.md
  - north-star-product-spec.md
---

# Gap Analysis: Intended vs Actual Implementation

**Project**: PFM Bot — Safe to Spend
**Scope**: All gaps between intended design and actual implementation as of 2026-03-20
**Authority**: This document is the canonical registry of open issues. Items marked Fixed are closed.

---

## Summary Table

| ID | Title | Category | Severity | Fix Status |
|----|-------|----------|----------|------------|
| GAP-001 | Multi-income period allocation — payday split confusion | Code | P2 Medium | Open |
| GAP-002 | `triggerPayday` not persisted — computed at runtime | Code | P1 High | Open |
| GAP-003 | Notification dedup lost on API restart | Code | P2 Medium | Open |
| GAP-004 | Period rollover at UTC midnight, not user's local midnight | Code | P2 Medium | Open |
| GAP-005 | No expense editing — delete only | Code | P3 Low | Open |
| GAP-006 | Avalanche estimate ignores APR changes over time | Code | P3 Low | Open |
| GAP-007 | EF contribution not resuming after target change | Code | P2 Medium | Open |
| GAP-008 | `/delete` user data command not implemented | Code | P1 High | Open |
| GAP-009 | No rate limiting on API | Security | P1 High | Open |
| GAP-010 | `/spend` decimal support not documented in help text | Code | P3 Low | Open |
| GAP-011 | Onboarding re-run creating duplicate incomes | Code | — | Fixed (d785b05) |
| GAP-012 | `package.json` changes causing lockfile mismatch on deploy | Ops | P1 High | Open |
| GAP-013 | `weeklyDigest` setting exists — cron never implemented | Code | P2 Medium | Open |
| GAP-014 | `sendDeficitAlert` function exists — never called from cron | Code | P2 Medium | Open |
| GAP-015 | `DailySnapshot` saved at 23:55 UTC — not user's local midnight | Code | P2 Medium | Open |
| GAP-016 | No expense deduplication / idempotency key on POST /expenses | Code | P2 Medium | Open |
| GAP-017 | EF target uses full monthly obligations even in prorated periods | Code | P2 Medium | Open |
| GAP-018 | `s2sDaily` in snapshot vs live `s2sDaily` on dashboard are different values | Docs | P2 Medium | Open |
| GAP-019 | `IRREGULAR` income frequency field exists — ignored in engine | Code | P2 Medium | Open |
| GAP-020 | PRO feature gates not enforced at API level | Code | P1 High | Open |

---

## Section 1: Code Gaps

---

### GAP-001: Multi-Income Period — Payday Split Confusion

| Field | Value |
|-------|-------|
| **ID** | GAP-001 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | User with one income record and two paydays sees their daily limit cut in half. User who configured income as "I earn 80 000 ₽ total" then added a second payday without halving the amount gets 40 000 ₽/period instead of 80 000 ₽. |
| **Root Cause** | `calculateS2S` in `engine.ts` divides income `amount` by `paydays.length` when a single income record has multiple paydays. If the user's 80 000 ₽ represents a total monthly figure (not per-payday), this halving is correct. But the UI gives no guidance on how to interpret the amount field. |
| **Current Implementation** | `engine.ts` line 126: `inc.paydays.includes(triggerPayday)` — single-record multi-payday income is split by `paydays.length`. Two separate income records with distinct paydays each contribute their full amount only to the matching trigger. |
| **Target State** | Payday settings UI warns user when adding a second payday: "Is your income amount per-payday or total monthly?" Alternatively, always model one income record per payday source. |
| **Affected Code** | `apps/api/src/engine.ts:104–127`, `apps/web/src/app/miniapp/MiniApp.tsx` (paydays editor) |
| **Affected Docs** | `faq-mvp.md` (two-salary section partially addresses this but not the amount interpretation) |
| **Temporary Workaround** | User manually halves their income amount if they have two paydays from a single source. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Add a UI prompt in the payday editor when `paydays.length` increases from 1 to 2. Ask: "Ваша сумма дохода — это за каждую выплату или общая за месяц?" If total monthly, auto-halve. |

---

### GAP-002: `triggerPayday` Not Persisted

| Field | Value |
|-------|-------|
| **ID** | GAP-002 |
| **Category** | Code |
| **Severity** | P1 High |
| **User-Visible Symptom** | If a user changes their paydays mid-period, the active period's income may be recalculated with a different trigger, potentially doubling or zeroing their income for the current period. No warning is shown. |
| **Root Cause** | The `Period` table in Prisma schema has no `triggerPayday` column. The trigger is recomputed at runtime in `engine.ts:118–122` from `endDate.getDate()` and the current `allPaydays` list. If paydays change, the runtime computation uses the new list against the old period's `endDate`. |
| **Current Implementation** | `apps/api/src/engine.ts:118–122`: `endDay = periodEndDate.getDate()`, `endDayIdx = allPaydays.indexOf(endDay)`, `triggerPayday = allPaydays[endDayIdx - 1]`. No persisted value. |
| **Target State** | `Period` table has `triggerPayday Int?` column. Set at period creation (onboarding complete + rollover cron). `calculateS2S` uses the persisted value; falls back to runtime computation only if null. |
| **Affected Code** | `packages/db/prisma/schema.prisma` (Period model), `apps/api/src/engine.ts:118–122`, `apps/api/src/cron.ts` (rollover), `apps/api/src/index.ts` (onboarding complete handler) |
| **Affected Docs** | `formulas-and-calculation-policy.md` (should note this gap) |
| **Temporary Workaround** | Users should avoid changing paydays mid-period. If they must, they should trigger a manual recalculate immediately after. |
| **Needs Migration** | Yes — schema migration to add `triggerPayday Int?` to `Period` |
| **Fix Status** | Open |
| **Fix Notes** | Add Prisma migration. In `createPeriod` logic (onboarding + rollover), compute triggerPayday at creation time and persist it. In `calculateS2S`, accept optional `triggerPayday` parameter and skip the runtime `endDate` derivation when provided. |

---

### GAP-003: Notification Dedup Lost on API Restart

| Field | Value |
|-------|-------|
| **ID** | GAP-003 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | User receives duplicate morning or evening notification on the same day, typically after a deployment or container restart during a notification window. |
| **Root Cause** | Dedup state is stored in a module-level `Map<string, Set<string>>` in `apps/api/src/cron.ts`. The map is empty on process start. If the API restarts while the notification cron window is active, it fires again for users already notified. |
| **Current Implementation** | `apps/api/src/cron.ts`: in-memory `Map` tracks `hasNotified`/`markNotified` per user per day. Cleared on restart. |
| **Target State** | `NotificationLog` table with `(userId, type, sentDate)` unique constraint. `markNotified` does a DB upsert; `hasNotified` queries the DB. Restart-safe. |
| **Affected Code** | `apps/api/src/cron.ts` (notification cron, hasNotified/markNotified functions) |
| **Affected Docs** | None — this gap is not documented in user-facing docs |
| **Temporary Workaround** | Avoid deploying during 09:00–09:05 or 21:00–21:05 UTC. |
| **Needs Migration** | Yes — new `NotificationLog` table |
| **Fix Status** | Open |
| **Fix Notes** | Add Prisma migration for `NotificationLog`. Replace in-memory map with `prisma.notificationLog.upsert` (createOrSkip). This also enables debugging notification delivery. |

---

### GAP-004: Period Rollover at 00:05 UTC, Not User's Local Midnight

| Field | Value |
|-------|-------|
| **ID** | GAP-004 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | Users in UTC+5 to UTC+12 may see "0 days left" or a negative period on payday morning for several hours (until 00:05 UTC fires). Expenses logged in this window are attached to the expiring old period. |
| **Root Cause** | Rollover cron fires at `5 0 * * *` UTC. For Moscow (UTC+3) this means 03:05 AM local — acceptable. For Novosibirsk (UTC+7) it means 07:05 AM. For Vladivostok (UTC+10) it means 10:05 AM. |
| **Current Implementation** | `apps/api/src/cron.ts` line ~50: `cron.schedule('5 0 * * *', ...)`. Rolls over all periods where `endDate <= now`. |
| **Target State** | `Period` table has `rolloverAt DateTime` computed as `endDate` adjusted for user's stored `timezone`. Rollover cron fires every minute and rolls over periods where `rolloverAt <= now`. |
| **Affected Code** | `apps/api/src/cron.ts` (rollover cron), `packages/db/prisma/schema.prisma` (Period model) |
| **Affected Docs** | `faq-mvp.md` — "Что происходит в конце периода?" implies instant transition at payday |
| **Temporary Workaround** | None. Eastern Russia users must wait until UTC midnight + 5 minutes. |
| **Needs Migration** | Yes — schema migration to add `rolloverAt DateTime?` to `Period` |
| **Fix Status** | Open |
| **Fix Notes** | Similar pattern to notification cron (which already uses per-user timezone). Store `rolloverAt` on period creation. Change rollover cron from daily schedule to every-minute schedule checking `rolloverAt <= now`. |

---

### GAP-005: No Expense Editing — Delete Only

| Field | Value |
|-------|-------|
| **ID** | GAP-005 |
| **Category** | Code |
| **Severity** | P3 Low |
| **User-Visible Symptom** | User who enters "5000" instead of "500" must delete the expense and re-enter it. No in-place edit is available. |
| **Root Cause** | No `PATCH /tg/expenses/:id` endpoint exists. The `Expense` Prisma model has no `updatedAt` field. Known tradeoff — see ADR-006. |
| **Current Implementation** | `apps/api/src/index.ts`: only `POST /tg/expenses` and `DELETE /tg/expenses/:id`. |
| **Target State** | `PATCH /tg/expenses/:id` allows updating `{ amount, note }`. Mini App shows edit icon in history list. |
| **Affected Code** | `apps/api/src/index.ts`, `packages/db/prisma/schema.prisma` (add `updatedAt` to Expense), `apps/web/src/app/miniapp/MiniApp.tsx` (history screen) |
| **Affected Docs** | `faq-mvp.md` — "Как удалить расход?" should note that editing is not yet available |
| **Temporary Workaround** | Delete and re-enter. Two taps + re-type. |
| **Needs Migration** | No (schema change optional) |
| **Fix Status** | Open |
| **Fix Notes** | Low priority known tradeoff. Add `PATCH` endpoint and edit UI when expense editing becomes a user complaint pattern. |

---

### GAP-006: Avalanche Estimate Ignores APR Changes Over Time

| Field | Value |
|-------|-------|
| **ID** | GAP-006 |
| **Category** | Code |
| **Severity** | P3 Low |
| **User-Visible Symptom** | Avalanche payoff timeline may be optimistic if APR increases on variable-rate debts. |
| **Root Cause** | `buildAvalanchePlan()` in `apps/api/src/avalanche.ts` simulates all months with a fixed `debt.apr`. Credit card APRs change quarterly. |
| **Current Implementation** | `apps/api/src/avalanche.ts`: `const monthlyRate = debt.apr / 12` — used for all 600 simulation iterations with no APR update. |
| **Target State** | Allow user to specify a "worst-case APR" for the estimate, or display a disclaimer that the estimate assumes constant APR. |
| **Affected Code** | `apps/api/src/avalanche.ts` |
| **Affected Docs** | `faq-mvp.md` — "Что такое «план Avalanche»?" already notes "упрощённая оценка" — adequate disclaimer |
| **Temporary Workaround** | User can manually raise the APR field to a conservative value. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Acceptable simplification for MVP. Add explicit disclaimer in UI: "Расчёт при текущей ставке. Если ставка изменится — реальный срок может отличаться." |

---

### GAP-007: EF Contribution Not Resuming After Target Change (GAP-005 in notify.ts)

| Field | Value |
|-------|-------|
| **ID** | GAP-007 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | User increases EF target months (e.g., from 3 to 6). Their daily limit drops silently on the next recalculate or period rollover. No notification or explanation is shown. |
| **Root Cause** | When `targetMonths` increases, `efDeficit > 0` immediately resumes EF contributions in `engine.ts`. The API response to `POST /periods/recalculate` includes the new `s2sDaily`, but the Mini App settings page does not display a before/after diff. |
| **Current Implementation** | `apps/api/src/engine.ts:150`: `efDeficit = max(0, efTarget - currentAmount)` — silently resumes contributions whenever deficit exists. |
| **Target State** | After saving EF settings (which triggers recalculate), the API response or UI shows: "Ваш дневной лимит изменился с X ₽ до Y ₽ из-за нового целевого размера аварийного фонда." |
| **Affected Code** | `apps/api/src/index.ts` (EF settings save handler), `apps/web/src/app/miniapp/MiniApp.tsx` (settings/EF screen) |
| **Affected Docs** | `faq-mvp.md` — EF section does not explain limit change on target increase |
| **Temporary Workaround** | User notices the change on dashboard and returns to settings to understand why. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Return `{ previousS2sDaily, newS2sDaily }` from recalculate endpoint. Display diff in Mini App: toast or inline note when the delta > 5%. |

---

### GAP-008: `/delete` User Data Command Not Implemented

| Field | Value |
|-------|-------|
| **ID** | GAP-008 |
| **Category** | Code |
| **Severity** | P1 High |
| **User-Visible Symptom** | User cannot delete their account and data via the bot. No `/delete` command exists. There is a TODO placeholder in the privacy policy. |
| **Root Cause** | The `/delete` command handler was not implemented in `apps/bot/src/index.ts`. The Prisma `User` model has `onDelete: Cascade` on all relations, so the DB deletion would cascade correctly if called — the bot-layer entrypoint is simply missing. |
| **Current Implementation** | `apps/bot/src/index.ts`: no `/delete` command handler. |
| **Target State** | `/delete` command shows confirmation step ("Введите YES для подтверждения"), then calls `DELETE /tg/me` → `prisma.user.delete({ where: { telegramId } })`. All cascades fire automatically. |
| **Affected Code** | `apps/bot/src/index.ts`, `apps/api/src/index.ts` (add `DELETE /tg/me` endpoint) |
| **Affected Docs** | Privacy policy (has TODO placeholder). `faq-mvp.md` — no mention of data deletion. |
| **Temporary Workaround** | Manual DB deletion by admin. Not scalable. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | P1 for compliance. Simple implementation: bot handler + API endpoint. Must include confirmation step to prevent accidental deletion. |

---

### GAP-009: No Rate Limiting on API

| Field | Value |
|-------|-------|
| **ID** | GAP-009 |
| **Category** | Security |
| **Severity** | P1 High |
| **User-Visible Symptom** | No direct user symptom under normal use. Under abuse: service degradation for all users (slow queries, storage exhaustion). |
| **Root Cause** | `apps/api/src/index.ts` has no rate limiting middleware. Only `app.use(cors())` and `app.use(express.json())`. Any client with a valid `X-TG-Init-Data` can make unlimited requests. Internal routes (`/internal/*`) rely only on `ADMIN_KEY` — a leaked key allows unlimited subscription activations. |
| **Current Implementation** | No rate limiting anywhere in the API. |
| **Target State** | `express-rate-limit`: 60 req/min per `userId` on `/tg/*`; 10 req/min per IP on `/internal/*`. |
| **Affected Code** | `apps/api/src/index.ts` (add middleware) |
| **Affected Docs** | None |
| **Temporary Workaround** | Nginx or Cloudflare rate limiting at the reverse-proxy layer (partial mitigation). |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Install `express-rate-limit`. Add two limiters: user-scoped (after auth middleware) and IP-scoped (before auth, on /internal). One-day fix. |

---

### GAP-010: `/spend` Decimal Support Not Documented in Help Text

| Field | Value |
|-------|-------|
| **ID** | GAP-010 |
| **Category** | Code |
| **Severity** | P3 Low |
| **User-Visible Symptom** | Users assume `/spend` only accepts integers and enter rounded amounts (800 instead of 799.99). Tiny inaccuracies accumulate. |
| **Root Cause** | `/help` text in `apps/bot/src/index.ts` shows `/spend 500 обед` with no decimal example. The implementation correctly handles decimals (`parseFloat` + `Math.round(amount * 100)`). |
| **Current Implementation** | `apps/bot/src/index.ts`: `/help` text does not mention decimal support. |
| **Target State** | `/help` text updated to: `/spend <сумма> [заметка] — например: /spend 799.99 кофе` |
| **Affected Code** | `apps/bot/src/index.ts` (help text string) |
| **Affected Docs** | None |
| **Temporary Workaround** | None needed — functionally works, only documentation is incomplete. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | One-line change. Low priority. |

---

### GAP-011: Onboarding Re-Run Creating Duplicate Incomes

| Field | Value |
|-------|-------|
| **ID** | GAP-011 |
| **Category** | Code |
| **Severity** | — |
| **User-Visible Symptom** | Was: Re-running onboarding doubled income, cutting daily limit roughly in half due to doubled s2sPeriod calculation. |
| **Root Cause** | Was: `POST /tg/onboarding/income` created a second `Income` record without removing the first. |
| **Current Implementation** | Fixed: `apps/api/src/index.ts:364–365` calls `prisma.income.deleteMany({ where: { userId } })` before creating the new record. Same pattern applied to obligations and debts. |
| **Target State** | N/A — resolved. |
| **Affected Code** | `apps/api/src/index.ts:364–365` |
| **Affected Docs** | `north-star-product-spec.md` — noted as fixed |
| **Temporary Workaround** | N/A |
| **Needs Migration** | No |
| **Fix Status** | Fixed — commit d785b05 |
| **Fix Notes** | Confirmed fixed. Verified against code. |

---

### GAP-012: `package.json` Changes Cause Lockfile Mismatch on Deploy

| Field | Value |
|-------|-------|
| **ID** | GAP-012 |
| **Category** | Ops |
| **Severity** | P1 High |
| **User-Visible Symptom** | Deploy fails with `ERR_PNPM_FROZEN_LOCKFILE`. Requires SSH to server to manually resolve. Service is down until fixed. |
| **Root Cause** | Dockerfiles run `pnpm install --frozen-lockfile`. If a developer updates `package.json` without regenerating `pnpm-lock.yaml`, the server build fails. |
| **Current Implementation** | No pre-commit or CI check enforces lockfile consistency. |
| **Target State** | Pre-commit hook runs `pnpm install --lockfile-only` and fails if `pnpm-lock.yaml` has changes after. Or CI pipeline validates lockfile before merge. |
| **Affected Code** | `.husky/pre-commit` (to be created), `deploy.sh` (add lockfile check) |
| **Affected Docs** | Deployment runbook (not yet written) |
| **Temporary Workaround** | Developer runs `pnpm install` before committing `package.json` changes. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Add `.husky/pre-commit` with `pnpm install --lockfile-only && git diff --exit-code pnpm-lock.yaml`. |

---

### GAP-013: `weeklyDigest` Setting Exists — Cron Never Implemented

| Field | Value |
|-------|-------|
| **ID** | GAP-013 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | User enables "Weekly Digest" in settings. Nothing happens. They receive no weekly summary, ever. No feedback in UI that the feature is not yet active. |
| **Root Cause** | `apps/api/src/index.ts:961` includes `'weeklyDigest'` in the list of accepted settings fields. The field is saved to the DB. No cron job exists that reads `weeklyDigest: true` and sends any message. |
| **Current Implementation** | `User.settings.weeklyDigest` is persisted. No cron reads it. `apps/api/src/cron.ts`: no weekly digest schedule. |
| **Target State** | Either: (a) implement a weekly cron that sends a period summary to users with `weeklyDigest: true`; or (b) remove the setting from the UI and mark it as "coming soon". |
| **Affected Code** | `apps/api/src/index.ts:961`, `apps/api/src/cron.ts`, `apps/web` (settings screen showing the toggle) |
| **Affected Docs** | `north-star-product-spec.md` — already notes this as a known gap |
| **Temporary Workaround** | None. The setting is silently ineffective. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Short-term: hide the toggle in UI with a "Скоро" label or remove it. Long-term: implement weekly cron (Saturday 09:00 user-local-time, send last completed period summary). |

---

### GAP-014: `sendDeficitAlert` Function Exists — Never Called from Cron

| Field | Value |
|-------|-------|
| **ID** | GAP-014 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | User with deficit (`s2sPeriod = 0`, `status = DEFICIT`) expects a deficit alert notification. They receive nothing. The `deficitAlerts` setting in UI appears functional but has no effect. |
| **Root Cause** | `apps/api/src/notify.ts:130` exports `sendDeficitAlert()`. This function is never imported or called from `apps/api/src/cron.ts`. The `deficitAlerts` user setting is saved to DB but never read by any cron job. |
| **Current Implementation** | `apps/api/src/notify.ts:130`: function defined, not called. `apps/api/src/cron.ts`: no reference to `sendDeficitAlert`. |
| **Target State** | Morning notification cron checks if `s2sStatus === 'DEFICIT'` and user has `deficitAlerts: true`, then calls `sendDeficitAlert`. |
| **Affected Code** | `apps/api/src/cron.ts` (notification cron), `apps/api/src/notify.ts:130` |
| **Affected Docs** | `north-star-product-spec.md` — "Уведомление о дефиците ✅ MVP" is misleading; the function exists but is unreachable |
| **Temporary Workaround** | None. Deficit status is visible on dashboard but no push notification is sent. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | In morning notification cron: after calculating `s2sResult`, if `s2sResult.status === 'DEFICIT'` and `user.settings.deficitAlerts`, call `sendDeficitAlert`. One-day fix. |

---

### GAP-015: `DailySnapshot` Saved at 23:55 UTC — Not User's Local Midnight

| Field | Value |
|-------|-------|
| **ID** | GAP-015 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | For users in UTC+3 (Moscow), the snapshot is saved at 02:55 AM local time, not 23:55 local time. The snapshot `date` field records UTC date, not the user's local date. Historical charts or period summaries based on snapshots will show incorrect dates. |
| **Root Cause** | `apps/api/src/cron.ts:156`: `cron.schedule('55 23 * * *', ...)` runs at 23:55 UTC. The `today` variable used for snapshot `date` is `new Date()` at UTC time, not the user's local date. |
| **Current Implementation** | `apps/api/src/cron.ts:156–213`: snapshot cron fires at 23:55 UTC for all users regardless of timezone. `date: today` uses UTC date. |
| **Target State** | Snapshot cron fires every minute (or hourly). For each active period, check if it is currently 23:55 in the user's stored timezone. Save snapshot with the user's local date. |
| **Affected Code** | `apps/api/src/cron.ts:154–214` |
| **Affected Docs** | `north-star-product-spec.md` — "DailySnapshot (cron 23:55) ✅ MVP" is technically true but hides the timezone issue |
| **Temporary Workaround** | For Moscow users (UTC+3) the offset is only 3 hours — snapshot at ~03:00 local the next day. Low impact for MVP user base. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Lower priority than GAP-004 (rollover) since snapshots are not yet surfaced in UI. Fix when building the period history/analytics screen. |

---

### GAP-016: No Expense Deduplication / Idempotency Key

| Field | Value |
|-------|-------|
| **ID** | GAP-016 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | If a user's network request to `POST /tg/expenses` times out and the client retries, two identical expenses are created. User sees a doubled entry in history and a lower daily limit. |
| **Root Cause** | `POST /tg/expenses` has no idempotency key check. `Expense` model has no unique constraint on `(userId, amount, note, createdAt)` or a client-provided `idempotencyKey`. |
| **Current Implementation** | `apps/api/src/index.ts`: expense create handler does `prisma.expense.create()` unconditionally on every valid request. |
| **Target State** | Client sends an `idempotencyKey` (UUID generated once per "add expense" action). Server stores it on the `Expense` record with a unique constraint and returns the existing record on duplicate key. |
| **Affected Code** | `apps/api/src/index.ts` (expense create handler), `packages/db/prisma/schema.prisma` (add `idempotencyKey String? @unique` to Expense) |
| **Affected Docs** | None |
| **Temporary Workaround** | User checks history immediately after adding expense and deletes duplicates. |
| **Needs Migration** | Yes — schema migration to add `idempotencyKey` field |
| **Fix Status** | Open |
| **Fix Notes** | Standard REST pattern. Mini App generates a UUID on tap, includes it in the request body. API does `upsert` on `idempotencyKey`. |

---

### GAP-017: EF Target Uses Full Monthly Obligations in Prorated Periods

| Field | Value |
|-------|-------|
| **ID** | GAP-017 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | In the first (prorated) period, the EF contribution target is calculated based on full monthly obligations, while the actual obligations for the period are prorated. This can cause the EF contribution to be proportionally larger than expected relative to the period's actual budget. |
| **Root Cause** | `apps/api/src/engine.ts:148–149`: `monthlyObligations = obligations.reduce(sum + o.amount)` — this is the full monthly total, not prorated. `efTarget = monthlyObligations * targetMonths` is therefore the correct full-month target. But `efContribution` is then taken from a prorated `freePool`, meaning the fraction of income going to EF is higher in short periods. |
| **Current Implementation** | `apps/api/src/engine.ts:148–149`: EF target is always computed from full monthly obligations regardless of period length. EF contribution (`efContribution`) is prorated via `periodEFGoal = monthlyEFGoal * (daysTotal / fullPeriodDays)`, which partially compensates. |
| **Target State** | Verify and document that the prorated `efContribution` formula is intentional and correct. Add a comment in `engine.ts` explaining the asymmetry. Update `formulas-and-calculation-policy.md` to document this behavior explicitly. |
| **Affected Code** | `apps/api/src/engine.ts:148–183` |
| **Affected Docs** | `formulas-and-calculation-policy.md` (gap in documentation) |
| **Temporary Workaround** | N/A — user impact is small in prorated periods |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Likely correct behavior (EF target should be based on a full month's obligations). Needs documentation clarification, not a code fix. |

---

### GAP-019: `IRREGULAR` Income Frequency Field Exists — Ignored in Engine

| Field | Value |
|-------|-------|
| **ID** | GAP-019 |
| **Category** | Code |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | User marks income as IRREGULAR (freelancer). Engine treats it identically to MONTHLY income. The `frequency` field has no effect on the S2S calculation. Freelancers with variable income get no different treatment than salaried users. |
| **Root Cause** | `packages/db/prisma/schema.prisma:30,122`: `IncomeFrequency` enum includes `IRREGULAR`, and `Income.frequency` defaults to `MONTHLY`. `apps/api/src/engine.ts`: the `calculateS2S` function does not read `frequency` at all. |
| **Current Implementation** | `Income.frequency` is persisted but never read by `calculateS2S` or any other function. |
| **Target State** | Define what IRREGULAR means in the engine (e.g., user inputs expected amount for this specific period; or engine shows a prompt each period). Until defined, the option should be hidden from UI or labeled "coming soon". |
| **Affected Code** | `packages/db/prisma/schema.prisma`, `apps/api/src/engine.ts`, `apps/web` (income CRUD UI) |
| **Affected Docs** | `north-star-product-spec.md` — "Нерегулярный доход (IRREGULAR frequency)" listed as planned; `faq-mvp.md` should not claim freelancer support |
| **Temporary Workaround** | Freelancers manually update their income amount each period. |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Hide `IRREGULAR` from income creation UI until the feature is designed. The field can remain in the schema for future use. |

---

### GAP-020: PRO Feature Gates Not Enforced at API Level

| Field | Value |
|-------|-------|
| **ID** | GAP-020 |
| **Category** | Code |
| **Severity** | P1 High |
| **User-Visible Symptom** | PRO features that are announced (analytics, export) are not yet built. The `isPro` flag exists on the user record and the `/me/plan` endpoint returns it, but no API route checks `isPro` before serving any data. |
| **Root Cause** | PRO gate-keeping was deferred. The assumption was that PRO features would be built before enforcing gates. Currently no PRO-exclusive API endpoint exists, so there is nothing to gate. |
| **Current Implementation** | `apps/api/src/index.ts` (`/tg/me/plan` handler): returns `isPro` flag. No route uses this flag to restrict access. PRO subscription creates a `Subscription` record and sets `isPro: true`. |
| **Target State** | Define concretely which features are PRO-only. Implement at least one PRO-exclusive feature (e.g., full period history). Add middleware that checks `req.tgUser.isPro` for gated routes. |
| **Affected Code** | `apps/api/src/index.ts` |
| **Affected Docs** | `north-star-product-spec.md` — PRO feature list is vague ("аналитика, уведомления расширенные, экспорт данных") |
| **Temporary Workaround** | N/A — no PRO features exist yet to gate |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Decide which features are PRO before marketing PRO. Users who paid 100 XTR are currently getting no PRO-exclusive value. |

---

## Section 2: Documentation Gaps

---

### GAP-018: `s2sDaily` in Snapshot vs Live Dashboard — Terminology Confusion

| Field | Value |
|-------|-------|
| **ID** | GAP-018 |
| **Category** | Docs |
| **Severity** | P2 Medium |
| **User-Visible Symptom** | Documentation and code comments use `s2sDaily` to mean two different things: (1) the live carry-over value shown on the dashboard (`round((s2sPeriod - totalSpent) / daysLeft)`, recalculated on every request); (2) the `DailySnapshot.s2sPlanned` field (the at-creation baseline `s2sDaily` frozen at period start or recalculate). A reader of the codebase or docs cannot tell which is meant. |
| **Root Cause** | No canonical definition document distinguishes the two. `formulas-and-calculation-policy.md` does not exist or does not make this distinction explicit. |
| **Current Implementation** | Dashboard endpoint returns live `s2sDaily`. `DailySnapshot` stores `s2sPlanned` (baseline) and `s2sActual` (remaining budget / daysLeft at snapshot time). Variable naming in engine is consistent internally but not documented externally. |
| **Target State** | `formulas-and-calculation-policy.md` defines: `s2sDaily (live)` = carry-over daily recalculated on fetch; `s2sPlanned (snapshot)` = baseline from period creation. All other docs use these exact terms. |
| **Affected Code** | `apps/api/src/engine.ts`, `apps/api/src/cron.ts` (snapshot cron comment) |
| **Affected Docs** | `formulas-and-calculation-policy.md`, `how-we-calculate-copy.md`, `north-star-product-spec.md` (glossary) |
| **Temporary Workaround** | N/A — documentation gap |
| **Needs Migration** | No |
| **Fix Status** | Open |
| **Fix Notes** | Fix documentation in `formulas-and-calculation-policy.md`. Add terminology section to `how-we-calculate-copy.md`. |

---

## Section 3: UX Explanation Gaps

---

### UX-001: Payday Split — No Guidance on "Per-Payday or Monthly Total" Amount Input

**Issue**: During onboarding and income CRUD, the amount field label says "сумма дохода" with no clarification of whether it means per-payday or total monthly. Users with two paydays who enter their total monthly salary (not per-payday amount) will silently have it halved by the engine.

**Where it matters**: Income creation screen (onboarding step 2, incomes CRUD screen).

**Fix**: Add a subtitle under the amount field when `paydays.length > 1`: "Укажите сумму за одну выплату." Add an example: "Если получаете 80 000 ₽ и добавили два дня зарплаты — укажите 40 000 ₽ за каждую."

**Related gap**: GAP-001

---

### UX-002: EF Contribution Silently Changes Daily Limit

**Issue**: No UI feedback when the EF contribution changes the daily limit (on period rollover, recalculate, or target change). User sees a different number with no explanation.

**Where it matters**: Dashboard, settings (EF section).

**Fix**: After recalculate, show inline diff. On dashboard, add a "Почему изменился лимит?" help tooltip that breaks down the current period's deductions.

**Related gap**: GAP-007

---

### UX-003: Period Rollover Timing Is Invisible to User

**Issue**: Users in UTC+5–12 experience a window where the old period shows "0 days left" but the new period has not started. No explanation is shown on the dashboard. Users may think the app is broken.

**Where it matters**: Dashboard on payday morning.

**Fix**: When `daysLeft = 0` and the period status is still ACTIVE (not yet rolled over), show a banner: "Новый период начнётся сегодня. Пока считаем…" instead of showing a broken zero-state.

**Related gap**: GAP-004

---

### UX-004: weeklyDigest Toggle Has No Effect

**Issue**: Settings screen shows a weeklyDigest toggle. The feature is not implemented. There is no "coming soon" label. Users who enable it expect something to happen.

**Where it matters**: Settings screen.

**Fix**: Add "(скоро)" label next to the toggle, or disable the toggle with a tooltip. Do not save the value or make the toggle interactive until the feature is implemented.

**Related gap**: GAP-013

---

### UX-005: deficitAlerts Toggle Has No Effect

**Issue**: Settings screen shows a `deficitAlerts` toggle. `sendDeficitAlert` exists but is never called. Users who enable it will never receive a deficit notification even when their S2S status is DEFICIT.

**Where it matters**: Settings screen.

**Fix**: Implement GAP-014 (wire `sendDeficitAlert` into morning cron). Until then, add "(недоступно)" label to the toggle.

**Related gap**: GAP-014
