---
title: "Bug Report Template"
document_type: Template
status: Active
source_of_truth: "YES — for all bug reports on PFM Bot"
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - logic-issue-template.md
  - ../ops/runbook-rollback.md
  - ../ops/runbook-deploy.md
---

# Bug Report

**Date**:
**Reporter**:
**Severity**: Critical / High / Medium / Low
**Affected area**: API / Bot / Mini App / Cron / Formula / DB

---

## Summary

[One-line description of the problem]

---

## Context

- **Commit Hash**: (run on server: `git -C /srv/pfm log --oneline -1`)
- **User Telegram ID**:
- **User Period ID**: (find in DB: `SELECT id FROM "Period" WHERE "userId"='...' AND status='ACTIVE'`)
- **Timezone**: (user's IANA timezone: `SELECT timezone FROM "User" WHERE "telegramId"='...'`)
- **Reproducibility**: Always / Sometimes / Once

---

## Impact

- **Users affected**: Single / Multiple / All
- **Business impact**: Wrong calculation / Missing notification / Auth failure / Other
- **Regression**: Yes / No / Unknown

---

## Steps to Reproduce

1.
2.
3.

---

## Expected Behavior

[What should happen]

---

## Actual Behavior

[What actually happens]

---

## Evidence

[Screenshot / log output / curl response]

```bash
# Example curl to reproduce:
curl -X GET https://mytodaylimit.ru/api/tg/dashboard \
  -H "X-TG-Init-Data: ..." \
  -H "Content-Type: application/json"
```

---

## Environment

- Platform: iOS Telegram / Android Telegram / Desktop Telegram / Web Telegram
- Telegram version:
- Commit on server: (run: `git -C /srv/pfm log --oneline -1`)

---

## Root Cause (fill if known)

[Which file / function contains the bug. E.g.: `apps/api/src/engine.ts` line 108, `daysLeft` calculation]

---

## Proposed Fix

[Describe the fix. Include a code snippet if known.]

---

## Related Code

- File:
- Line:
- Function:

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
- [ ] If logic-affecting: completed Logic-Affecting Release checklist in release-rules.md
