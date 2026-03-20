---
title: "Numerical Source of Truth"
document_type: Normative
status: Active
source_of_truth: YES
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./formulas-and-calculation-policy.md
    relation: "formulas defined there"
  - path: ./glossary.md
    relation: "term definitions"
  - path: ./system-spec-v1.md
    relation: "system context"
---

# Numerical Source of Truth

This document answers: "When the UI shows a number X, where does that number come from, and what value wins when there is a conflict?"

For each number displayed in the dashboard or stored in the DB, this document states the computation path from raw data to displayed value. When investigating a discrepancy, start with the **Source of Truth Hierarchy** (Section 4) and trace back through the relevant entry in Section 2.

For exact formulas, see `./formulas-and-calculation-policy.md`.

---

## 1. Number-by-Number Reference

---

### 1.1 s2sToday — "Можно сегодня"

| Property | Value |
|----------|-------|
| Russian UI label | Main number in dashboard header; "Safe to Spend сегодня" in morning notification |
| API field | `s2sToday` in `GET /tg/dashboard` response |
| Computed in | `index.ts`, `GET /tg/dashboard` handler |
| Persisted | No — never written to DB |
| Formula | `max(0, dynamicS2sDaily - todayTotal)` |
| Depends on | `activePeriod.s2sPeriod`, `totalPeriodSpent`, `todayTotal`, `daysLeft` |
| Minimum value | 0 (never negative in API response) |
| Invalidated by | Any new expense, any expense deletion, passage of time (UTC midnight resets `todayTotal`) |
| Authoritative source when conflict | API response (`GET /tg/dashboard`) |

**How to verify manually:**

```sql
-- Get active period
SELECT id, s2s_period, end_date FROM "Period"
WHERE status = 'ACTIVE' AND user_id = '<userId>';

-- Get total period expenses
SELECT SUM(amount) FROM "Expense" WHERE period_id = '<periodId>';

-- Get today's expenses (UTC midnight)
SELECT SUM(amount) FROM "Expense"
WHERE period_id = '<periodId>'
  AND spent_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
```

Then apply:
```
daysLeft         = max(1, ceil((endDate - now) / 86400000))
periodRemaining  = max(0, s2sPeriod - totalPeriodSpent)
dynamicS2sDaily  = max(0, round(periodRemaining / daysLeft))
s2sToday         = max(0, dynamicS2sDaily - todayTotal)
```

**Common confusion:** Users expect `s2sToday` to equal the original daily budget set at period creation. It does not — it is always derived from the current remaining balance. See carry-over in §1.9.

**Edge case:** If `todayTotal > dynamicS2sDaily`, `s2sToday = 0` (floored). The API never returns a negative value for this field.

---

### 1.2 dynamicS2sDaily — "Дневной лимит"

| Property | Value |
|----------|-------|
| Russian UI label | "из дневного лимита" in morning notification; "Дневной лимит" in evening notification and dashboard |
| API field | `s2sDaily` in `GET /tg/dashboard` response |
| Computed in | `index.ts`, `GET /tg/dashboard` handler |
| Persisted | No — computed fresh on every request |
| Formula | `max(0, round(max(0, s2sPeriod - totalPeriodSpent) / daysLeft))` |
| Depends on | `activePeriod.s2sPeriod`, `totalPeriodSpent`, `daysLeft` |
| Invalidated by | Any expense, passage of time (daily at UTC midnight) |
| Authoritative source when conflict | API response |

**Critical:** The `s2sDaily` returned by `GET /tg/dashboard` is **NOT** read from `Period.s2sDaily` in the DB. It is computed dynamically on every request. The stored `Period.s2sDaily` is a stale snapshot from period creation.

**daysLeft computation in dashboard (`index.ts`):**

```typescript
const daysElapsed     = Math.max(1, Math.ceil((now.getTime() - activePeriod.startDate.getTime()) / msPerDay));
const daysLeft        = Math.max(1, activePeriod.daysTotal - daysElapsed + 1);
const periodRemaining = Math.max(0, activePeriod.s2sPeriod - totalPeriodSpent);
const dynamicS2sDaily = Math.max(0, Math.round(periodRemaining / daysLeft));
```

**Edge case:** If `totalPeriodSpent >= s2sPeriod`, `periodRemaining = 0` and `dynamicS2sDaily = 0`.

---

### 1.3 Period.s2sDaily — Stored Snapshot (Not Live)

| Property | Value |
|----------|-------|
| Russian UI label | Used in last completed period summary |
| API field | `s2sDaily` in `GET /tg/periods/last-completed` response |
| Computed in | Written at period creation (onboarding, rollover, recalculate) |
| Persisted | Yes — `Period.s2sDaily` column |
| Formula at creation | `max(0, round(s2sPeriod / daysTotal))` with `totalExpenses = 0` |
| When stale | Immediately after the first expense is logged |
| Authoritative source when conflict | Do NOT use for live calculations. Use `dynamicS2sDaily` from API. |

This value provides a reference point for period summaries and historical comparisons. If the user spent significantly less than this snapshot value suggests, the difference approximates their savings for the period.

**Do not use** `Period.s2sDaily` to compute current safe-to-spend. It does not reflect accumulated expenses.

---

### 1.4 s2sPeriod — "Бюджет периода"

| Property | Value |
|----------|-------|
| Russian UI label | "Бюджет периода" |
| API field | `s2sPeriod` in `GET /tg/dashboard` and `GET /tg/periods/current` |
| Computed in | `engine.ts` `calculateS2S`, written to DB at period creation/recalculate |
| Persisted | Yes — `Period.s2sPeriod` column |
| Formula | `max(0, totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool)` |
| When stale | After income/obligation/debt changes if recalculate is not called |
| What does NOT change it | Adding or deleting expenses |
| Authoritative source when conflict | DB `Period.s2sPeriod` (most recently written at recalculate or period creation) |

`s2sPeriod` is the budget cap for the period, not the remaining balance. To get remaining balance: `max(0, s2sPeriod - totalPeriodSpent)`.

```sql
SELECT s2s_period FROM "Period" WHERE status = 'ACTIVE' AND user_id = '<userId>';
```

---

### 1.5 periodRemaining — "Осталось в периоде"

| Property | Value |
|----------|-------|
| Russian UI label | "Осталось в периоде" |
| API field | Returned implicitly; `periodSpent` is explicit in API response |
| Computed in | `index.ts` dashboard: `max(0, activePeriod.s2sPeriod - totalPeriodSpent)` |
| Persisted | No — derived on every request |
| Formula | `max(0, s2sPeriod - totalPeriodSpent)` |
| Depends on | `Period.s2sPeriod` (persisted), `totalPeriodSpent` (live aggregate) |
| Minimum value | 0 for display purposes |
| Authoritative source | Compute from `s2sPeriod - totalPeriodSpent` at request time |

Note: In the engine (`engine.ts` return value), `periodRemaining` is used without flooring for the `s2sDaily` calculation, but floored at 0 in the returned result. The dashboard also floors at 0 before dividing by `daysLeft`.

**Manual verification:**

```sql
SELECT p.s2s_period - COALESCE(SUM(e.amount), 0) AS period_remaining
FROM "Period" p
LEFT JOIN "Expense" e ON e.period_id = p.id
WHERE p.status = 'ACTIVE' AND p.user_id = '<userId>'
GROUP BY p.s2s_period;
```

---

### 1.6 totalPeriodSpent — "Потрачено за период"

| Property | Value |
|----------|-------|
| Russian UI label | "Потрачено за период" |
| API field | `periodSpent` in `GET /tg/dashboard` |
| Computed in | `index.ts`: `prisma.expense.aggregate({ where: { userId, period: { status: 'ACTIVE' } }, _sum: { amount: true } })` |
| Persisted | No — aggregated live from Expense table |
| Formula | `SUM(Expense.amount)` where `expense.periodId` links to the ACTIVE period |
| Invalidated by | Any expense create/delete |
| Authoritative source | Live DB aggregate at request time |

**Filtering note:** The aggregate uses `period: { status: 'ACTIVE' }` as a join condition, not `periodId = activePeriod.id`. These are equivalent under invariant #2 (one ACTIVE period per user). If a bug creates two ACTIVE periods, this aggregate would sum both.

```sql
SELECT SUM(e.amount)
FROM "Expense" e
JOIN "Period" p ON p.id = e.period_id
WHERE p.user_id = '<userId>' AND p.status = 'ACTIVE';
```

---

### 1.7 expensesToday — "Потрачено сегодня"

| Property | Value |
|----------|-------|
| Russian UI label | "Потрачено сегодня" |
| API field | `todayTotal` (sum) and `todayExpenses` (list) in `GET /tg/dashboard` |
| Computed in | `index.ts`: `prisma.expense.aggregate` + `prisma.expense.findMany` with `spentAt >= UTC midnight` |
| Persisted | No — aggregated live |
| Formula | `SUM(Expense.amount)` where `spentAt >= new Date(new Date().setHours(0,0,0,0))` |
| Timezone | **UTC** — "today" is UTC midnight, not user's local midnight |
| Invalidated by | Any expense create/delete with today's `spentAt` |

**Timezone pitfall:** For a Moscow user (+3), UTC midnight is 03:00 MSK. Expenses logged between 00:00 and 02:59 MSK appear as "yesterday UTC" and are NOT counted in `todayTotal`. The dashboard will count them when the expense list is filtered by UTC midnight.

```sql
SELECT SUM(amount) AS today_total
FROM "Expense"
WHERE user_id = '<userId>'
  AND spent_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
```

**Edge case:** `todayTotal` returned as `0` if no expenses today, never `null` (the API coalesces to 0).

---

### 1.8 daysLeft

| Property | Value |
|----------|-------|
| API field | `daysLeft` in `GET /tg/dashboard` |
| Computed in | `index.ts` dashboard handler |
| Persisted | No — computed per request |
| Formula | `max(1, daysTotal - daysElapsed + 1)` where `daysElapsed = max(1, ceil((now - startDate) / msPerDay))` |
| Minimum | 1 (prevents division by zero) |
| Authoritative source | API response at request time |

**Note:** `Period.daysTotal` (persisted) is the total days at period creation and does not change as time passes. It is returned in the dashboard response as `daysTotal`.

**Difference from engine formula:** The engine uses `daysTotal - daysElapsed + 1` based on stored `daysTotal`. The dashboard uses the same formula. An older version used `ceil((endDate - now) / msPerDay)` — the current code uses the `daysTotal - daysElapsed + 1` formulation. These can differ by 1 near period boundaries.

**Edge case:** On the last day of the period, `daysLeft = 1`. `dynamicS2sDaily` then equals all remaining `periodRemaining` (the full unspent balance, potentially large if under-budget).

---

### 1.9 Carry-Over (Implicit)

Carry-over is not a stored field and does not appear as a named value in the API response. It is an emergent property of the `periodRemaining / daysLeft` formula.

**How carry-over manifests:**
- Under-spending on day N → `periodRemaining` is larger than expected → `dynamicS2sDaily` on day N+1 is higher
- Overspending on day N → `periodRemaining` is smaller → `dynamicS2sDaily` on day N+1 is lower

**To observe carry-over:**
1. Compare `GET /tg/dashboard` `s2sDaily` on day 2 with `Period.s2sDaily` (the stored snapshot from day 1).
2. The difference is the carry-over effect.

**No explicit field exists for carry-over amount.** The entire mechanism is implicit in `dynamicS2sDaily`.

---

### 1.10 DailySnapshot.s2sActual

| Property | Value |
|----------|-------|
| DB field | `DailySnapshot.s2sActual` |
| Written by | `cron.ts` Cron 2, at 23:55 UTC every day |
| Formula | `s2sPlanned - todayTotal` where `s2sPlanned = dynamicS2sDaily` at 23:55 UTC |
| Persisted | Yes — upsert by `(periodId, date)` |
| Floor at 0 | **No** — can be negative if overspent |
| Purpose | Historical record of day-end state |

**Critical difference from live `s2sToday`:**

| | `DailySnapshot.s2sActual` | Live `s2sToday` |
|-|-|-|
| When captured | 23:55 UTC | On demand |
| Floored at 0 | No (can be negative) | Yes (`max(0, ...)`) |
| Purpose | Historical record | Current decision support |

A day where `s2sActual = -500,000` means the user overspent by 5,000 ₽ by 23:55 UTC. The live dashboard showed `s2sToday = 0` for the same moment.

```sql
SELECT date, s2s_planned, s2s_actual, total_expenses, is_overspent
FROM "DailySnapshot"
WHERE period_id = '<periodId>'
ORDER BY date DESC;
```

---

### 1.11 emergencyFund.targetAmount (Derived)

| Property | Value |
|----------|-------|
| API field | `efTarget` or computed from `monthlyObligations * targetMonths` |
| Computed in | `engine.ts` Step 9, also derivable at display time |
| Persisted | No — always derived at calculation time |
| Formula | `SUM(Obligation.amount) * EmergencyFund.targetMonths` |
| Uses prorated obligations | **No** — always uses full monthly obligation sum |

**Edge case:** If the user has no obligations, `efTarget = 0` and `efDeficit = 0`. No EF contribution is needed.

---

### 1.12 emergencyFund.currentAmount

| Property | Value |
|----------|-------|
| API field | `currentAmount` in `GET /tg/ef` or embedded in dashboard |
| Persisted | Yes — `EmergencyFund.currentAmount` column |
| Updated by | Manual update via `PATCH /tg/ef` |
| Updated automatically | Never — the engine does not write to this field |

**Important:** The engine reads `EmergencyFund.currentAmount` to compute `efDeficit`, but never writes it. If the user actually moves money into their emergency fund and does not update this field via the API, the engine will continue computing contributions as if the EF is unfunded.

---

### 1.13 focusDebt

| Property | Value |
|----------|-------|
| API field | Returned in debt list with `isFocusDebt: true` |
| Selected in | `engine.ts`: `activeDebts.find(d => d.isFocusDebt)` |
| Persisted | `Debt.isFocusDebt` column — set by `determineFocusDebt()` |
| Selection logic | First debt where `isFocusDebt = true` in the `activeDebts` array |
| Constraint | Only one debt per user should have `isFocusDebt = true` at any time |

**Edge case:** If no debt has `isFocusDebt = true`, `focusDebt = undefined` and `avalanchePool = 0`. If multiple debts have `isFocusDebt = true` (data integrity issue), `find()` returns the first one encountered.

---

## 2. Persisted Snapshots vs Runtime Values

This table summarizes which values are snapshots (written once at period creation) vs always recomputed.

| Value | Stored in DB | Authoritative at Runtime |
|-------|-------------|--------------------------|
| `Period.s2sPeriod` | Yes (snapshot) | DB value — **does not change with expenses** |
| `Period.s2sDaily` | Yes (snapshot) | DB value — stale; **do not use for live display** |
| `Period.totalIncome` | Yes (snapshot) | DB value |
| `Period.totalObligations` | Yes (snapshot) | DB value |
| `Period.totalDebtPayments` | Yes (snapshot) | DB value |
| `Period.efContribution` | Yes (snapshot) | DB value |
| `Period.reserve` | Yes (snapshot) | DB value |
| `Period.daysTotal` | Yes (snapshot) | DB value — does not decrease over time |
| `dynamicS2sDaily` | No | API response (computed per request) |
| `s2sToday` | No | API response (computed per request) |
| `periodRemaining` | No | API response (computed per request) |
| `daysLeft` | No | API response (computed per request) |
| `totalPeriodSpent` | No | API aggregate (computed per request) |
| `expensesToday` | No | API aggregate (computed per request) |
| `triggerPayday` | No | Derived at engine call time |

**When they conflict:** The API response wins for current operational values. The DB `Period.s2sPeriod` wins for the period budget (it is what the API reads). `Period.s2sDaily` never wins for live display.

---

## 3. What Wins When Numbers Disagree

### UI shows X, I calculated Y manually

Work through the source of truth hierarchy (Section 4). Most common causes:

1. **You used `Period.s2sDaily` (DB) instead of computing `dynamicS2sDaily` live.** `Period.s2sDaily` is a stale snapshot. Always compute `max(0, round(periodRemaining / daysLeft))` with current expense totals.

2. **Timezone mismatch in "today's expenses."** The dashboard uses UTC midnight. If you computed "today" in local time, you may include or exclude different expenses.

3. **Stale `s2sPeriod`.** If income/obligations changed and `/tg/periods/recalculate` was not called, `Period.s2sPeriod` reflects the old setup.

4. **Different `daysLeft` computation.** The engine uses `daysTotal - daysElapsed + 1`. The dashboard uses the same formula now. These should agree.

5. **`endDayIdx = -1` fallback.** If paydays were changed after the current period started, the engine's trigger fallback includes ALL income records. This can inflate `totalIncome`.

### period.s2sDaily vs live dynamicS2sDaily

These are expected to differ. `Period.s2sDaily` was computed once at period creation with `totalExpenses = 0` and `daysLeft = daysTotal`. As soon as any expense is logged, `dynamicS2sDaily` diverges.

`Period.s2sDaily` is used only in:
- Completed period summary (`GET /tg/periods/last-completed`)
- New period notification (`sendNewPeriodNotification` in `cron.ts` rollover)
- The raw period object returned by `GET /tg/periods/current`

`Period.s2sDaily` is **not** used by the live dashboard.

### Expense just logged but dashboard not updated

The dashboard has no server-side push. After `POST /tg/expenses` returns 201, the client must re-fetch `GET /tg/dashboard`. The expense is immediately durable after the POST. The dashboard is not cached server-side — each GET is a fresh DB query.

### Period recalculate ran but values seem off

`POST /tg/periods/recalculate` does:
1. Recomputes period bounds using current paydays
2. Runs full `calculateS2S` with current income, obligations, debts, EF
3. Updates `Period.s2sPeriod`, `Period.s2sDaily`, `Period.totalIncome`, etc. in DB
4. Does NOT delete or move existing expenses

After recalculate, the next `GET /tg/dashboard` uses the new `Period.s2sPeriod` and sums the same existing expenses against the new budget. If `s2sPeriod` decreased (e.g., obligations increased), `periodRemaining` may be 0, making `dynamicS2sDaily = 0`.

### DailySnapshot.s2sActual vs live s2sToday

These measure different things at different times. `s2sActual` can be negative; `s2sToday` cannot. Do not compare them as equivalent values.

---

## 4. Source of Truth Hierarchy

When a number appears wrong, investigate in this order:

```
1. Engine code (apps/api/src/engine.ts, apps/api/src/index.ts)
   └── The code is always the final authority.
       If code and docs disagree, update the docs.

2. API response (GET /tg/dashboard with valid auth)
   └── Reflects live DB state + runtime computation.
       If API response is correct but UI shows wrong number:
       the problem is in the frontend display logic.

3. DB stored values (psql queries)
   └── Period.s2sPeriod is authoritative for the period budget.
       Period.s2sDaily is a stale snapshot — never use for live display.
       DailySnapshot reflects state at 23:55 UTC on the recorded date.

4. UI display
   └── Lowest trust. May be cached, formatted, or derived from wrong field.
       "What the user sees" is never the source of truth.
```

### Standard Investigation Pattern

1. `curl GET /tg/dashboard` with valid auth → check `s2sToday`, `s2sDaily`, `periodSpent`, `s2sPeriod`
2. If API value is wrong: query psql to verify `Period.s2sPeriod` and expense sums
3. If psql values are correct but API is wrong: trace `index.ts` dashboard handler logic
4. If psql `s2sPeriod` is wrong: check when last recalculate ran; verify current income/obligation/debt records
5. If income/obligation/debt records are correct but `s2sPeriod` is wrong: trace `calculateS2S` step-by-step with actual DB inputs (see `./formulas-and-calculation-policy.md` Section 15 for worked examples)

### Fields That Are Never in the DB

The following cannot be queried from psql because they do not exist as stored fields:

- `s2sToday`
- `dynamicS2sDaily` (live daily limit)
- `periodRemaining`
- `daysLeft`
- `triggerPayday`
- `carryOver` (implicit, not a named field)
- `afterFixed`
- `freePool`
- `investPool`
- `residual`

---

## 5. Verification SQL Reference

### Check Active Period Fundamentals

```sql
SELECT
  id,
  start_date,
  end_date,
  days_total,
  is_prorated_start,
  total_income,
  total_obligations,
  total_debt_payments,
  reserve,
  ef_contribution,
  s2s_period,
  s2s_daily,
  status
FROM "Period"
WHERE user_id = '<userId>' AND status = 'ACTIVE';
```

### Compute Live dynamicS2sDaily

```sql
WITH period_data AS (
  SELECT id, s2s_period, end_date, days_total, start_date
  FROM "Period"
  WHERE user_id = '<userId>' AND status = 'ACTIVE'
),
spent AS (
  SELECT COALESCE(SUM(e.amount), 0) AS total
  FROM "Expense" e
  JOIN period_data p ON e.period_id = p.id
)
SELECT
  p.s2s_period,
  s.total AS total_spent,
  GREATEST(0, p.s2s_period - s.total) AS period_remaining,
  GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - p.start_date)) / 86400)::int) AS days_elapsed,
  p.days_total,
  GREATEST(1, p.days_total - GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - p.start_date)) / 86400)::int) + 1) AS days_left,
  ROUND(
    GREATEST(0, p.s2s_period - s.total)::numeric
    / GREATEST(1, p.days_total - GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - p.start_date)) / 86400)::int) + 1)
  ) AS live_dynamic_s2s_daily
FROM period_data p, spent s;
```

### Check Today's Expenses (UTC Midnight)

```sql
SELECT COALESCE(SUM(amount), 0) AS today_total
FROM "Expense"
WHERE user_id = '<userId>'
  AND spent_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC');
```

### Check EF Status

```sql
SELECT
  ef.current_amount,
  ef.target_months,
  COALESCE(SUM(o.amount), 0) AS monthly_obligations,
  COALESCE(SUM(o.amount), 0) * ef.target_months AS ef_target,
  GREATEST(0, COALESCE(SUM(o.amount), 0) * ef.target_months - ef.current_amount) AS ef_deficit
FROM "EmergencyFund" ef
LEFT JOIN "Obligation" o ON o.user_id = ef.user_id AND o.is_active = true
WHERE ef.user_id = '<userId>'
GROUP BY ef.current_amount, ef.target_months;
```
