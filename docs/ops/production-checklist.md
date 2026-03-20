# Production Readiness Checklist

Last reviewed: 2026-03-20

Legend: ✅ done | ⚠️ needs attention | ❌ not done | 📋 TODO

---

## Infrastructure

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | SSL certificate active on mytodaylimit.ru | ✅ | Let's Encrypt via Certbot |
| 2 | HTTPS redirect from HTTP (nginx) | ✅ | nginx: HTTP → HTTPS redirect block |
| 3 | Nginx config: /miniapp → 127.0.0.1:3003 | ✅ | |
| 4 | Nginx config: /api/ → 127.0.0.1:3002 (strips /api prefix) | ✅ | |
| 5 | Nginx config: / → /miniapp redirect | ✅ | |
| 6 | Firewall: only 80, 443, 22 open externally | ⚠️ | Verify with: `ufw status` — should show 3002/3003 NOT in list |
| 7 | API port 3002 bound to 127.0.0.1 only | ✅ | `127.0.0.1:3002:3002` in docker-compose.yml |
| 8 | Web port 3003 bound to 127.0.0.1 only | ✅ | `127.0.0.1:3003:3003` in docker-compose.yml |
| 9 | SSL cert auto-renewal configured | 📋 | Run: `certbot renew --dry-run` to verify cron exists |
| 10 | Server timezone set correctly | ⚠️ | Run: `timedatectl` — UTC is recommended for server |

**Verify firewall:**
```bash
ufw status verbose
```

**Verify SSL cert expiry:**
```bash
certbot certificates
```

---

## Application

| # | Item | Status | Notes |
|---|------|--------|-------|
| 11 | All 4 containers running (postgres, api, bot, web) | ✅ | Check: `docker compose ps` |
| 12 | postgres healthcheck passing | ✅ | `docker compose ps` shows `healthy` |
| 13 | Prisma migrations applied (`db push`) | ✅ | Runs in API container CMD on startup |
| 14 | /health endpoint returns `{"ok":true}` | ✅ | `curl https://mytodaylimit.ru/api/health` |
| 15 | /health/deep returns `{"ok":true,"db":true}` | ✅ | Tests DB connection |
| 16 | All containers set to `restart: unless-stopped` | ✅ | In docker-compose.yml |
| 17 | NODE_ENV=production in all containers | ✅ | Set in docker-compose.yml |

---

## Bot

| # | Item | Status | Notes |
|---|------|--------|-------|
| 18 | BOT_TOKEN set in /srv/pfm/.env | ✅ | |
| 19 | Bot running in polling mode (not webhook) | ✅ | Verify: `docker compose logs bot` shows polling started |
| 20 | MINI_APP_URL set to https://mytodaylimit.ru/miniapp | ✅ | Used for menu button URL |
| 21 | Bot menu button configured via @BotFather | ⚠️ | Verify by opening the bot in Telegram and checking for menu button |
| 22 | /start command works | ⚠️ | Test manually: send `/start` to bot |

---

## Security

| # | Item | Status | Notes |
|---|------|--------|-------|
| 23 | ADMIN_KEY set to a strong random value | ✅ | Check `/srv/pfm/.env` — should not be default/empty |
| 24 | X-TG-DEV bypass blocked in production | ✅ | Code: only active when `NODE_ENV !== 'production'` |
| 25 | Telegram initData HMAC-SHA256 validation enabled | ✅ | `validateTelegramInitData` in apps/api/src/index.ts |
| 26 | POSTGRES_PASSWORD does not contain special chars | ✅ | Learned the hard way — alphanumeric only |
| 27 | .env file not in git repository | ✅ | Verify: `cat .gitignore | grep .env` |
| 28 | Rate limiting on API routes | ❌ | TODO: add express-rate-limit |
| 29 | CORS origins verified | ⚠️ | Currently `cors()` with no origin restriction — see security checklist |

See full security details: [../security/security-privacy-checklist.md](../security/security-privacy-checklist.md)

---

## Monitoring

| # | Item | Status | Notes |
|---|------|--------|-------|
| 30 | Logs accessible via `docker compose logs` | ✅ | |
| 31 | /health endpoint responds < 500ms | ⚠️ | Test: `curl -w "%{time_total}" https://mytodaylimit.ru/api/health` |
| 32 | Error logs checked after each deploy | 📋 | Manual step — always run `docker compose logs --tail=50` post-deploy |
| 33 | Uptime monitoring configured | ❌ | TODO: set up UptimeRobot or similar free monitor on /api/health |

---

## Backup

| # | Item | Status | Notes |
|---|------|--------|-------|
| 34 | postgres_data volume exists | ✅ | `docker volume ls | grep pfm_postgres_data` |
| 35 | Daily backup cron configured on server | 📋 | Set up per runbook-backup-restore.md |
| 36 | Backup stored off-server | ❌ | TODO: configure rclone or manual scp |
| 37 | Most recent backup verified (non-empty, valid gzip) | 📋 | Run: `gunzip -t <backup> && echo OK` |

---

## Cron

| # | Item | Status | Notes |
|---|------|--------|-------|
| 38 | Cron 1 (notification dispatcher, every min) scheduled | ✅ | Check: `docker compose logs api | grep "PFM Cron"` |
| 39 | Cron 2 (daily snapshot, 23:55 UTC) scheduled | ✅ | |
| 40 | Cron 3 (payment alerts, 09:00 UTC) scheduled | ✅ | |
| 41 | Cron 4 (period rollover, 00:05 UTC) scheduled | ✅ | |
| 42 | At least one notification delivered successfully in prod | ⚠️ | Verify by checking user reports or bot logs |

---

## Performance

| # | Item | Status | Notes |
|---|------|--------|-------|
| 43 | Next.js built in standalone mode (`output: 'standalone'`) | ✅ | In apps/web/next.config.js |
| 44 | Next.js runs in production mode (no hot reload) | ✅ | NODE_ENV=production in container |
| 45 | Postgres indexes on frequently queried columns | ⚠️ | Check schema: indexes on userId, periodId, status, spentAt are critical |
| 46 | API response times acceptable (< 300ms for dashboard) | 📋 | TODO: measure with `curl -w "%{time_total}"` |

**Check indexes:**
```bash
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename;"
```

---

## Summary: Items Requiring Action

| Priority | Item | Action |
|----------|------|--------|
| HIGH | Rate limiting (item 28) | Add express-rate-limit to API |
| HIGH | Daily backup cron (item 35) | Set up crontab per runbook-backup-restore.md |
| MEDIUM | Off-server backup (item 36) | Configure rclone or scheduled scp |
| MEDIUM | Uptime monitoring (item 33) | Register on UptimeRobot, ping /api/health |
| MEDIUM | CORS origins (item 29) | Restrict to mytodaylimit.ru |
| LOW | Bot menu button (item 21) | Verify in Telegram client |
| LOW | SSL auto-renewal (item 9) | Run `certbot renew --dry-run` |
