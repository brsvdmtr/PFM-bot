---
title: "Production Readiness Checklist"
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
  - path: ./runbook-backup-restore.md
    relation: "backup setup"
  - path: ../security/security-privacy-checklist.md
    relation: "security controls detail"
  - path: ../delivery/technical-debt-register.md
    relation: "debt and gap tracking"
---

# Production Readiness Checklist

Legend: ✅ verified in production | ⚠️ requires manual check | ❌ confirmed missing / not done

---

## When to Use

- Before going to production for the first time
- Before each release (pre-deploy checklist)
- After any incident (re-verify affected areas)

---

## Prerequisites

- SSH access to `root@147.45.213.51`
- Access to `/srv/pfm/.env` on the server

---

## Pre-Deploy Checklist (Before Each Release)

Run through this before every deploy:

- [ ] `git log` is clean — no uncommitted changes on server (`git status` on server shows clean)
- [ ] `/srv/pfm/.env` has all required vars: `DATABASE_URL`, `BOT_TOKEN`, `ADMIN_KEY`, `MINI_APP_URL`, `NODE_ENV=production`
- [ ] `ADMIN_KEY` is not `"change_me_in_production"` or any default placeholder value
- [ ] `CORS` restricted to `mytodaylimit.ru` (enforced by `NODE_ENV=production`)
- [ ] `docker compose ps` shows all services healthy before the deploy begins
- [ ] If logic-affecting: Logic-Affecting checklist in `release-rules.md` is complete

---

## Security Checklist (Verified 2026-03-20)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | CORS restricted to `mytodaylimit.ru` in production | ✅ | `cors({ origin: 'https://mytodaylimit.ru' })` — verified 2026-03-20 |
| 2 | Telegram `auth_date` freshness check (1 hour TTL) | ✅ | Rejects initData older than 1 hour — added 2026-03-20 |
| 3 | HMAC-SHA256 `initData` validation enabled | ✅ | `validateTelegramInitData` active in `index.ts` |
| 4 | Internal routes protected by `ADMIN_KEY` | ✅ | All `/internal/*` routes require `x-internal-key` header |
| 5 | `X-TG-DEV` bypass blocked in production | ✅ | `NODE_ENV !== 'production'` guard in `tgAuth` middleware |
| 6 | `.env` file not in git | ✅ | Confirmed in `.gitignore` |
| 7 | `POSTGRES_PASSWORD` alphanumeric only (no special chars) | ✅ | Special chars break `DATABASE_URL` parsing |
| 8 | No rate limiting on API endpoints | ⚠️ | TD-001: any user can flood POST /tg/expenses — open gap |
| 9 | `ADMIN_KEY` has no rotation policy | ⚠️ | Simple string, no expiry — document policy when team grows |
| 10 | No request logging / audit trail | ❌ | No structured access logs — outages are not traceable |

---

## Formula Verification (After Logic-Affecting Changes)

Run through this after any release touching `engine.ts`, `cron.ts`, or period bounds:

- [ ] `POST /tg/periods/recalculate` returns expected `s2sPeriod` for a test user
- [ ] Dashboard `s2sToday = s2sDaily - todayTotal` (or 0 if negative)
- [ ] `daysLeft = max(1, daysTotal - daysElapsed + 1)`
- [ ] Carry-over: overspending on day 1 reduces day 2 limit

---

## Current Verified State (as of 2026-03-20)

| Item | Status |
|------|--------|
| Two-payday income formula (trigger payday algorithm) | ✅ correct |
| `daysLeft` formula unified across engine/dashboard/cron | ✅ correct |
| `DailySnapshot.s2sActual` floored at 0 | ✅ correct |
| `auth_date` replay protection | ✅ active |
| CORS restriction to `mytodaylimit.ru` | ✅ active |

---

## Manual Verification Pending

These items require a human to verify periodically or after specific events:

| # | Item | Priority | How to verify |
|---|------|----------|---------------|
| 1 | `ADMIN_KEY` value in production is not a default | P1 | `grep ADMIN_KEY /srv/pfm/.env` |
| 2 | Bot token is valid | P1 | `curl "https://api.telegram.org/bot<BOT_TOKEN>/getMe"` |
| 3 | Backup procedure tested end-to-end | P1 | Run backup, verify integrity, test partial restore on a copy |
| 4 | Firewall: only 80, 443, 22 open (3002/3003 NOT exposed) | P1 | `ufw status verbose` on server |
| 5 | SSL cert auto-renewal configured | P1 | `certbot renew --dry-run` — must complete without error |
| 6 | SSL cert expiry > 30 days | P1 | `certbot certificates` — check expiry date |
| 7 | Server timezone set to UTC | P2 | `timedatectl` on server |

---

## Known Production Gaps (Tracked in gap-analysis.md)

| ID | Item | Impact |
|----|------|--------|
| GAP-003 / TD-009 | Notification dedup lost on container restart | Double notification possible after restart |
| GAP-004 / TD-003 | Period rollover fires at 00:05 UTC, not user local midnight | Eastern timezone users get mid-morning rollover |
| TD-001 | No rate limiting | API can be flooded by any user |
| TD-005 | No idempotency key on expense creation | Slow network + retry creates duplicate expenses |
| TD-016 | Bot calls API via `X-TG-DEV` in all environments | Bot `/today` and `/spend` silently fail in production |
| TD-019 | `sendDeficitAlert` exists in `notify.ts` but is never called | Dead code |
| TD-020 | `weeklyDigest` UserSetting exists, no cron implementation | Setting has no effect |

---

## Step-by-Step: Full System Health Check

```bash
ssh root@147.45.213.51
cd /srv/pfm

# 1. Container status
docker compose ps

# 2. API health
curl http://127.0.0.1:3002/health
curl http://127.0.0.1:3002/health/deep

# 3. Public HTTPS
curl https://mytodaylimit.ru/api/health

# 4. Crons scheduled
docker compose logs api | grep "PFM Cron"

# 5. Firewall
ufw status verbose

# 6. SSL cert
certbot certificates

# 7. Last backup
ls -lh /root/backups/pfm/
```

---

## Success Criteria

System is healthy when:

- [ ] All 4 containers show `Up` / `running` in `docker compose ps`
- [ ] `/api/health` returns `{"ok":true,...}`
- [ ] `/api/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] All 4 cron lines visible in `docker compose logs api | grep "PFM Cron"`
- [ ] SSL cert valid and not expiring within 30 days
- [ ] At least one backup file in `/root/backups/pfm/` dated within the last 7 days

---

## Rollback / If Something Goes Wrong

If a check fails during the pre-deploy phase: do not proceed with the deploy until the issue is resolved. Specific failure paths:

- Container not starting → [runbook-rollback.md](./runbook-rollback.md) § Section A
- DB health check failing → [runbook-rollback.md](./runbook-rollback.md) § Section C
- Cron not scheduling → [runbook-cron.md](./runbook-cron.md)

---

## Related Docs

- [runbook-deploy.md](./runbook-deploy.md) — deploy procedure
- [runbook-backup-restore.md](./runbook-backup-restore.md) — backup setup
- [../security/security-privacy-checklist.md](../security/security-privacy-checklist.md) — security controls
- [../delivery/technical-debt-register.md](../delivery/technical-debt-register.md) — debt and gap tracking
- [ops-index.md](./ops-index.md) — ops entry point
