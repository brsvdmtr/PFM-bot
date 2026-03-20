# Logic Issue Report

**Date**:
**Reporter**:
**Area**: S2S formula / Period bounds / Avalanche / Emergency Fund / Notifications / Debt payoff

---

## Issue Description

[What calculation is wrong or produces unexpected output]

---

## Expected Calculation

[Show the formula or expected result with example numbers]

```
Example:
income = 80 000 ₽ (8 000 000 kopecks)
obligations = 20 000 ₽ (2 000 000 kopecks)
debts min payments = 5 000 ₽ (500 000 kopecks)
reserve (10%) = 550 000 kopecks

Expected residual = 8_000_000 - 2_000_000 - 500_000 - 550_000 = 4_950_000 kopecks
Expected s2sDaily = round(4_950_000 / 26 days) = 190_384 kopecks = 1 903 ₽
```

---

## Actual Calculation

[Show what the system actually computes — with DB values if possible]

```sql
-- Retrieve active period and S2S values:
SELECT id, "startDate", "endDate", "totalIncome", "totalObligations",
       "totalDebtPayments", reserve, "s2sPeriod", "s2sDaily", "daysTotal"
FROM "Period"
WHERE status = 'ACTIVE'
  AND "userId" = '<user-id>';

-- Retrieve today's expenses:
SELECT SUM(amount) FROM "Expense"
WHERE "userId" = '<user-id>'
  AND "spentAt" >= NOW()::date;
```

Actual result from DB / API response:

```json
{
  "s2sToday": 0,
  "s2sDaily": 0,
  "s2sPeriod": 0
}
```

---

## Example

Input:
- income: X ₽ (as kopecks: X * 100)
- paydays: [D1] or [D1, D2]
- obligations: X ₽
- debts: balance X ₽, APR X%, min payment X ₽
- EF: current X ₽, target X months
- today: YYYY-MM-DD
- period: START → END (N days total, N days left)

Expected `s2sToday`: X ₽
Actual `s2sToday`: Y ₽
Delta: Z ₽ (Z% deviation)

---

## Verification Steps

```bash
# 1. SSH to server and open psql
ssh user@mytodaylimit.ru
docker exec -it pfm-db psql -U pfm pfm_db

# 2. Check the active period for the user
SELECT * FROM "Period" WHERE status = 'ACTIVE' AND "userId" = '<id>';

# 3. Check incomes and paydays
SELECT id, amount, paydays, "isActive" FROM "Income" WHERE "userId" = '<id>';

# 4. Sum expenses in period
SELECT SUM(amount) FROM "Expense" WHERE "periodId" = '<period-id>';

# 5. Call the API directly
curl -X GET https://mytodaylimit.ru/api/tg/dashboard \
  -H "X-TG-Init-Data: <initData>" | jq '.s2sToday, .s2sDaily, .s2sPeriod'
```

---

## Root Cause

[Which function / file / line contains the bug]

Examples of common locations:
- `apps/api/src/engine.ts` — `calculateS2S()`, `calculatePeriodBounds()`, `daysBetween()`
- `apps/api/src/avalanche.ts` — `buildAvalanchePlan()`, `determineFocusDebt()`
- `apps/api/src/cron.ts` — period rollover, daily snapshot, notification dispatch
- `apps/api/src/index.ts` — `GET /tg/dashboard` dynamic S2S recalculation

---

## Impact

- Affects: all users / users with 2 paydays / users with debts / users with EF / users onboarded mid-period / ...
- Direction: Overestimates budget (users spend more than safe) / Underestimates budget (users spend less than possible)
- Severity: ~X% deviation from correct value

---

## Notes

[Any additional context: timing, edge cases, related issues]
