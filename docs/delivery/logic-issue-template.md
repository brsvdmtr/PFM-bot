---
title: "Logic Issue Template"
document_type: Template
status: Active
source_of_truth: NO
verified_against_code: N/A
last_updated: "2026-03-20"
---

# Logic Issue Report

Use this template when a financial number (S2S, daily limit, period remaining, etc.) is wrong.

## Summary
[Which number is wrong and by how much]

## Classification

| Field | Value |
|-------|-------|
| Issue type | formula / aggregation / timezone / rendering / stale-data / wrong-active-period |
| Canonical rule violated | [Reference to system/formulas-and-calculation-policy.md section] |
| Number affected | s2sToday / s2sDaily / s2sPeriod / periodRemaining / daysLeft / other |

## User Context

| Field | Value |
|-------|-------|
| telegramId | |
| userId (DB) | |
| periodId | |
| User timezone | e.g. "Europe/Moscow" |
| User local datetime | e.g. "2026-03-20 14:30 MSK" |
| Server UTC datetime | |

## The Wrong Number

| Field | Value |
|-------|-------|
| UI shows | |
| Expected value | |
| Difference | |
| Source of expected value | [Manual calculation / previous period / user claim] |

## Data Snapshot

Fill in from DB + API:

```sql
-- Get active period:
SELECT id, "startDate", "endDate", "daysTotal", "s2sPeriod", "s2sDaily",
       "totalIncome", "totalObligations", "totalDebtPayments",
       "efContribution", reserve, "isProratedStart"
FROM "Period" WHERE "userId" = 'xxx' AND status = 'ACTIVE';

-- Get total period expenses:
SELECT SUM(amount) FROM "Expense" WHERE "periodId" = 'yyy';

-- Get today's expenses:
SELECT SUM(amount) FROM "Expense"
WHERE "userId" = 'xxx' AND "spentAt" >= DATE_TRUNC('day', NOW());

-- Get incomes:
SELECT id, title, amount, paydays FROM "Income"
WHERE "userId" = 'xxx' AND "isActive" = true;
```

| Field | DB value |
|-------|---------|
| Period.s2sPeriod | |
| Period.daysTotal | |
| Period.startDate | |
| Period.endDate | |
| Period.isProratedStart | |
| SUM(expenses in period) | |
| SUM(expenses today) | |
| daysElapsed (calculated) | |
| daysLeft (calculated) | |
| dynamicS2sDaily (calculated) | |
| s2sToday (calculated) | |

## Root Cause Analysis

Trace through [system/formulas-and-calculation-policy.md](../system/formulas-and-calculation-policy.md) step by step.
Identify which step produces the wrong value.

Issue type checklist:
- [ ] Formula calculation error (wrong arithmetic in engine.ts)
- [ ] Aggregation error (wrong set of expenses summed — e.g., wrong period, wrong date range)
- [ ] Timezone boundary error (UTC vs. local midnight mismatch — see TD-017)
- [ ] Rendering error (correct data from API, wrong display in UI)
- [ ] Stale data (correct when fetched, stale now — not recalculated)
- [ ] Wrong active period selected (two ACTIVE periods exist, or wrong one returned)
- [ ] triggerPayday mismatch (paydays changed mid-period, trigger recomputed retroactively — TD-011)

**Step where divergence occurs**:
**Reason**:

## Fix

- [ ] Trigger recalculate via `POST /tg/periods/recalculate`
- [ ] Code fix required (describe below)
- [ ] DB correction required (describe SQL below)
- [ ] Update system/formulas-and-calculation-policy.md if formula was wrong
- [ ] Update delivery/technical-debt-register.md if a new gap was found

```sql
-- DB correction (if needed):

```

## Verification After Fix

```bash
# 1. SSH to server and check the period
ssh root@147.45.213.51
docker compose -f /srv/pfm/docker-compose.yml exec postgres psql -U pfm -d pfmdb

# 2. Check active period
SELECT * FROM "Period" WHERE status = 'ACTIVE' AND "userId" = '<id>';

# 3. Call the API directly
curl -X GET https://mytodaylimit.ru/api/tg/dashboard \
  -H "X-TG-Init-Data: <initData>" | jq '.s2sToday, .s2sDaily, .s2sPeriod'
```
