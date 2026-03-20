# Gap Analysis: Intended vs Actual Implementation

**Project**: PFM Bot
**Date**: 2025-12
**Scope**: All gaps between the intended design and the actual implementation as of this writing

---

## Summary Table

| ID | Title | Area | Impact | Priority |
|----|-------|------|--------|----------|
| GAP-001 | Multi-income period allocation double-counts incomes | Formula | High | P1 |
| GAP-002 | Period `triggerPayday` not persisted — computed at runtime | Data model | High | P1 |
| GAP-003 | Notification dedup lost on API restart | Cron / UX | Medium | P1 |
| GAP-004 | Period rollover at UTC midnight, not user's local midnight | Cron / Correctness | Medium | P2 |
| GAP-005 | No expense editing — delete only | UX | Low | P3 |
| GAP-006 | Avalanche estimate ignores APR changes over time | Formula | Low | P2 |
| GAP-007 | EF contribution not notified after target change | UX / Formula | Low | P2 |
| GAP-008 | `/delete` user data command not implemented | Bot / Compliance | Medium | P1 |
| GAP-009 | No rate limiting on API | Security | High | P1 |
| GAP-010 | Bot `/spend` decimal support not documented | Bot / UX | Low | P3 |
| GAP-011 | Onboarding re-run creating duplicate incomes | Data model | — | **FIXED** |
| GAP-012 | `package.json` changes causing lockfile mismatch on deploy | Ops | Medium | P1 |

---

## Detail

---

### GAP-001: Multi-Income Period Allocation Can Double-Count

**Area**: Formula
**Intended**: Two separate income records (e.g., salary 250 000 ₽ on the 1st, bonus/part-time 50 000 ₽ on the 15th) each contribute to only their respective period — 250k to the period triggered by the 1st, 50k to the period triggered by the 15th.
**Actual**: The `triggerPayday` logic in `engine.ts` (`calculateS2S`) correctly filters income by matching the trigger payday against each income record's `paydays` array. If both income records have `paydays: [1, 15]` (a single record with two paydays), the income is split by `paydays.length` — so each period gets `amount / 2`. However, if there are **two separate income records** each with `paydays: [1]` and `paydays: [15]` respectively, both are tested against the same trigger. Only the one matching the trigger is included. This is the intended behavior.

The actual gap is the **single-record multi-payday case**: a user with one income record and `paydays: [1, 15]` gets `amount / 2` per period. If their stated income of 80 000 ₽ is a true monthly total split across two paydays (i.e., they receive 40k on the 1st and 40k on the 15th), this is correct. But if their onboarding input was "I earn 80 000 ₽ on the 1st" and they added the 15th as a second payday without adjusting the amount, the system gives them 40 000 ₽ per period — half their actual income.

**Risk**: Users who add a second payday without halving their stated income will see their daily limit cut in half. The UI gives no warning during payday configuration.
**Impact**: High — directly cuts the daily spending limit.
**Priority**: P1
**Fix**: In the payday settings UI, when a second payday is added, prompt the user: "Do you want to split your existing income amount across two paydays, or do you earn [X] on each payday separately?" Alternatively, always use separate income records per payday source.

---

### GAP-002: Period `triggerPayday` Not Persisted

**Area**: Data model
**Intended**: Each `Period` row should record which payday triggered it, so historical periods can be correctly associated with their income source.
**Actual**: The `Period` table (`packages/db/prisma/schema.prisma`) has no `triggerPayday` column. The trigger is recomputed at runtime in `engine.ts`:

```ts
const endDay = periodEndDate.getDate();
const endDayIdx = allPaydays.indexOf(endDay);
const triggerPayday = endDayIdx > 0
  ? allPaydays[endDayIdx - 1]
  : allPaydays[allPaydays.length - 1];
```

If the user changes their paydays after a period has been created, the retroactive recomputation for the active period uses the new payday list. The trigger for the current period may shift, changing which income is counted.

**Risk**: If a user edits their paydays mid-period (e.g., changes from `[15]` to `[10, 25]`), the active period's income may be recalculated with a different trigger, potentially doubling or zeroing their income for the period.
**Impact**: High — correctness of s2sPeriod depends on the trigger.
**Priority**: P1
**Fix**: Add `triggerPayday Int?` column to the `Period` model. Set it at period creation time (in `onboarding/complete` and the rollover cron). Use the persisted value in `calculateS2S` instead of recomputing from `endDate`.

---

### GAP-003: Notification Dedup Lost on API Restart

**Area**: Cron / UX
**Intended**: Each user receives at most one morning and one evening notification per day.
**Actual**: Dedup state is stored in a module-level `Map<string, Set<string>>` in `apps/api/src/cron.ts`. This map is initialized empty when the process starts. If the API restarts (deploy, crash, OOM) at a time when any user's notification window (e.g., exactly 09:00 in their timezone) is open, that user receives a duplicate notification.

**Risk**: Duplicate "good morning" or "good evening" messages. Annoying but not harmful.
**Impact**: Medium — trust / user experience.
**Priority**: P1
**Fix**: Add a `NotificationLog` table with columns `(userId, type, sentDate)` and a unique constraint on `(userId, type, sentDate)`. Replace in-memory `hasNotified`/`markNotified` with DB upsert. Restart-safe and also enables debugging notification delivery.

---

### GAP-004: Period Rollover at 00:05 UTC, Not User's Local Midnight

**Area**: Cron / Correctness
**Intended**: A new period should begin at the user's local midnight on payday, matching when they perceive a new pay period starting.
**Actual**: The rollover cron fires at `5 0 * * *` UTC. Periods whose `endDate <= UTC midnight` are rolled over. For Moscow users (UTC+3), this means the new period starts at 03:05 AM local time — close enough. For Novosibirsk (UTC+7), it starts at 07:05 AM. For Vladivostok (UTC+10), it starts at 10:05 AM.

During the window from UTC midnight to the rollover time, the old period is technically expired (`endDate` has passed) but not yet rolled over. Dashboard queries return the expired active period with `daysLeft = 0` or negative.

**Risk**: Users in UTC+5 to UTC+12 may see "0 days left" or odd behavior on the dashboard for several hours on payday morning. Expenses recorded in this window are attached to the expiring period.
**Impact**: Medium — affects eastern Russia users significantly.
**Priority**: P2
**Fix**: Store `rolloverAt DateTime` per period (computed as `endDate` adjusted for user's local midnight). Rollover cron fires every minute and rolls over periods where `rolloverAt <= now`. This is the same pattern as the notification cron.

---

### GAP-005: No Expense Editing — Delete Only

**Area**: UX
**Intended**: Users can correct a mis-entered expense amount or note.
**Actual**: There is no `PATCH /tg/expenses/:id` endpoint. The `Expense` model has no `updatedAt` field. The only correction path is `DELETE /tg/expenses/:id` followed by a new `POST /tg/expenses` with the correct amount.

**Risk**: Users who enter "5000" instead of "500" must notice, delete, and re-enter. If they don't notice, their daily limit is understated by 4 500 ₽.
**Impact**: Low — user recovers by delete + re-enter. The flow is 2 taps.
**Priority**: P3 (known tradeoff — see ADR-006)
**Fix**: Add `PATCH /tg/expenses/:id` allowing `{ amount, note }` update. Add `updatedAt` to `Expense` schema. Display an edit icon in the expense list in the Mini App.

---

### GAP-006: Avalanche Estimate Ignores APR Changes Over Time

**Area**: Formula
**Intended**: The avalanche plan shows a realistic payoff timeline accounting for the fact that APR on variable-rate debts can change.
**Actual**: `buildAvalanchePlan()` in `apps/api/src/avalanche.ts` simulates each debt with a fixed `debt.apr` for all months:

```ts
const monthlyRate = debt.apr / 12;
// ...used in a while loop for 600 iterations with no APR update
```

Credit card APRs change quarterly. A card at 21.9% today may be at 24.9% in 6 months.

**Risk**: Estimated payoff months may be optimistic if APR increases. For a 50 000 ₽ balance at 21.9% vs 24.9%, the difference over 7 months is ~1 000 ₽ in total interest — noticeable but not dramatic.
**Impact**: Low — estimate is advisory, not used in the S2S budget calculation.
**Priority**: P2
**Fix**: Allow the user to specify a "worst-case APR" for the estimate, or display a confidence range.

---

### GAP-007: EF Contribution Silently Resumes When Target Increases Without UX Feedback

**Area**: UX / Formula
**Intended**: When a user increases their EF target (e.g., from 3 months to 6 months), they should be informed that their daily spending limit has decreased because a new EF contribution has been reactivated.
**Actual**: The formula correctly resumes EF contributions when `efDeficit > 0` (which happens immediately when `targetMonths` increases). However, there is no notification or in-app banner informing the user. Their daily limit drops silently on the next period recalculation or the next payday.
**Risk**: User sees their limit unexpectedly decrease and is confused, thinking it's a bug.
**Impact**: Low — behavior is correct, UX feedback is missing.
**Priority**: P2
**Fix**: After saving EF settings (which triggers `POST /periods/recalculate`), the API response includes the new `s2sDaily`. The Mini App settings page should show a diff: "Your daily limit changed from X ₽ to Y ₽ because of the new EF target."

---

### GAP-008: `/delete` User Data Command Not Implemented

**Area**: Bot / Compliance
**Intended**: Users should be able to issue `/delete` to the bot to delete all their data (GDPR right to erasure, general privacy practice).
**Actual**: No `/delete` command exists in `apps/bot/src/index.ts`. The `User` model has `onDelete: Cascade` on all related models (Prisma schema), so a `prisma.user.delete()` would cascade correctly — the implementation is just missing from the bot.
**Risk**: Users who want to delete their data cannot do so. Regulatory risk if operating in EU or for EU users.
**Impact**: Medium — no data deletion path at all.
**Priority**: P1
**Fix**: Add `/delete` command to `apps/bot/src/index.ts`. Show a confirmation step ("Are you sure? Type YES to confirm"). Call `DELETE /tg/me` internal endpoint → `prisma.user.delete({ where: { telegramId } })`. All cascades fire automatically.

---

### GAP-009: No Rate Limiting on API

**Area**: Security
**Intended**: The API should protect against abusive request patterns (expense flooding, dashboard polling, brute-force on internal routes).
**Actual**: The Express app in `apps/api/src/index.ts` has no rate limiting middleware. There is only `app.use(cors())` and `app.use(express.json())`. Any client with a valid `X-TG-Init-Data` (or exploiting the bot's `X-TG-DEV` gap) can POST unlimited expenses or poll the dashboard indefinitely.
**Risk**: A single abusive user can fill the `Expense` table with millions of records, causing DB storage exhaustion and slow queries for all other users. Internal routes (`/internal/*`) rely only on `ADMIN_KEY` — a leaked key allows unlimited subscription activations.
**Impact**: High — service availability risk.
**Priority**: P1
**Fix**: Add `express-rate-limit` middleware: 60 requests/minute per userId on `/tg/*`; 10 requests/minute per IP on `/internal/*`.

---

### GAP-010: Bot `/spend` Decimal Support Not Communicated

**Area**: Bot / UX
**Intended**: Users should know they can enter decimal amounts like `/spend 1500.50`.
**Actual**: `apps/bot/src/index.ts` uses `parseFloat(parts[0])` and correctly converts to kopecks with `Math.round(amount * 100)`. So `/spend 1500.50` → `150050` kopecks works correctly. But the `/help` text and reply example say "/spend 500 обед" with no mention of decimals. The help text also says "сумма в рублях" without clarifying decimal support.
**Risk**: Users who pay amounts like "799.99 ₽" enter only integer approximations (800), creating minor inaccuracies.
**Impact**: Low — functional behavior is correct; only documentation is misleading.
**Priority**: P3
**Fix**: Update `/help` text in `apps/bot/src/index.ts` to: `/spend <сумма> [заметка] — например: /spend 799.99 кофе`

---

### GAP-011: Onboarding Re-Run Creating Duplicate Incomes

**Area**: Data model
**Status**: **FIXED**
**Was**: Re-running onboarding (navigating back and resubmitting Step 1) created a second `Income` record without removing the first. The period was then calculated with doubled income.
**Fix applied**: `POST /tg/onboarding/income` now calls `prisma.income.deleteMany({ where: { userId } })` before creating the new income record. The fix is in `apps/api/src/index.ts` line 364–365. Similarly, obligations and debts are cleared at the start of their respective onboarding steps.

---

### GAP-012: `package.json` Changes on Dev Machine Cause Lockfile Mismatch on Deploy

**Area**: Ops
**Intended**: `docker compose up --build` on the server always succeeds.
**Actual**: Dockerfiles run `pnpm install --frozen-lockfile` (or equivalent). If a developer adds/updates a dependency locally and commits `package.json` changes without regenerating `pnpm-lock.yaml`, the server build fails with:

```
ERR_PNPM_FROZEN_LOCKFILE  Cannot perform installation in headless mode because lockfile is not up-to-date
```

This has caused deploy failures requiring SSH access to the server to manually resolve.

**Risk**: Deploy blocked until manually resolved. Deployment downtime.
**Impact**: Medium — ops pain, occasional deploy failures.
**Priority**: P1
**Fix**: Add a pre-commit or pre-push hook that runs `pnpm install --lockfile-only` and fails if `pnpm-lock.yaml` has uncommitted changes. Alternatively, document in the runbook: "always run `pnpm install` before committing package.json changes." The deploy script (`deploy.sh`) could also add a lockfile check step before building.
