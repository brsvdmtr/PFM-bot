---
title: "Bug Report Template"
document_type: Template
status: Active
source_of_truth: NO
verified_against_code: N/A
last_updated: "2026-03-20"
---

# Bug Report

## Summary
[One sentence description of the bug]

## Metadata

| Field | Value |
|-------|-------|
| Date reported | YYYY-MM-DD |
| Reporter | |
| Severity | P0 / P1 / P2 / P3 |
| Affects | logic / ui / notification / auth / billing / ops |
| Is regression | Yes / No / Unknown |
| Reproducibility | Always / Intermittent / Once |

## User Context

| Field | Value |
|-------|-------|
| telegramId | |
| userId (DB) | |
| periodId (active) | |
| Release / commit | `git -C /srv/pfm log --oneline -1` |
| User timezone | e.g. "Europe/Moscow" |

## Business Impact
[What is the user unable to do? Is a financial number wrong? Is there data loss risk?]

## Steps to Reproduce

1. ...
2. ...
3. ...

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Evidence
[Screenshots, API responses, log excerpts, DB query results]

```sql
-- Useful diagnostic queries:
SELECT * FROM "Period" WHERE "userId" = 'xxx' AND status = 'ACTIVE';
SELECT SUM(amount) FROM "Expense" WHERE "periodId" = 'yyy';
```

```bash
# Example curl to reproduce:
curl -X GET https://mytodaylimit.ru/api/tg/dashboard \
  -H "X-TG-Init-Data: ..." \
  -H "Content-Type: application/json"
```

## Diagnosis Notes
[Initial analysis, suspected cause]

Common locations:
- `apps/api/src/engine.ts` — S2S calculation, period bounds
- `apps/api/src/avalanche.ts` — debt avalanche plan
- `apps/api/src/cron.ts` — period rollover, daily snapshot, notifications
- `apps/api/src/index.ts` — route handlers, auth middleware

## Fix Notes
[How it was fixed, commit hash, related docs updated]

---

## Checklist

- [ ] Reproduced locally
- [ ] Checked DB state:
  ```bash
  docker compose exec postgres psql -U pfm -d pfmdb \
    -c "SELECT * FROM \"Period\" WHERE status = 'ACTIVE' LIMIT 5;"
  ```
- [ ] Checked API logs:
  ```bash
  docker compose logs --tail=100 api
  ```
- [ ] Checked bot logs:
  ```bash
  docker compose logs --tail=100 bot
  ```
- [ ] Confirmed fix does not break formula unit tests
- [ ] If logic-affecting: use logic-issue-template.md instead of or in addition to this template
- [ ] If logic-affecting: completed Logic-Affecting Release checklist in ops/release-rules.md
- [ ] technical-debt-register.md updated if a new gap was discovered
