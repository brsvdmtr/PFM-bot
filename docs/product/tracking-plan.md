---
title: "Analytics Tracking Plan"
document_type: Informational
status: Draft
source_of_truth: No
verified_against_code: No
last_updated: "2026-03-20"
related_docs:
  - north-star-product-spec.md
  - gap-analysis.md
---

# Analytics Tracking Plan

**Project:** PFM Bot — Safe to Spend
**Version:** v0.1 MVP
**Last updated:** 2026-03-20
**Implementation status:** Not started. The codebase has no analytics instrumentation as of this date.

---

## Status Legend

| Icon | Meaning |
|---|---|
| Not started | No code instrumentation exists |
| In progress | Partially instrumented |
| Done | Fully instrumented and verified |

---

## Implementation Roadmap

### Phase 1 — Tier 1 events (product health baseline)
**Goal:** Know if onboarding works and if users are spending.
**Scope:** `onboarding_completed`, `expense_added`, `dashboard_opened`, `pro_purchased`
**Effort:** ~1 day. All four events can be added to the API layer with no new infrastructure.
**Dependency:** Pick an analytics sink first (PostHog recommended — see below).

### Phase 2 — Tier 2 events (product analytics)
**Goal:** Understand funnel drop-off, period lifecycle, engagement depth.
**Scope:** All onboarding steps, `period_completed`, `debt_payment_added`, `s2s_warning_triggered`, `period_recalculated`
**Effort:** ~2–3 days.
**Dependency:** Phase 1 complete. Super-properties setup in place.

### Phase 3 — Tier 3 events (advanced)
**Goal:** Retention cohorts, A/B testing, notification effectiveness.
**Scope:** `notification_sent`, `weekly_digest_sent` (when feature exists), settings changes, session-based events
**Effort:** ~3–5 days.
**Dependency:** Phase 2 complete. `weeklyDigest` cron implemented (GAP-013).

---

## Tier 1 — Must Have Now

These four events give minimum viable product health visibility. Implement in Phase 1.

| Event | Status | Source Layer | Code Touchpoint |
|---|---|---|---|
| `onboarding_completed` | Not started | backend | `apps/api/src/index.ts` — `/tg/onboarding/complete` handler, after `prisma.period.create` |
| `expense_added` | Not started | backend | `apps/api/src/index.ts` — `POST /tg/expenses` handler, after `prisma.expense.create` |
| `dashboard_opened` | Not started | frontend | `apps/web/src/app/miniapp/MiniApp.tsx` — `useEffect` on `screen === 'dashboard'` |
| `pro_purchased` | Not started | backend | `apps/api/src/index.ts` — `/internal/activate-subscription` handler |

---

## Tier 2 — Product Analytics

Implement in Phase 2. These events explain the funnel and user lifecycle.

| Event | Status | Source Layer | Code Touchpoint |
|---|---|---|---|
| `onboarding_started` | Not started | frontend | `apps/web/src/app/miniapp/MiniApp.tsx` — on Welcome screen render (no `onboardingDone` flag) |
| `onboarding_step_completed` | Not started | backend | `apps/api/src/index.ts` — each `/tg/onboarding/*` step handler (steps 1–5) |
| `onboarding_abandoned` | Not started | backend | Requires session-based detection — server-side timeout job or client-side heartbeat |
| `period_started` | Not started | backend | `apps/api/src/cron.ts` — rollover cron, after new period created; also `index.ts` onboarding complete |
| `period_completed` | Not started | backend | `apps/api/src/cron.ts` — rollover cron, after period status set to COMPLETED |
| `period_recalculated` | Not started | backend | `apps/api/src/index.ts` — `POST /tg/periods/recalculate` handler |
| `debt_payment_added` | Not started | backend | `apps/api/src/index.ts` — `POST /tg/debts/:id/payment` handler |
| `s2s_warning_triggered` | Not started | backend | `apps/api/src/index.ts` — dashboard handler, when `s2sStatus` is `WARNING` |
| `s2s_deficit_triggered` | Not started | backend | `apps/api/src/index.ts` — dashboard handler, when `s2sStatus` is `DEFICIT` |
| `expense_deleted` | Not started | backend | `apps/api/src/index.ts` — `DELETE /tg/expenses/:id` handler |
| `pro_screen_opened` | Not started | frontend | `apps/web/src/app/miniapp/MiniApp.tsx` — on `screen === 'pro'` |
| `pro_checkout_opened` | Not started | backend | `apps/api/src/index.ts` — `/tg/billing/pro/checkout` handler |

---

## Tier 3 — Advanced / Later

Implement in Phase 3 or when the underlying features are built.

| Event | Status | Source Layer | Code Touchpoint | Blocker |
|---|---|---|---|---|
| `notification_sent` | Not started | backend | `apps/api/src/cron.ts` — after each `sendTelegramMessage` call | None — low effort |
| `notification_delivery_failed` | Not started | backend | `apps/api/src/notify.ts` — error handler in `sendTelegramMessage` | None |
| `weekly_digest_sent` | Not started | backend | `apps/api/src/cron.ts` — weekly digest cron (not yet built) | GAP-013: feature not implemented |
| `settings_changed` | Not started | backend | `apps/api/src/index.ts` — `PATCH /tg/me/settings` handler | None |
| `payday_changed` | Not started | backend | `apps/api/src/index.ts` — paydays update handler | None |
| `debt_added` | Not started | backend | `apps/api/src/index.ts` — `POST /tg/debts` handler | None |
| `avalanche_plan_viewed` | Not started | frontend | `apps/web/src/app/miniapp/MiniApp.tsx` — on `screen === 'debts'` | None |
| `expense_import_completed` | Not started | backend | Import feature not yet built | Feature not planned |
| `income_added` | Not started | backend | `apps/api/src/index.ts` — `POST /tg/incomes` handler | None |

---

## Full Event Catalogue

### Onboarding

| Event | Trigger | Properties | Tier |
|---|---|---|---|
| `onboarding_started` | User hits Welcome screen (no `onboardingDone`) | `tg_user_id`, `locale`, `timestamp` | Tier 2 |
| `onboarding_step_completed` | User submits each onboarding step (API returns 200) | `step: 1–5`, `step_name`, `tg_user_id` | Tier 2 |
| `onboarding_completed` | `POST /tg/onboarding/complete` returns 200 | `tg_user_id`, `days_total`, `s2s_period_rub`, `is_prorated`, `has_debts`, `has_ef`, `income_count`, `obligation_count`, `debt_count` | Tier 1 |
| `onboarding_abandoned` | Session-based — `onboardingDone=false` with no recent step events | `last_step_reached: 1–5`, `tg_user_id` | Tier 2 |

---

### Dashboard

| Event | Trigger | Properties | Tier |
|---|---|---|---|
| `dashboard_opened` | GET `/tg/dashboard` returns 200 and screen renders | `tg_user_id`, `s2s_status`, `days_left`, `s2s_daily_bucket`, `has_focus_debt`, `ef_funded_pct` | Tier 1 |
| `s2s_warning_triggered` | `s2s_status` becomes `WARNING` (`s2sToday / s2sDaily ≤ 0.3`) | `tg_user_id`, `s2s_today_rub`, `s2s_daily_rub`, `days_left` | Tier 2 |
| `s2s_deficit_triggered` | `s2s_status` is `DEFICIT` | `tg_user_id`, `deficit_amount_rub` | Tier 2 |

**s2s_daily_bucket values:** `<1000`, `1000-3000`, `3000-7000`, `7000-15000`, `15000-30000`, `>30000` (in rub)

---

### Expenses

| Event | Trigger | Properties | Tier |
|---|---|---|---|
| `expense_added` | POST `/tg/expenses` returns 201 | `tg_user_id`, `amount_bucket`, `has_note: boolean`, `source: 'manual'`, `period_days_left`, `s2s_remaining_after` | Tier 1 |
| `expense_deleted` | DELETE `/tg/expenses/:id` returns 200 | `tg_user_id`, `expense_amount_bucket`, `time_since_created_minutes` | Tier 2 |

**amount_bucket values:** `<100`, `100-500`, `500-1000`, `1000-3000`, `3000-10000`, `>10000` (in rub)

---

### Period Lifecycle

| Event | Trigger | Properties | Tier |
|---|---|---|---|
| `period_started` | New period created (onboarding OR cron rollover) | `tg_user_id`, `is_prorated`, `days_total`, `s2s_period_rub`, `s2s_daily_rub`, `income_sources_count`, `has_debts`, `source: 'onboarding'|'rollover'|'recalculate'` | Tier 2 |
| `period_completed` | Period status set to COMPLETED (cron rollover) | `tg_user_id`, `days_total`, `saved_amount_rub`, `overspent_days`, `total_spent_rub`, `s2s_period_rub` | Tier 2 |
| `period_recalculated` | POST `/tg/periods/recalculate` returns 200 | `tg_user_id`, `trigger: 'settings_save'|'payday_changed'|'manual'`, `new_days_total`, `new_s2s_period_rub` | Tier 2 |

---

### Debts

| Event | Trigger | Properties | Tier |
|---|---|---|---|
| `debt_payment_added` | POST `/tg/debts/:id/payment` returns 200 | `tg_user_id`, `debt_id`, `amount_rub`, `is_extra: boolean`, `new_balance_rub`, `is_paid_off: boolean`, `debt_apr` | Tier 2 |
| `debt_added` | POST `/tg/debts` returns 201 | `tg_user_id`, `debt_type`, `balance_rub`, `apr`, `min_payment_rub` | Tier 3 |
| `debt_deleted` | DELETE `/tg/debts/:id` returns 200 | `tg_user_id`, `was_focus_debt: boolean` | Tier 3 |
| `avalanche_plan_viewed` | Debts screen renders | `tg_user_id`, `debts_count`, `estimated_debt_free_months`, `total_debt_rub` | Tier 3 |

---

### Pro / Billing

| Event | Trigger | Properties | Tier |
|---|---|---|---|
| `pro_screen_opened` | User navigates to `pro` screen | `tg_user_id`, `current_plan`, `days_since_onboarding` | Tier 2 |
| `pro_checkout_opened` | POST `/tg/billing/pro/checkout` returns 200 | `tg_user_id`, `stars_amount: 100` | Tier 2 |
| `pro_purchased` | POST `/internal/activate-subscription` called (successful Stars payment) | `tg_user_id`, `stars_amount`, `source: 'telegram_stars'` | Tier 1 |

---

### Notifications

| Event | Trigger | Properties | Tier |
|---|---|---|---|
| `notification_sent` | `sendTelegramMessage` completes without error | `tg_user_id`, `type: 'morning'|'evening'|'payment'|'rollover'|'deficit'`, `delivery_ok: boolean` | Tier 3 |
| `notification_delivery_failed` | `sendTelegramMessage` throws or Telegram API returns error | `tg_user_id`, `type`, `error_code` | Tier 3 |

---

### Settings

| Event | Trigger | Properties | Tier |
|---|---|---|---|
| `settings_changed` | PATCH `/tg/me/settings` returns 200 | `tg_user_id`, `changed_fields: string[]` | Tier 3 |
| `payday_changed` | Paydays updated and period recalculated | `tg_user_id`, `old_paydays: number[]`, `new_paydays: number[]`, `recalculated: boolean` | Tier 3 |
| `income_added` | POST `/tg/incomes` returns 201 | `tg_user_id`, `paydays_count` | Tier 3 |
| `obligation_added` | POST `/tg/obligations` returns 201 | `tg_user_id`, `obligation_type` | Tier 3 |

---

## Super-Properties (Attached to Every Event)

| Property | Source | Notes |
|---|---|---|
| `tg_user_id` | Telegram initData | Hash/anonymize before sending to 3rd-party |
| `platform` | Always `'telegram_mini_app'` | |
| `app_version` | `package.json` version | Expose via API env or build-time env var |
| `locale` | `User.locale` (`'ru'` / `'en'`) | |
| `timestamp` | Event time (ISO 8601) | |
| `session_id` | UUID generated on Mini App mount | Groups events within a session |

---

## Implementation Notes

### Where to Add Tracking

The codebase has three layers where events can be fired:

**1. API layer (`apps/api/src/index.ts`)**
Best for: server-side events that must be reliable (purchases, period transitions, debt payments).

```typescript
// Example: after expense creation
const expense = await prisma.expense.create({ ... });
await track('expense_added', {
  tg_user_id: req.tgUser!.id,
  amount_bucket: amountBucket(expense.amount),
  has_note: !!expense.note,
  source: 'manual',
});
res.status(201).json(expense);
```

**2. Client layer (`apps/web/src/app/miniapp/MiniApp.tsx`)**
Best for: UI interaction events (screen opens, button clicks) where no API call is involved.

```typescript
// Example: dashboard opened
useEffect(() => {
  if (screen === 'dashboard') {
    track('dashboard_opened', {
      s2s_status: data.s2sStatus,
      days_left: data.daysLeft,
    });
  }
}, [screen]);
```

**3. Cron layer (`apps/api/src/cron.ts`)**
Best for: `period_completed`, `notification_sent`.

---

### Recommended Library: PostHog

PostHog is the recommended analytics tool for this project.

**Why PostHog:**
- Self-hostable (important for Russian users / data sovereignty)
- Free tier on posthog.com (up to 1M events/month)
- Works with Node.js and browser
- Product analytics + session replays + feature flags in one tool

**Installation:**

```bash
pnpm add posthog-node --filter api
pnpm add posthog-js --filter web
```

**Server-side setup (`apps/api/src/analytics.ts`):**
```typescript
import { PostHog } from 'posthog-node';

const posthog = new PostHog(process.env.POSTHOG_KEY || '', {
  host: process.env.POSTHOG_HOST || 'https://eu.posthog.com',
  disabled: !process.env.POSTHOG_KEY,
});

export async function track(event: string, properties: Record<string, any>) {
  if (!process.env.POSTHOG_KEY) return;
  posthog.capture({
    distinctId: String(properties.tg_user_id || 'anonymous'),
    event,
    properties,
  });
}
```

**Client-side:** Use `posthog-js` with `posthog.identify(tgUser.id)` on Mini App mount.

---

### Alternative: Structured Logs

If PostHog is premature, a structured log approach requires no new dependencies:

```typescript
console.log(JSON.stringify({
  event: 'expense_added',
  tg_user_id: req.tgUser!.id,
  amount_bucket: amountBucket(amount),
  ts: new Date().toISOString(),
}));
```

Ship logs to a log aggregator (Loki + Grafana, or Logtail). Can be upgraded to PostHog later with minimal code changes — just swap the `track()` function implementation.

---

### Privacy Considerations

- **Do not** log raw expense amounts — use buckets
- **Do not** log expense notes (PII)
- **Do not** send Telegram `first_name` or `username` to 3rd-party analytics services
- Use `tg_user_id` (numeric ID) as the distinct identifier — hash it if sending to a US-hosted service
- Add a "data collection" notice to the onboarding flow if tracking is enabled

---

## Key Funnels

### Onboarding Conversion

```
onboarding_started
→ onboarding_step_completed (step=1)  ← income entered
→ onboarding_step_completed (step=2)  ← obligations
→ onboarding_step_completed (step=3)  ← debts
→ onboarding_step_completed (step=4)  ← EF
→ onboarding_completed                ← first period created
→ expense_added                       ← activation event
→ dashboard_opened (D7)               ← D7 retention signal
```

Expected drop-off points: step 3 (debts — users without debts may skip or be confused) and step 4 (EF — concept unclear without context).

### Free → PRO Conversion

```
dashboard_opened (D14+)
→ pro_screen_opened
→ pro_checkout_opened
→ pro_purchased
```

---

## Events Requiring New Feature Work First

| Event | Blocker |
|---|---|
| `onboarding_abandoned` | Requires session-based detection — client-side session tracking or server-side timeout job |
| `notification_delivery_failed` | Error handling in `sendTelegramMessage` needs to capture Telegram API error codes explicitly |
| `s2s_warning_triggered` | Currently calculated on dashboard fetch — needs an explicit transition detection (status changes from OK to WARNING) |
| `weekly_digest_sent` | `weeklyDigest` cron not implemented (GAP-013) |
| `expense_import_completed` | Import feature not built and not planned for v0.1 |
