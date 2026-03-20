# Numerical Source of Truth

<!-- Document metadata -->
Document Type: Normative
Status: Active — Verified Against Code
Source of Truth: YES — for resolving disputes about where a number came from
Verified Against Code: Yes (`apps/api/src/engine.ts`, `apps/api/src/index.ts`, `apps/api/src/cron.ts`)
Last Updated: 2026-03-20
Related Docs:
  - system/formulas-and-calculation-policy.md
  - system/glossary.md

---

## Purpose

This document answers the question: "When the UI shows a number X, where does that number come from?"

For each displayed number, it documents the computation path from raw DB data to the value the user sees. It also documents every point where a stored value and a live computed value can diverge.

When investigating a discrepancy, start with the **Source of Truth Hierarchy** (Section 4) and trace back through the relevant entry in Section 2.

---

## 1. Number-by-Number Reference

---

### 1.1 s2sToday — "Safe to Spend Today"

| Property | Value |
|----------|-------|
| Russian UI label | (shown as the main number in the dashboard header) |
| API field returned | `s2sToday` in `GET /tg/dashboard` response |
| Computation location | `index.ts`, `GET /tg/dashboard` handler |
| Persisted | No — never written to DB |
| Formula | `max(0, dynamicS2sDaily - todayTotal)` |
| Depends on | `activePeriod.s2sPeriod`, `totalPeriodSpent`, `todayTotal`, `daysLeft` |
| What invalidates it | Any new expense, any expense deletion, passage of time (daysLeft changes) |
| Minimum value | 0 (never negative in API response) |

**How to verify manually:**

```sql
-- Get active period
SELECT id, s2s_period, end_date FROM periods WHERE status = 'ACTIVE' AND user_id = '<userId>';

-- Get total period expenses
SELECT SUM(amount) FROM expenses WHERE period_id = '<periodId>';

-- Get today's expenses (UTC midnight)
SELECT SUM(amount) FROM expenses WHERE period_id = '<periodId>'
  AND spent_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
```

Then:
```
daysLeft = max(1, ceil((endDate - now()) / 86400000))
periodRemaining = max(0, s2sPeriod - totalPeriodSpent)
dynamicS2sDaily = max(0, round(periodRemaining / daysLeft))
s2sToday = max(0, dynamicS2sDaily - todayTotal)
```

**Common confusion:** Users sometimes expect `s2sToday` to equal the original daily budget set at period creation. It does not. `s2sToday` is always derived from the current remaining balance, so it changes as expenses accumulate. See carry-over explanation in 1.9.

---

### 1.2 s2sDaily (Live) — "из дневного лимита"

| Property | Value |
|----------|-------|
| Russian UI label | "из дневного лимита" in morning notification; daily limit in dashboard |
| API field returned | `s2sDaily` in `GET /tg/dashboard` response |
| Computation location | `index.ts`, `GET /tg/dashboard` handler |
| Persisted | No — computed fresh every request |
| Formula | `max(0, round(periodRemaining / daysLeft))` where `periodRemaining = max(0, s2sPeriod - totalPeriodSpent)` |
| Depends on | `activePeriod.s2sPeriod`, `totalPeriodSpent`, `daysLeft` |
| What invalidates it | Any expense, passage of time (daily at midnight) |

**Critical:** The `s2sDaily` returned by `GET /tg/dashboard` is NOT read from `period.s2sDaily` in the DB. It is computed dynamically on every request. The stored `period.s2sDaily` is a stale snapshot from period creation.

**daysLeft computation in dashboard (index.ts):**

```typescript
const daysLeft = Math.max(1, Math.ceil((activePeriod.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
```

This uses wall-clock milliseconds from now to `endDate`, then ceiling. It differs from the engine's `daysTotal - daysElapsed + 1` formulation but produces the same result in most cases.

**How to verify manually:**

```bash
curl -H "x-tg-init-data: ..." https://api.mytodaylimit.ru/tg/dashboard | jq '.s2sDaily'
```

Or compute from psql values using the formula above.

---

### 1.3 period.s2sDaily — Stored Snapshot

| Property | Value |
|----------|-------|
| Russian UI label | Used in "last completed period" summary view |
| API field returned | `s2sDaily` in `GET /tg/periods/last-completed` |
| Computation location | Written at period creation (onboarding, rollover, recalculate) |
| Persisted | Yes — `Period.s2sDaily` column |
| Formula at creation | `max(0, round(s2sPeriod / daysLeft))` where `daysLeft = daysTotal` at creation time |
| When stale | Immediately after the first expense is logged |

**Do not use** `period.s2sDaily` to compute current safe-to-spend. It does not reflect accumulated expenses.

**Why it exists:** It provides a reference point for period summaries and historical comparisons. If the user spent significantly less than the original `s2sDaily` suggests, the difference is their savings.

**How to query:**

```sql
SELECT s2s_daily, s2s_period, days_total FROM periods WHERE status = 'ACTIVE' AND user_id = '<userId>';
```

---

### 1.4 s2sPeriod — Total Period Budget

| Property | Value |
|----------|-------|
| Russian UI label | "Бюджет периода" / period total |
| API field returned | `s2sPeriod` in `GET /tg/dashboard` and `GET /tg/periods/current` |
| Computation location | `engine.ts` calculateS2S → written to DB at period creation/recalculate |
| Persisted | Yes — `Period.s2sPeriod` column |
| Formula | `max(0, totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool)` |
| When stale | After `/tg/periods/recalculate` or after any income/obligation/debt change (if recalculate is called) |
| What does NOT change it | Adding or deleting expenses — `s2sPeriod` does not change as expenses are logged |

**How to query:**

```sql
SELECT s2s_period FROM periods WHERE status = 'ACTIVE' AND user_id = '<userId>';
```

---

### 1.5 periodRemaining — "Осталось в периоде"

| Property | Value |
|----------|-------|
| Russian UI label | "Осталось в периоде" |
| API field returned | `periodSpent` is returned; `periodRemaining` is computed implicitly for display |
| Computation location | `index.ts` dashboard: `max(0, activePeriod.s2sPeriod - totalPeriodSpent)` |
| Persisted | No — derived on every request |
| Formula | `max(0, s2sPeriod - totalPeriodSpent)` |
| Depends on | `period.s2sPeriod` (persisted), `totalPeriodSpent` (aggregated live) |

Note: In the engine (`engine.ts` return value), `periodRemaining = max(0, s2sPeriod - totalExpensesInPeriod)`. In the dashboard, `periodRemaining` is also floored at 0 before dividing by `daysLeft`.

**How to verify manually:**

```sql
SELECT p.s2s_period - COALESCE(SUM(e.amount), 0) AS period_remaining
FROM periods p
LEFT JOIN expenses e ON e.period_id = p.id
WHERE p.status = 'ACTIVE' AND p.user_id = '<userId>'
GROUP BY p.s2s_period;
```

---

### 1.6 totalPeriodSpent — Sum of All Period Expenses

| Property | Value |
|----------|-------|
| Russian UI label | "Потрачено за период" / `periodSpent` |
| API field returned | `periodSpent` in `GET /tg/dashboard` |
| Computation location | `index.ts`: `prisma.expense.aggregate({ where: { userId, period: { status: 'ACTIVE' } }, _sum: { amount: true } })` |
| Persisted | No — aggregated live from expenses table |
| Formula | `SUM(expense.amount)` where `expense.periodId` links to ACTIVE period |
| What invalidates it | Any expense create/delete |

**Note on filtering:** The aggregate uses `period: { status: 'ACTIVE' }` as a join condition, not `periodId = activePeriod.id`. These are equivalent when there is exactly one ACTIVE period per user, which is the guaranteed invariant. If a bug creates two ACTIVE periods, this aggregate would sum both.

**How to query:**

```sql
SELECT SUM(e.amount)
FROM expenses e
JOIN periods p ON p.id = e.period_id
WHERE p.user_id = '<userId>' AND p.status = 'ACTIVE';
```

---

### 1.7 expensesToday — Today's Expenses

| Property | Value |
|----------|-------|
| Russian UI label | "Потрачено сегодня" |
| API field returned | `todayTotal` in `GET /tg/dashboard`; individual records in `todayExpenses[]` |
| Computation location | `index.ts`: `prisma.expense.aggregate` + `prisma.expense.findMany` with `spentAt >= today UTC midnight` |
| Persisted | No — aggregated live |
| Formula | `SUM(expense.amount)` where `spentAt >= new Date(new Date().setHours(0,0,0,0))` |
| Timezone | **UTC** — "today" is UTC midnight, not user's local midnight |
| What invalidates it | Any expense create/delete with today's `spentAt` |

**Timezone pitfall:** For a Moscow user (+3), UTC midnight is 03:00 MSK. Expenses logged between 00:00 and 02:59 MSK appear in "yesterday" by UTC reckoning. The dashboard will not count them in `todayTotal` until they cross the UTC midnight boundary.

**How to query:**

```sql
SELECT SUM(amount) FROM expenses
WHERE user_id = '<userId>'
AND spent_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
```

---

### 1.8 daysLeft

| Property | Value |
|----------|-------|
| API field returned | `daysLeft` in `GET /tg/dashboard` |
| Computation location | `index.ts` dashboard handler |
| Persisted | No — computed per request |
| Formula | `max(1, ceil((activePeriod.endDate - now) / msPerDay))` |
| Minimum | 1 |

**Note:** This differs from the engine's `daysLeft = daysTotal - daysElapsed + 1`. The dashboard formula uses wall-clock milliseconds from `now` to `endDate`. The engine's formula uses `daysBetween(periodStart, today)`. In most scenarios these agree. They can differ by 1 on the day before the period ends, depending on the time of day the request is made.

`period.daysTotal` (the persisted value) is the total days at period creation, and is returned in the dashboard response as `daysTotal`. It does not change as time passes.

---

### 1.9 carryOver (Implicit)

Carry-over is not a stored field. It is an emergent property of the `periodRemaining / daysLeft` formula.

On each request, `s2sDaily` is recomputed from what is left. If the user spent less than their daily limit yesterday, there is more `periodRemaining` distributed over fewer `daysLeft` today. The new `s2sDaily` will be higher than the original.

There is no explicit "carry-over amount" in the API response or DB. The entire carry-over mechanism is baked into `s2sDaily`.

To observe carry-over: compare `GET /tg/dashboard` `s2sDaily` at the start of day 2 with `period.s2sDaily` (the stored snapshot). The difference is the carry-over effect.

---

### 1.10 DailySnapshot.s2sActual

| Property | Value |
|----------|-------|
| DB table/field | `DailySnapshot.s2sActual` |
| Written by | `cron.ts` Cron 2, at 23:55 UTC every day |
| Computation location | `cron.ts` |
| Formula | `s2sPlanned - todayTotal` where `s2sPlanned = max(0, round((s2sPeriod - totalPeriodSpent) / daysLeft))` at 23:55 UTC |
| Persisted | Yes — upsert by `periodId + date` |
| What it captures | The live s2sDaily and actual spending at 23:55 UTC |
| What it does NOT capture | Real-time state. Any expense logged after 23:55 UTC is not reflected until next day. |

**Note:** `s2sActual` is NOT floored at 0 in the cron snapshot. The computation in `cron.ts` is:

```typescript
const s2sActual = s2sPlanned - todayTotal;
```

This can be negative if the user overspent. The `isOverspent` field is `todayTotal > s2sPlanned`.

The dashboard's `s2sToday` is floored at 0 (`max(0, ...)`). The snapshot's `s2sActual` is not. These may differ in sign.

**How to query:**

```sql
SELECT date, s2s_planned, s2s_actual, total_expenses, is_overspent
FROM daily_snapshots
WHERE period_id = '<periodId>'
ORDER BY date DESC;
```

---

## 2. When Numbers Disagree

### 2.1 UI Shows X But I Calculated Y Manually

Work through the source of truth hierarchy (Section 4). The most common causes:

1. **You used `period.s2sDaily` (DB) instead of the live formula.** `period.s2sDaily` is a stale snapshot. Always use `max(0, round(periodRemaining / daysLeft))` with current expense totals.

2. **Timezone mismatch in "today's expenses."** The dashboard uses UTC midnight. If you computed "today" in MSK, you may include/exclude different expenses.

3. **Stale `s2sPeriod`.** If income or obligations were changed and `/tg/periods/recalculate` was not called, `period.s2sPeriod` reflects the old setup. The dashboard uses the stored `s2sPeriod` — it does not re-run the full engine on every request.

4. **Different `daysLeft` formula.** The dashboard uses `Math.ceil((endDate - now) / msPerDay)`. The engine uses `daysTotal - daysElapsed + 1`. These agree except near period boundary transitions.

5. **`endDayIdx = -1` fallback.** If paydays were changed after the current period started, the engine's trigger fallback includes ALL income records. This can make `totalIncome` larger than expected.

---

### 2.2 period.s2sDaily vs Live s2sDaily

These are expected to differ. `period.s2sDaily` was computed once, at period creation, with `totalExpenses = 0` and `daysLeft = daysTotal`. As soon as any expense is logged, the live `s2sDaily` diverges.

`period.s2sDaily` is used only in:
- Completed period summary (`GET /tg/periods/last-completed`)
- New period notification (`sendNewPeriodNotification` in `cron.ts` rollover)
- The raw period object returned by `GET /tg/periods/current`

`period.s2sDaily` is NOT used by the live dashboard.

---

### 2.3 Expense Just Logged But Dashboard Not Updated

The dashboard has no server-side push. After `POST /tg/expenses` returns 201, the client must re-fetch `GET /tg/dashboard` to see updated values. The expense is immediately durable (in DB) after the POST completes. The dashboard is not cached server-side — each GET is a fresh DB query.

---

### 2.4 Period Changed (Recalculate Hit) But Values Seem Off

`POST /tg/periods/recalculate` does the following:
1. Recomputes period bounds using current paydays (may change `startDate`, `endDate`, `daysTotal`)
2. Runs full `calculateS2S` with current income, obligations, debts, EF
3. Updates `period.s2sPeriod`, `period.s2sDaily`, `period.totalIncome`, etc. in DB
4. Does NOT delete or move existing expenses

After recalculate, the next `GET /tg/dashboard` will:
- Use the new `period.s2sPeriod`
- Sum the same existing expenses against the new budget
- Compute a new live `s2sDaily` from the new `periodRemaining`

If `s2sPeriod` decreased (e.g., obligations increased), `periodRemaining` may be negative, making `s2sDaily = 0`.

---

### 2.5 DailySnapshot.s2sActual vs Live s2sToday

These measure different things at different times:

| | `DailySnapshot.s2sActual` | Live `s2sToday` |
|-|-|-|
| When captured | 23:55 UTC | On demand |
| Floor at 0 | No (can be negative) | Yes (`max(0, ...)`) |
| Purpose | Historical record | Current decision support |

A day where `s2sActual = -500,000` means the user overspent by 5,000 ₽ by 23:55 UTC. The live dashboard would have shown `s2sToday = 0` for the same moment.

---

## 3. Verification Reference

### Checking Active Period Fundamentals

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
FROM periods
WHERE user_id = '<userId>' AND status = 'ACTIVE';
```

### Checking Live s2sDaily

```sql
WITH period_data AS (
  SELECT id, s2s_period, end_date FROM periods
  WHERE user_id = '<userId>' AND status = 'ACTIVE'
),
spent AS (
  SELECT SUM(e.amount) AS total
  FROM expenses e
  JOIN period_data p ON e.period_id = p.id
)
SELECT
  p.s2s_period,
  s.total AS total_spent,
  GREATEST(0, p.s2s_period - s.total) AS period_remaining,
  GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p.end_date - NOW())) / 86400)) AS days_left,
  ROUND(
    GREATEST(0, p.s2s_period - s.total)::numeric
    / GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p.end_date - NOW())) / 86400))
  ) AS live_s2s_daily
FROM period_data p, spent s;
```

### Checking Today's Expenses (UTC)

```sql
SELECT SUM(amount) AS today_total
FROM expenses
WHERE user_id = '<userId>'
  AND spent_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC');
```

---

## 4. Source of Truth Hierarchy

When a number appears wrong, investigate in this order:

```
1. Engine code (apps/api/src/engine.ts, index.ts)
   └── The code is always authoritative. If code and docs disagree, update docs.

2. API response (curl GET /tg/dashboard)
   └── Reflects live DB state + runtime computation.
   └── If API response is correct but UI shows wrong number, the problem is in the frontend.

3. DB stored value (psql SELECT)
   └── period.s2sPeriod is authoritative for the period budget.
   └── period.s2sDaily is a stale snapshot — do not use for live calculations.
   └── DailySnapshot reflects state at 23:55 UTC on the recorded date.

4. UI display
   └── Lowest trust. May be cached, formatted, or derived from wrong field.
   └── "What the user sees" is never the source of truth.
```

### Common Investigation Pattern

1. `curl GET /tg/dashboard` with valid auth headers → check `s2sToday`, `s2sDaily`, `periodSpent`, `s2sPeriod`
2. If API value is wrong: query psql to verify underlying `period.s2sPeriod` and expense sums
3. If psql values are correct but API is wrong: check dashboard handler logic in `index.ts`
4. If psql `s2sPeriod` is wrong: check when last recalculate ran, check current income/obligation/debt records
5. If income/obligation/debt records are correct but `s2sPeriod` is wrong: trace `calculateS2S` with actual inputs

### Fields That Are Never in the DB

The following are always computed at request time and cannot be queried from psql:
- `s2sToday`
- `s2sDaily` (live)
- `periodRemaining`
- `daysLeft`
- `triggerPayday`
- `carryOver` (implicit — not a named field)
