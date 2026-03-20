---
title: "Ops Index — PFM Bot Operational Hub"
document_type: Operational
status: Active
source_of_truth: "YES — entry point for all operational procedures"
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - runbook-deploy.md
  - runbook-rollback.md
  - runbook-cron.md
  - runbook-backup-restore.md
  - production-checklist.md
  - release-rules.md
  - ../delivery/technical-debt-register.md
  - ../security/security-privacy-checklist.md
---

# Ops Index — PFM Bot

Single entry point for all operational runbooks and procedures.

---

## Quick Reference

| Runbook | One-liner |
|---------|-----------|
| [runbook-deploy.md](./runbook-deploy.md) | Deploy new code to production: git reset + docker compose up --build |
| [runbook-rollback.md](./runbook-rollback.md) | Undo a bad deploy: code rollback, logic rollback, or DB restore |
| [runbook-cron.md](./runbook-cron.md) | All 4 cron jobs: schedules, what they do, how to verify and manually trigger |
| [runbook-backup-restore.md](./runbook-backup-restore.md) | Take a manual DB backup or restore from one |
| [production-checklist.md](./production-checklist.md) | Verified vs. pending items across infra, security, cron, monitoring |
| [release-rules.md](./release-rules.md) | Release classification, logic-affecting checklist, migration policy |

---

## When to Use What

| Situation | Runbook |
|-----------|---------|
| Deploying a new commit to production | [runbook-deploy.md](./runbook-deploy.md) |
| Deploy failed — container exits or health check red | [runbook-rollback.md](./runbook-rollback.md) § Container Rollback |
| Health check green but financial numbers are wrong | [runbook-rollback.md](./runbook-rollback.md) § Logic Rollback |
| Suspected DB corruption or schema mismatch | [runbook-rollback.md](./runbook-rollback.md) § DB Restore |
| Cron fired at wrong time or not at all | [runbook-cron.md](./runbook-cron.md) |
| Period did not roll over at midnight | [runbook-cron.md](./runbook-cron.md) § Manual Trigger |
| User not receiving notifications | [runbook-cron.md](./runbook-cron.md) § Notification Dispatcher |
| Taking a backup before a risky deploy | [runbook-backup-restore.md](./runbook-backup-restore.md) |
| Checking overall system health status | [production-checklist.md](./production-checklist.md) |
| Classifying a release before deploying | [release-rules.md](./release-rules.md) |
| Change touches engine.ts or cron.ts | [release-rules.md](./release-rules.md) § Logic-Affecting Release |

---

## Current System Status

> Fill manually after each deploy or check. Do not auto-generate this section.

| Field | Value |
|-------|-------|
| Last deploy date | [fill manually] |
| Last deploy commit | [fill manually — `git log --oneline -1` on server] |
| Last manual backup | [fill manually] |
| Cron 1 — notification dispatcher | [ ] verified |
| Cron 2 — daily snapshot (23:55 UTC) | [ ] verified |
| Cron 3 — payment alerts (09:00 UTC) | [ ] verified |
| Cron 4 — period rollover (00:05 UTC) | [ ] verified |
| Health endpoint | [ ] `/api/health` → `{"ok":true}` |
| Health/deep endpoint | [ ] `/api/health/deep` → `{"ok":true,"db":true}` |

**Verify all 4 crons started:**
```bash
ssh root@147.45.213.51
docker compose -f /srv/pfm/docker-compose.yml logs api | grep "PFM Cron"
```

---

## Infrastructure Summary

| Component | Value |
|-----------|-------|
| Server | 147.45.213.51 (Intelligent Halimede, Timeweb Cloud, Ubuntu) |
| SSH | `root@147.45.213.51` |
| App directory | `/srv/pfm` |
| Domain | `mytodaylimit.ru` |
| Git remote | `https://github.com/brsvdmtr/PFM-bot` (branch: `main`) |
| Docker Compose services | `postgres:16-alpine`, `pfm-api` (:3002), `pfm-bot`, `pfm-web` (:3003) |
| Nginx | `/etc/nginx/sites-available/pfm` — `/miniapp` → :3003, `/api/` → :3002 |
| SSL | Let's Encrypt via Certbot, auto-renew |
| Env secrets | `/srv/pfm/.env` — not in git |
| DB migration mode | `prisma db push` on startup (TEMP MVP — target: `prisma migrate deploy`) |

---

## Emergency Contacts

| Role | Contact |
|------|---------|
| Owner / Engineer | TODO: fill in |
| Hosting (Timeweb) | TODO: support link or phone |
| Domain registrar | TODO: fill in |

---

## Related Docs

| Doc | Purpose |
|-----|---------|
| [../security/security-privacy-checklist.md](../security/security-privacy-checklist.md) | Security controls, CORS, auth |
| [../delivery/technical-debt-register.md](../delivery/technical-debt-register.md) | Known gaps and debt items |
| [../system/](../system/) | System specification and architecture |
| [../api/](../api/) | API v1 contract reference |
