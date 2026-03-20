---
title: "Production Readiness Checklist"
document_type: Operational
status: Active
source_of_truth: "YES — for production system health status"
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - ops-index.md
  - runbook-deploy.md
  - runbook-backup-restore.md
  - ../security/security-privacy-checklist.md
  - ../delivery/technical-debt-register.md
---

# Production Readiness Checklist

Legend: ✅ verified in production | ⚠️ requires manual check | ❌ confirmed missing / not done

---

## 1. Verified in Production

Items confirmed working. Re-verify after any deploy that touches the relevant area.

| # | Item | Last verified | Method |
|---|------|---------------|--------|
| 1 | SSL certificate active on mytodaylimit.ru | 2026-03-20 | Let's Encrypt via Certbot — `certbot certificates` |
| 2 | HTTPS redirect from HTTP (nginx) | 2026-03-20 | nginx HTTP → HTTPS redirect block |
| 3 | Nginx: /miniapp → 127.0.0.1:3003 | 2026-03-20 | `curl https://mytodaylimit.ru/miniapp` |
| 4 | Nginx: /api/ → 127.0.0.1:3002 (strips /api prefix) | 2026-03-20 | `curl https://mytodaylimit.ru/api/health` |
| 5 | Nginx: / → /miniapp redirect | 2026-03-20 | Browser check |
| 6 | API port 3002 bound to 127.0.0.1 only | 2026-03-20 | `127.0.0.1:3002:3002` in docker-compose.yml |
| 7 | Web port 3003 bound to 127.0.0.1 only | 2026-03-20 | `127.0.0.1:3003:3003` in docker-compose.yml |
| 8 | All 4 containers running with `restart: unless-stopped` | 2026-03-20 | `docker compose ps` |
| 9 | postgres healthcheck passing | 2026-03-20 | `docker compose ps` shows `healthy` |
| 10 | `prisma db push` applied on API startup | 2026-03-20 | Runs in API container CMD — confirmed in logs |
| 11 | /health endpoint returns `{"ok":true}` | 2026-03-20 | `curl https://mytodaylimit.ru/api/health` |
| 12 | /health/deep returns `{"ok":true,"db":true}` | 2026-03-20 | Tests live DB connection |
| 13 | NODE_ENV=production in all containers | 2026-03-20 | Set in docker-compose.yml |
| 14 | BOT_TOKEN set in /srv/pfm/.env | 2026-03-20 | `cat /srv/pfm/.env \| grep BOT_TOKEN` |
| 15 | Bot running in polling mode | 2026-03-20 | `docker compose logs bot` shows polling started |
| 16 | MINI_APP_URL set to https://mytodaylimit.ru/miniapp | 2026-03-20 | Confirmed in .env |
| 17 | ADMIN_KEY set to non-default value | 2026-03-20 | Checked in .env |
| 18 | X-TG-DEV bypass blocked in production | 2026-03-20 | Code: `NODE_ENV !== 'production'` guard in tgAuth middleware |
| 19 | Telegram initData HMAC-SHA256 validation enabled | 2026-03-20 | `validateTelegramInitData` active in index.ts |
| 20 | auth_date freshness check (1h TTL) | 2026-03-20 | Added 2026-03-20 — rejects initData older than 1 hour |
| 21 | CORS restricted to mytodaylimit.ru origin | 2026-03-20 | Added 2026-03-20 — `cors({ origin: 'https://mytodaylimit.ru' })` |
| 22 | POSTGRES_PASSWORD does not contain special chars | 2026-03-20 | Alphanumeric only — learned from failed deploy |
| 23 | .env file not in git | 2026-03-20 | `cat .gitignore \| grep .env` |
| 24 | Cron 1 (notification dispatcher) scheduled | 2026-03-20 | `docker compose logs api \| grep "PFM Cron"` |
| 25 | Cron 2 (daily snapshot, 23:55 UTC) scheduled | 2026-03-20 | `docker compose logs api \| grep "PFM Cron"` |
| 26 | Cron 3 (payment alerts, 09:00 UTC) scheduled | 2026-03-20 | `docker compose logs api \| grep "PFM Cron"` |
| 27 | Cron 4 (period rollover, 00:05 UTC) scheduled | 2026-03-20 | `docker compose logs api \| grep "PFM Cron"` |
| 28 | Next.js built in standalone mode (`output: 'standalone'`) | 2026-03-20 | `grep standalone apps/web/next.config.js` |
| 29 | postgres_data Docker volume exists | 2026-03-20 | `docker volume ls \| grep pfm_postgres_data` |

---

## 2. Requires Manual Verification

Items that need a human to check — either periodically or after specific events.

| # | Item | Priority | How to verify |
|---|------|----------|---------------|
| 30 | Firewall: only 80, 443, 22 open externally (3002/3003 NOT exposed) | P1 | `ufw status verbose` on server |
| 31 | SSL cert auto-renewal configured | P1 | `certbot renew --dry-run` — must complete without error |
| 32 | SSL cert expiry > 30 days | P1 | `certbot certificates` — check expiry date |
| 33 | Server timezone set to UTC | P2 | `timedatectl` on server — UTC recommended |
| 34 | Bot menu button configured via @BotFather | P2 | Open bot in Telegram — verify menu button appears |
| 35 | /start command works end-to-end | P2 | Send `/start` to bot — verify response |
| 36 | At least one notification delivered successfully | P2 | Check user reports or `docker compose logs bot \| grep sendMessage` |
| 37 | /health endpoint responds < 500ms | P2 | `curl -w "%{time_total}" https://mytodaylimit.ru/api/health` |
| 38 | Postgres indexes exist on userId, periodId, status, spentAt | P2 | `SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename;` |
| 39 | Prisma db push vs migrate deploy | P1 | Current mode is `db push` on startup — TEMPORARY MVP MODE. Target: `prisma migrate deploy` with proper migration files. Tracked as technical debt. |
| 40 | No automated DB backup schedule | P1 | Check crontab on server: `crontab -l`. If no backup cron exists, set up per runbook-backup-restore.md. |

---

## 3. Known Gaps / Not Done

Items confirmed missing. Each has an assigned debt ID in the technical debt register.

| # | Item | Impact | Fix reference |
|---|------|--------|---------------|
| 41 | ❌ Rate limiting on API endpoints | Any user or bot can flood POST /tg/expenses or spam /tg/dashboard, causing DB overload | TD-001: add express-rate-limit middleware per userId |
| 42 | ❌ Off-server backup storage | If server is lost, all data is gone | Set up rclone or scheduled scp to external storage |
| 43 | ❌ Uptime monitoring | Outages not detected automatically | Register /api/health on UptimeRobot or similar |
| 44 | ❌ Idempotency key on expense creation | Slow network + retry creates duplicate expenses | TD-005: add Idempotency-Key header handling |
| 45 | ❌ /delete user data command | Users cannot delete their account (GDPR right to erasure) | TD-007: implement /delete in bot + DELETE /tg/me API |
| 46 | ❌ Notification dedup persisted to DB | Dedup lost on container restart → double-send possible | TD-009: move notifLog to DB table |
| 47 | ❌ Bot calls API via X-TG-DEV in all environments | Bot /today and /spend silently fail in production | TD-016: bot should use /internal/* routes with X-Internal-Key |
| 48 | ❌ Weekly digest cron | weeklyDigest UserSetting exists, no cron implementation | TD-020 |
| 49 | ❌ sendDeficitAlert never called | Function exists in notify.ts, dead code | TD-019 |
| 50 | ❌ Automated daily backup cron | Manual backup only — risky for production | Set up per runbook-backup-restore.md |

---

## Verify Commands Reference

```bash
# All containers running
docker compose -f /srv/pfm/docker-compose.yml ps

# Health check
curl https://mytodaylimit.ru/api/health
curl http://127.0.0.1:3002/health/deep

# Crons scheduled
docker compose -f /srv/pfm/docker-compose.yml logs api | grep "PFM Cron"

# Firewall
ufw status verbose

# SSL cert expiry
certbot certificates

# Last DB backup
ls -lh /root/backups/pfm/

# Postgres indexes
docker compose -f /srv/pfm/docker-compose.yml exec postgres psql -U pfm -d pfmdb \
  -c "SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename;"
```
