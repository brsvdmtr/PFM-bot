---
title: "North Star Product Spec: PFM Bot — Safe to Spend"
document_type: Normative
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - path: ../system/formulas-and-calculation-policy.md
    relation: "canonical formula source"
  - path: gap-analysis.md
    relation: "known gaps registry"
  - path: faq-mvp.md
    relation: "user-facing explanation"
  - path: how-we-calculate-copy.md
    relation: "user-facing calculation copy"
---

# North Star Product Spec: PFM Bot — Safe to Spend

**Version:** v0.1 MVP
**Last updated:** 2026-03-20
**Status:** Active development

> This document is NOT the source of truth for calculation formulas.
> For canonical formula definitions see: [formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md)

---

## 1. Product Vision

One number. One question answered.

> **«Можно сегодня» — Safe to Spend Today**

A person opens Telegram, taps once, and sees a single number: how much they can spend today without violating any of their financial goals. No spreadsheets. No categories. No manual planning.

PFM-bot is the financial operating system for people who need one clear daily answer: **"Can I spend 3000₽ today?"**

---

## 2. Target Users

### Primary (v0.1)
- Age 25–40, Russia
- Income: 60 000 — 250 000 ₽/month
- Paid 1–2 times per month (advance + main salary)
- Has at least one consumer loan or credit card
- Uses Telegram daily
- Does not track budget, or quit after 2–3 weeks

### Secondary
- Freelancers with irregular income (not yet supported — engine ignores `IRREGULAR` frequency)
- Couples where one person manages the shared budget
- People actively paying off a mortgage or auto loan

### Not target (v0.1)
- Business owners with business expenses
- Investors (no investment module)
- Users with multiple simultaneous currencies

**Key insight:** These users are not accountants. They are not investors. They are everyday spenders who need a single daily decision helper, not a full budgeting system.

---

## 3. Core Value Proposition

PFM-bot is **not** a budget tracker.

It is a **daily decision helper**.

The difference:
- A budget tracker records what happened and shows categories.
- PFM-bot tells you what you can do right now.

The S2S number already accounts for:
- All upcoming mandatory payments in the current period
- Minimum debt payments
- A 10% reserve buffer (silent, not explained to the user)
- Emergency fund contributions (until target is reached)
- Extra payment toward the highest-APR debt (avalanche strategy)
- Carry-over: yesterday's overspending reduces today's limit

The user does not need to understand any of this. They see one number and act on it.

---

## 4. Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| Onboarding (income, obligations, debts, EF) | ✅ Implemented | Replaces all data on re-run |
| Dashboard with S2S Today | ✅ Implemented | Carry-over mechanism |
| Expense logging | ✅ Implemented | Manual, quick add |
| Delete expense | ✅ Implemented | |
| Period rollover (auto) | ✅ Implemented | Cron at 00:05 UTC, ~UTC offset gap |
| Morning notifications | ✅ Implemented | Per-user timezone, in-memory dedup |
| Evening notifications | ✅ Implemented | |
| Payment due alerts | ✅ Implemented | For debts with dueDay |
| Debt tracking (avalanche) | ✅ Implemented | isFocusDebt, APR-based |
| Emergency fund tracking | ✅ Implemented | Target = obligations * targetMonths |
| PRO subscription (Telegram Stars) | ✅ Implemented | 100 stars/month |
| Two-payday income support | ✅ Implemented (fixed Mar 2026) | triggerPayday algorithm |
| Settings (notification times, toggles) | ✅ Implemented | |
| Payday editor in Settings | ✅ Implemented | Triggers recalculate |
| Income management (add/edit/delete) | ✅ Implemented | |
| Period history (last completed) | ✅ Implemented | |
| Avalanche debt plan | ✅ Implemented | GET /tg/debts/avalanche-plan |
| Analytics / Charts | ❌ Not implemented | Planned post-MVP |
| Expense export | ❌ Not implemented | Planned, PRO feature |
| Category tags on expenses | ❌ Not implemented | Planned |
| Weekly digest | ❌ Not implemented (settings field exists) | Setting saved to DB but cron not built |
| /delete user data bot command | ❌ Not implemented | GAP-008, P1 |
| Multi-currency | ⚠️ Partial | RUB/USD enum, no conversion |

---

## 5. Known Product Gaps

Full gap registry: [gap-analysis.md](gap-analysis.md)

High-priority gaps that affect user trust or compliance:

- **GAP-001**: Trigger payday not persisted in Period record — cannot audit which income fired for a given period
- **GAP-003**: Notification dedup lost on container restart — morning notification may be sent twice in one day after a deploy
- **GAP-004**: Period rollover timing off by UTC offset — Moscow users (UTC+3) get new period at 03:05 local time, not midnight
- **GAP-007**: EF contribution does not auto-resume after target change — requires manual recalculate
- **GAP-008**: /delete user data not implemented — compliance risk, P1

---

## 6. Product Principles

**Show one number prominently**
The "Можно сегодня" figure is the product. Everything else is secondary context.

**Never show negative money to the user**
S2S Today is floored at 0. The user sees 0, not -500₽. Status indicators (WARNING, OVERSPENT, DEFICIT) communicate the problem without showing a negative number.

**Carry-over by default**
Yesterday's overspending matters. The daily limit is always recalculated as `(period remaining) / (days left)`. There is no "reset" at midnight; the period budget is a running total.

**Reserve is silent**
The 10% reserve buffer is applied automatically and never displayed to the user as a line item. It simply reduces the available daily limit. Users who ask "why is my limit lower than expected?" can read the FAQ; the main UI never explains it proactively.

**Honest about deficit**
When obligations exceed income, the app shows DEFICIT status and S2S = 0. It does not hide the problem or show misleading positive numbers.

**Minimal input, maximum insight**
The onboarding takes 5 steps. After that, the user only logs expenses. Everything else (period creation, rollover, S2S recalculation) is automatic.

---

## 7. Monetization

**FREE plan (all users):**
- Full S2S calculation
- Unlimited expense logging
- Current period history
- Morning/evening notifications
- Debt and emergency fund tracking

**PRO plan (100 XTR / month):**
- Payment gateway: Telegram Stars (XTR) — **implemented**
- Subscription period: 30 days from payment — **implemented**
- PRO-exclusive features (analytics, export): **not yet implemented**
- API-level gate enforcement: **not yet implemented** (GAP-020)

Users who have paid for PRO receive `isPro: true` flag but currently get no additional capabilities beyond the free plan. This will be resolved when PRO-exclusive features are built.

---

## 8. North Star Metric

**DAU opening dashboard** × **% of users who stay within S2S limit for the full period**

Supporting metrics:
- Retention D7 / D30
- Onboarding completion rate (step 1 → step 5)
- Average expense-logging frequency per day per user
- % of periods completed without deficit

**Collection status:** No metric is currently instrumented. Analytics not implemented. See [tracking-plan.md](tracking-plan.md).
