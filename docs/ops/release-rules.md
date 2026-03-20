---
title: "Release Rules"
document_type: Operational
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - path: ./ops-index.md
    relation: "ops entry point"
  - path: ./runbook-deploy.md
    relation: "deploy procedure"
  - path: ./runbook-rollback.md
    relation: "rollback if release goes wrong"
---

# Release Rules

---

## When to Use

Use this document before any deploy. Classify the release type, then follow the corresponding checklist. Misclassifying a logic-affecting release as UI-only is the most common cause of production incidents on this project.

---

## Prerequisites

- Changes are committed and pushed to `main`
- You have read the affected code and can state which release type applies
- For logic-affecting releases: `formulas-and-calculation-policy.md` is open in a second window

---

## Step-by-Step Procedure

1. Read the diff and classify the release using the table below.
2. If the release is `logic-affecting`: complete the Logic-Affecting checklist before deploying.
3. Complete the Standard checklist (applies to all releases).
4. Deploy per [runbook-deploy.md](./runbook-deploy.md).
5. Verify per the Success Criteria below.
6. If anything breaks: see [runbook-rollback.md](./runbook-rollback.md).

---

## Release Types

| Type | Examples | Risk | Required steps |
|------|---------|------|----------------|
| Logic-affecting | Formula change, calculation fix, cron schedule change | HIGH | Full verification flow (see checklist below) |
| Infrastructure | Docker, nginx, env vars, base image updates | MEDIUM | Health check only |
| UI/Content | Text, styles, copy, button labels | LOW | Visual check |
| Docs only | Markdown files | NONE | Commit only |

A single release can have multiple types. Use the most restrictive checklist that applies.

**Logic-affecting triggers:** Any change to `engine.ts`, `cron.ts`, period bounds calculation, income allocation, debt payoff logic, or emergency fund calculation.

---

## Logic-Affecting Release Procedure (Mandatory Steps)

Every release classified as `logic-affecting` must complete this checklist before deploy:

- [ ] Read `formulas-and-calculation-policy.md` before making changes
- [ ] Write the change in terms of the formula — which step changes and how
- [ ] Capture before state for at least 2 users:
  ```bash
  curl https://mytodaylimit.ru/api/tg/dashboard \
    -H "X-TG-Init-Data: <your-real-initData>" | jq '.s2sToday, .s2sDaily, .s2sPeriod'
  ```
- [ ] Update `formulas-and-calculation-policy.md` if the formula changes (same commit or before the release commit)
- [ ] Update worked examples in the formulas doc to reflect the new formula
- [ ] Update `gap-analysis.md` if this release closes a known gap or introduces a new one
- [ ] Build passes: `pnpm --filter @pfm/db build && pnpm --filter @pfm/api build`
- [ ] Deploy does NOT happen in the 23:45–00:15 UTC window (snapshot + rollover crons)
- [ ] After deploy: run `POST /tg/periods/recalculate` for affected users and capture after state
- [ ] Verify dashboard numbers match expected before/after delta
- [ ] Commit message includes `Logic change: [description of formula impact]`

**Commit message format for logic-affecting releases:**
```
fix: correct income proration for mid-period onboarding

Logic change: income now prorated by daysRemaining/daysTotal instead of full period.
s2sToday increases for users who onboard after period start. No effect on users
onboarded at period start.
```

---

## Infrastructure Release

- [ ] Review `docker-compose.yml` changes for unintended port exposure or env var changes
- [ ] Check env var compatibility — new vars must be added to `/srv/pfm/.env` before deploy
- [ ] Health check after deploy: `curl https://mytodaylimit.ru/api/health`
- [ ] Monitor logs for 5 minutes: `docker compose logs -f api`

---

## db push vs migrate deploy

**NEVER** use `prisma db push` in production for intentional schema changes — it does not create migration files and cannot be safely rolled back.

**ALWAYS** use `prisma migrate deploy` for production schema changes.

The current API container CMD runs `prisma db push` on startup — this is intentional for MVP but is TEMPORARY. Target state: generate migration files with `prisma migrate dev` locally, commit them, and run `prisma migrate deploy` in production. Tracked in the technical debt register.

Before any schema-changing deploy: take a manual backup per [runbook-backup-restore.md](./runbook-backup-restore.md).

---

## Notification About Logic Changes

- If a formula change affects existing users' calculated numbers: consider notifying via bot message that limits have been recalculated.
- If `POST /tg/periods/recalculate` is needed for affected users: identify them (users whose period was created before the deploy) and trigger recalculate. In production this requires a valid Telegram initData token, or the user can open the mini app to trigger it automatically.

---

## Rollback Trigger Conditions

Trigger rollback per [runbook-rollback.md](./runbook-rollback.md) if any of the following are true after deploy:

- Any 5xx errors in `/health/deep`
- Dashboard returning 0 for all users unexpectedly
- Container crash loop visible in `docker compose ps`
- S2S values changed for users who were not affected by the formula change

---

## Success Criteria

Release is complete when:

- [ ] `docker compose ps` shows all 4 services `Up`
- [ ] `curl https://mytodaylimit.ru/api/health` returns `{"ok":true,...}`
- [ ] `curl http://127.0.0.1:3002/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] For logic-affecting: before/after payload documented and delta matches expected

---

## Related Docs

- [runbook-deploy.md](./runbook-deploy.md) — deploy procedure
- [runbook-rollback.md](./runbook-rollback.md) — rollback if release goes wrong
- [ops-index.md](./ops-index.md) — ops entry point
