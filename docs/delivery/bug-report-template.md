# Bug Report

**Date**:
**Reporter**:
**Severity**: Critical / High / Medium / Low
**Affected area**: API / Bot / Mini App / Cron / Formula / DB

---

## Summary

[One-line description of the problem]

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

```
# Example curl to reproduce:
curl -X GET https://mytodaylimit.ru/api/tg/dashboard \
  -H "X-TG-Init-Data: ..." \
  -H "Content-Type: application/json"
```

---

## Environment

- Platform: iOS Telegram / Android Telegram / Desktop Telegram / Web Telegram
- Telegram version:
- Version: [git hash or deploy date — check `docker ps` on server or `git log --oneline -1`]

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
- [ ] Checked DB state with psql (`SELECT * FROM "Period" WHERE status = 'ACTIVE' LIMIT 5;`)
- [ ] Checked API logs (`docker logs pfm-api --tail 100`)
- [ ] Checked bot logs (`docker logs pfm-bot --tail 100`)
- [ ] Confirmed fix does not break formula unit tests
