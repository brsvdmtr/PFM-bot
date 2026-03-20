# Analytics Tracking Plan

**Project:** PFM Bot — Safe to Spend
**Version:** v0.1 MVP
**Last updated:** 2026-03-20
**Status:** Planned — not yet implemented

---

## Status legend

| Icon | Meaning |
|---|---|
| ✅ | Implemented |
| 🔲 | TODO — not implemented |
| 🔲❗ | TODO — high priority |

All events below are **TODO** unless marked otherwise. The codebase currently has no analytics instrumentation.

---

## Event Catalogue

### Onboarding

| Event | Trigger | Properties | Priority |
|---|---|---|---|
| `onboarding_started` | User hits the Welcome screen for the first time (no `onboardingDone` flag) | `tg_user_id`, `locale`, `timestamp` | ❗ High |
| `onboarding_step_completed` | User submits each onboarding step successfully (API returns 200) | `step: 1–5`, `step_name: 'income'|'obligations'|'debts'|'ef'|'complete'`, `tg_user_id` | ❗ High |
| `onboarding_completed` | POST `/onboarding/complete` returns 200 | `tg_user_id`, `days_total`, `s2s_period_rub`, `is_prorated`, `has_debts`, `has_ef`, `income_count`, `obligation_count`, `debt_count` | ❗ High |
| `onboarding_abandoned` | User drops off — detected on next session if `onboardingDone=false` and no recent step events | `last_step_reached: 1–5`, `tg_user_id` | Medium |

---

### Dashboard

| Event | Trigger | Properties | Priority |
|---|---|---|---|
| `dashboard_opened` | GET `/tg/dashboard` returns 200 and screen renders | `tg_user_id`, `s2s_status: 'OK'|'WARNING'|'OVERSPENT'|'DEFICIT'`, `days_left`, `s2s_daily_bucket` (see buckets below), `has_focus_debt`, `ef_funded_pct` | ❗ High |
| `s2s_warning_triggered` | `s2s_status` becomes `WARNING` (s2sToday / s2sDaily ≤ 0.3) | `tg_user_id`, `s2s_today_rub`, `s2s_daily_rub`, `days_left` | ❗ High |
| `s2s_deficit_triggered` | `s2s_status` is `DEFICIT` (s2sPeriod ≤ 0) | `tg_user_id`, `deficit_amount_rub` (abs value of residual) | ❗ High |

**s2s_daily_bucket values:** `<1000`, `1000-3000`, `3000-7000`, `7000-15000`, `15000-30000`, `>30000` (in rub)

---

### Expenses

| Event | Trigger | Properties | Priority |
|---|---|---|---|
| `expense_added` | POST `/tg/expenses` returns 201 | `tg_user_id`, `amount_bucket` (see below), `has_note: boolean`, `source: 'manual'`, `period_days_left`, `s2s_remaining_after` (s2sToday after adding expense) | ❗ High |
| `expense_deleted` | DELETE `/tg/expenses/:id` returns 200 | `tg_user_id`, `expense_amount_bucket`, `time_since_created_minutes` | Medium |

**amount_bucket values:** `<100`, `100-500`, `500-1000`, `1000-3000`, `3000-10000`, `>10000` (in rub)

---

### Period lifecycle

| Event | Trigger | Properties | Priority |
|---|---|---|---|
| `period_started` | New period created (onboarding complete OR cron rollover) | `tg_user_id`, `is_prorated: boolean`, `days_total`, `s2s_period_rub`, `s2s_daily_rub`, `income_sources_count`, `has_debts`, `source: 'onboarding'|'rollover'|'recalculate'` | ❗ High |
| `period_completed` | Period status set to COMPLETED (cron rollover) | `tg_user_id`, `days_total`, `saved_amount_rub` (positive = saved, negative = overspent), `overspent_days`, `total_spent_rub`, `s2s_period_rub` | ❗ High |
| `period_recalculated` | POST `/tg/periods/recalculate` returns 200 | `tg_user_id`, `trigger: 'settings_save'|'payday_changed'|'manual'`, `new_days_total`, `new_s2s_period_rub` | Medium |

---

### Debts

| Event | Trigger | Properties | Priority |
|---|---|---|---|
| `debt_payment_added` | POST `/tg/debts/:id/payment` returns 200 | `tg_user_id`, `debt_id`, `amount_rub`, `is_extra: boolean`, `new_balance_rub`, `is_paid_off: boolean`, `debt_apr` | ❗ High |
| `debt_added` | POST `/tg/debts` returns 201 | `tg_user_id`, `debt_type`, `balance_rub`, `apr`, `min_payment_rub` | Medium |
| `debt_deleted` | DELETE `/tg/debts/:id` returns 200 | `tg_user_id`, `was_focus_debt: boolean` | Low |
| `avalanche_plan_viewed` | GET `/tg/debts/avalanche-plan` renders plan | `tg_user_id`, `debts_count`, `estimated_debt_free_months`, `total_debt_rub` | Medium |

---

### Pro / Billing

| Event | Trigger | Properties | Priority |
|---|---|---|---|
| `pro_screen_opened` | User navigates to `pro` screen | `tg_user_id`, `current_plan: 'FREE'|'PRO'`, `days_since_onboarding` | ❗ High |
| `pro_checkout_opened` | POST `/tg/billing/pro/checkout` returns 200 (invoice URL created) | `tg_user_id`, `stars_amount: 100` | ❗ High |
| `pro_purchased` | POST `/internal/activate-subscription` called (successful Stars payment) | `tg_user_id`, `stars_amount`, `source: 'telegram_stars'` | ❗ High |

---

### Notifications

| Event | Trigger | Properties | Priority |
|---|---|---|---|
| `notification_sent` | Each call to `sendTelegramMessage` completes without error | `tg_user_id`, `type: 'morning'|'evening'|'payment'|'rollover'|'deficit'`, `s2s_status` (for morning/evening), `delivery_ok: boolean` | Medium |
| `notification_delivery_failed` | `sendTelegramMessage` throws or Telegram API returns error | `tg_user_id`, `type`, `error_code` | Medium |

---

### Settings

| Event | Trigger | Properties | Priority |
|---|---|---|---|
| `settings_changed` | PATCH `/tg/me/settings` returns 200 | `tg_user_id`, `changed_fields: string[]` (e.g. `['morningNotifyTime', 'paymentAlerts']`) | Medium |
| `payday_changed` | Paydays updated and period recalculated | `tg_user_id`, `old_paydays: number[]`, `new_paydays: number[]`, `recalculated: boolean` | Medium |
| `income_added` | POST `/tg/incomes` returns 201 | `tg_user_id`, `paydays_count` | Low |
| `obligation_added` | POST `/tg/obligations` returns 201 | `tg_user_id`, `obligation_type` | Low |

---

## Properties shared across all events (super-properties)

These should be attached to every event automatically:

| Property | Source | Notes |
|---|---|---|
| `tg_user_id` | Telegram initData | Hash/anonymize before sending to 3rd party |
| `platform` | Always `'telegram_mini_app'` | |
| `app_version` | Package.json version | <!-- TODO: expose via API or env --> |
| `locale` | User.locale (`'ru'`/`'en'`) | |
| `timestamp` | Event time (ISO8601) | |
| `session_id` | UUID generated on Mini App mount | Helps group events in a session |

---

## Implementation Notes

### Where to add tracking

The codebase has two layers where events can be fired:

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
Best for: UI interaction events (screen opens, button clicks), where API call is not involved.

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
Best for: period_completed, notification_sent.

---

### Recommended library: PostHog

PostHog is the recommended analytics tool for this project.

**Why PostHog:**
- Self-hostable (important for Russian users / data sovereignty)
- Free tier available on posthog.com (up to 1M events/month)
- Works with Node.js and browser
- Product analytics + session replays + feature flags in one

**Installation:**

```bash
# API / cron (server-side)
pnpm add posthog-node --filter api

# Web (client-side)
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

**Client-side setup:** Use `posthog-js` with `posthog.identify(tgUser.id)` on Mini App mount.

---

### Alternative: Simple structured logs

If PostHog is overkill for the early stage, a structured log approach works:

```typescript
// In any handler:
console.log(JSON.stringify({
  event: 'expense_added',
  tg_user_id: req.tgUser!.id,
  amount_bucket: amountBucket(amount),
  ts: new Date().toISOString(),
}));
```

Then ship logs to a log aggregator (Loki + Grafana, or Logtail). This requires no new dependencies and can be upgraded to PostHog later.

---

### Privacy considerations

- **Do not** log raw expense amounts — use buckets
- **Do not** log expense notes (PII)
- **Do not** send Telegram `first_name` or `username` to 3rd-party analytics
- Use `tg_user_id` (numeric ID) as the distinct identifier — this is not PII under most frameworks, but hash it if sending to a US-hosted service
- Add a "data collection" notice to the onboarding if tracking is enabled

---

### Funnel: Onboarding conversion

Key funnel to monitor in PostHog:

```
onboarding_started
→ onboarding_step_completed (step=1)  ← income entered
→ onboarding_step_completed (step=2)  ← obligations
→ onboarding_step_completed (step=3)  ← debts
→ onboarding_step_completed (step=4)  ← EF
→ onboarding_completed                ← first period created
→ expense_added                       ← first expense (activation)
→ dashboard_opened (D7)               ← retention
```

Expected drop-off points: step 3 (debts — users without debts may skip or be confused) and step 4 (EF — concept unclear).

---

### Funnel: Free → PRO conversion

```
dashboard_opened (D14+)
→ pro_screen_opened
→ pro_checkout_opened
→ pro_purchased
```

---

## Events not yet in code (requires new API/UI touchpoints)

| Event | What needs to be built first |
|---|---|
| `onboarding_abandoned` | Session-based detection — needs client-side session tracking or a server-side timeout job |
| `notification_delivery_failed` | Error handling in `sendTelegramMessage` needs to capture Telegram API error codes |
| `s2s_warning_triggered` | Currently calculated on dashboard fetch — needs explicit trigger event when status transitions from OK to WARNING |
| `weekly_digest_sent` | `weeklyDigest` cron not yet implemented |
| `expense_import_completed` | Import feature not yet built |
