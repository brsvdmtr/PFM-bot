---
title: "Ops Index — PFM Bot Operational Hub"
document_type: Operational
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - path: ./runbook-deploy.md
    relation: "deploy procedure"
  - path: ./runbook-rollback.md
    relation: "rollback and recovery"
  - path: ./runbook-cron.md
    relation: "cron job operations"
  - path: ./runbook-backup-restore.md
    relation: "backup and restore"
  - path: ./production-checklist.md
    relation: "production readiness"
  - path: ./release-rules.md
    relation: "release classification and rules"
---

# Ops Index — PFM Bot

Single entry point for all operational runbooks and procedures.

---

## Quick Reference

| Situation | Runbook |
|-----------|---------|
| Deploy new code | [runbook-deploy.md](./runbook-deploy.md) |
| Something is broken, need to rollback | [runbook-rollback.md](./runbook-rollback.md) |
| Cron not firing / notifications broken | [runbook-cron.md](./runbook-cron.md) |
| DB backup / restore | [runbook-backup-restore.md](./runbook-backup-restore.md) |
| Before going to production | [production-checklist.md](./production-checklist.md) |
| Planning a release | [release-rules.md](./release-rules.md) |

---

## On-Call Quick Checks

```bash
# Is API healthy?
curl https://mytodaylimit.ru/api/health

# Is DB healthy?
curl https://mytodaylimit.ru/api/health/deep

# Container status?
ssh root@147.45.213.51 "cd /srv/pfm && docker compose ps"

# Recent API logs?
ssh root@147.45.213.51 "cd /srv/pfm && docker compose logs --tail=50 api"
```

---

## Service Healthy but Financial Numbers Are Wrong

Use this section when `/api/health` returns 200 but S2S values are incorrect for a user.

**Step 1:** Identify the affected user — get their `telegramId` from user report or bot logs.

**Step 2:** Check their active period via DB:
```bash
ssh root@147.45.213.51 "cd /srv/pfm && docker compose exec postgres psql -U pfm -d pfmdb \
  -c \"SELECT id, \\\"startDate\\\", \\\"endDate\\\", \\\"s2sDaily\\\", \\\"s2sPeriod\\\", status FROM \\\"Period\\\" WHERE status = 'ACTIVE' AND \\\"userId\\\" = '<user-id>';\""
```

**Step 3:** Compare `Period.s2sPeriod` against the expected value from income and obligations. Check `Period.daysTotal` against the actual date range (`endDate - startDate`).

**Step 4:** Check `totalPeriodSpent` — confirm it equals the sum of all expenses in the period:
```bash
ssh root@147.45.213.51 "cd /srv/pfm && docker compose exec postgres psql -U pfm -d pfmdb \
  -c \"SELECT SUM(amount) FROM \\\"Expense\\\" WHERE \\\"periodId\\\" = '<period-id>';\""
```

**Step 5:** Trigger manual recalculate. In production, the user opening the mini app triggers recalculate automatically on dashboard load. To trigger directly:
```bash
# Production (requires real Telegram initData from user session):
curl -X POST https://mytodaylimit.ru/api/tg/periods/recalculate \
  -H "X-TG-Init-Data: <user-initData>" \
  -H "Content-Type: application/json"
```

**Step 6:** If still wrong after recalculate, use the internal admin endpoint or direct DB query:
```bash
# Direct DB query to inspect period bounds:
ssh root@147.45.213.51 "cd /srv/pfm && docker compose exec postgres psql -U pfm -d pfmdb \
  -c \"SELECT * FROM \\\"Period\\\" WHERE \\\"userId\\\" = '<user-id>' AND status = 'ACTIVE';\""
```

**Step 7:** If numbers remain wrong after recalculate, this is a logic bug. Read `formulas-and-calculation-policy.md` and trace through the formula manually. Then see [runbook-rollback.md](./runbook-rollback.md) § Logic Rollback.

---

## Environment Variables Reference

All secrets live in `/srv/pfm/.env` on the server. This file is NOT in git.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string — used by Prisma |
| `BOT_TOKEN` | Telegram Bot Token from @BotFather |
| `ADMIN_KEY` | Secret key for `/internal/*` routes |
| `API_PORT` | API listen port — must be `3002` |
| `MINI_APP_URL` | Public URL of the mini app — `https://mytodaylimit.ru/miniapp` |
| `NEXT_PUBLIC_API_URL` | API base URL baked into web build at build time |
| `NODE_ENV` | Must be `production` on server |
| `GOD_MODE_TELEGRAM_IDS` | Comma-separated Telegram IDs with free PRO access |
| `POSTGRES_USER` | Postgres username |
| `POSTGRES_PASSWORD` | Postgres password — alphanumeric only, no special chars |
| `POSTGRES_DB` | Database name |

---

## Key Paths

| Path | Description |
|------|-------------|
| `/srv/pfm` | Repo root on server |
| `/srv/pfm/.env` | Environment variables (not in git) |
| `/root/backups/pfm/` | Manual DB backups |

View logs:
```bash
ssh root@147.45.213.51 "cd /srv/pfm && docker compose logs [service] --tail=100"
# Services: api, bot, web, postgres
```

---

## Related Docs

| Doc | Purpose |
|-----|---------|
| [../security/security-privacy-checklist.md](../security/security-privacy-checklist.md) | Security controls, CORS, auth |
| [../delivery/technical-debt-register.md](../delivery/technical-debt-register.md) | Known gaps and debt items |
| [../system/](../system/) | System specification and architecture |
| [../api/](../api/) | API v1 contract reference |
