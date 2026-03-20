---
title: "Analytics Tracking Plan"
document_type: Informational
status: Draft
source_of_truth: NO
verified_against_code: NO
last_updated: "2026-03-20"
related_docs:
  - path: north-star-product-spec.md
    relation: "product spec and north star metric"
  - path: gap-analysis.md
    relation: "known gaps, including analytics gap"
---

# Analytics Tracking Plan

**Project:** PFM Bot — Safe to Spend
**Version:** v0.1 MVP
**Last updated:** 2026-03-20

---

## 1. Overview

**Current state: NO analytics instrumentation is implemented.**

The codebase has zero analytics tracking as of 2026-03-20. No events are fired, no analytics backend is connected, no user behavior data is collected. All events in this document are planned but not built.

This means:
- Onboarding completion rate is unknown
- Retention (D7, D30) is unknown
- Expense logging frequency is unknown
- PRO conversion funnel is unobservable

The north star metric (DAU × % users staying within S2S limit) cannot be measured until at minimum the P0 events below are implemented.

---

## 2. Must-Have Now (P0)

Events needed immediately to establish minimum product health visibility. These 5 events should be implemented before any other analytics work.

| Event | Trigger | Properties | Source layer | Status |
|-------|---------|------------|--------------|--------|
| `onboarding_completed` | POST /tg/onboarding/complete success | userId, currency, paydays_count, has_debts, has_ef | API | ❌ Not implemented |
| `expense_added` | POST /tg/expenses success | amount_bucket (0-500/500-2k/2k-10k/10k+), has_note | API | ❌ Not implemented |
| `dashboard_viewed` | GET /tg/dashboard success | s2s_status, daysLeft_bucket | API | ❌ Not implemented |
| `period_rolled_over` | Cron rollover completes | prev_period_saved_amount, new_s2s_daily | Cron | ❌ Not implemented |
| `notification_sent` | Morning/evening/payment alert sent | type (morning/evening/payment/rollover), user_timezone | Cron | ❌ Not implemented |

**amount_bucket values:** `0-500`, `500-2000`, `2000-10000`, `10000+` (in rubles)
**daysLeft_bucket values:** `1-3`, `4-7`, `8-15`, `15+`

---

## 3. Product Analytics (P1)

Events needed to understand the product funnel and user lifecycle. Implement after P0.

| Event | Trigger | Properties | Status |
|-------|---------|------------|--------|
| `expense_deleted` | DELETE /tg/expenses/:id success | amount_bucket, time_since_creation_minutes | ❌ Not implemented |
| `income_updated` | POST/PATCH /tg/incomes + recalculate triggered | triggered_recalculate: boolean | ❌ Not implemented |
| `debt_payment_made` | POST /tg/debts/:id/payment success | is_extra, percent_of_balance | ❌ Not implemented |
| `pro_checkout_initiated` | POST /tg/billing/pro/checkout | stars_amount | ❌ Not implemented |
| `pro_subscription_activated` | POST /internal/activate-subscription success | stars_amount, source | ❌ Not implemented |
| `period_recalculated` | POST /tg/periods/recalculate success | trigger (manual/payday_change/income_change), new_s2s_daily | ❌ Not implemented |
| `onboarding_step_completed` | Each /tg/onboarding/* step handler success | step_number (1-5), step_name | ❌ Not implemented |

---

## 4. Monetization Events (P1)

| Event | Trigger | Properties | Status |
|-------|---------|------------|--------|
| `pro_checkout_initiated` | User taps "Subscribe" on PRO screen | — | ❌ Not implemented |
| `pro_subscription_activated` | Successful Telegram Stars payment processed | chargeId, amount_stars | ❌ Not implemented |
| `subscription_expired` | Subscription expiry | — | ❌ Not implemented — no expiry flow exists yet |

**Note on `subscription_expired`:** There is currently no subscription expiry flow in the codebase. The subscription activates for 30 days but there is no cron job or handler that processes expiry. This event cannot be implemented until the expiry flow is built.

---

## 5. Implementation Roadmap

### Step 1: Choose analytics backend

**Recommended: PostHog**
- Self-hostable (important for Russian users / data sovereignty)
- Free tier up to 1M events/month on posthog.com
- Works with Node.js and browser
- Product analytics + feature flags in one tool

**Alternative: Structured logs**
If PostHog is premature, emit structured JSON logs from the API:
```
{"event":"expense_added","amount_bucket":"500-2000","has_note":true,"ts":"..."}
```
Forward to a log aggregator (Loki + Grafana). Can be upgraded to PostHog later by swapping the `track()` function.

### Step 2: Add event emission to API handlers

Target file: `apps/api/src/index.ts`

Add a `track(event, properties)` function. Call it after successful DB writes in the relevant handlers. Start with P0 events only.

### Step 3: Add event emission to cron

Target file: `apps/api/src/cron.ts`

Emit `period_rolled_over` and `notification_sent` from the rollover and notification crons.

### Step 4: Privacy configuration

Before going live with any analytics:
- Do not log raw expense amounts — use buckets
- Do not log expense notes (user-entered text — potential PII)
- Do not send Telegram `first_name` or `username` to third-party analytics services
- Use numeric `tg_user_id` as the distinct identifier; hash it if sending to a US-hosted service
- Add a data collection notice to onboarding if any third-party service is used

---

## 6. Privacy Constraints

| Data | Can track | Notes |
|------|-----------|-------|
| tg_user_id (numeric) | Yes | Hash before sending to third-party |
| Expense amount | Bucketed only | Never raw amounts |
| Expense note | No | User-entered text, potential PII |
| Telegram first_name / username | No | Do not send to third-party |
| S2S status (OK/WARNING/etc) | Yes | Enum, no PII |
| daysLeft, periodSpent bucket | Yes | Aggregated/bucketed |
| IP address | Avoid | Use userId-scoped events instead |
