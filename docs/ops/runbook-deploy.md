---
title: "Runbook: Deploy"
document_type: Operational
status: Active
source_of_truth: "YES — for production deploy procedure"
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - runbook-rollback.md
  - runbook-cron.md
  - release-rules.md
  - ops-index.md
---

# Runbook: Deploy

---

## When to Use

Use this runbook whenever you are deploying new code from `main` to the production server.
This includes feature releases, bug fixes, hotfixes, and infra-only changes.

For rollback procedures, see [runbook-rollback.md](./runbook-rollback.md).
For release classification (logic-affecting vs. infra-only), see [release-rules.md](./release-rules.md).

---

## Prerequisites

- SSH access to `root@147.45.213.51` is working
- Changes are committed and pushed: `git push origin main`
- `/srv/pfm/.env` on server is current (see Environment Variables section below)
- You have ~10 minutes and are not in a high-risk cron window:
  - Do NOT deploy between 23:45–00:15 UTC (snapshot + rollover cron window)
  - Do NOT deploy between 08:55–09:05 UTC (payment alerts cron window)
- If this is a logic-affecting release (touches engine.ts, cron.ts, period bounds): complete
  the Logic-Affecting Release checklist in [release-rules.md](./release-rules.md) first.

---

## Full Deploy Procedure

```bash
ssh root@147.45.213.51

cd /srv/pfm

# 1. Pull latest code — always use reset, never merge.
#    Server Dockerfiles may have local edits; reset discards them.
git fetch origin main
git reset --hard origin/main

# 2. (If Docker Hub rate limit error during build — log in first)
# docker login

# 3. Build and start all services
docker compose up -d --build
```

Expect ~2–3 minutes for build. Downtime is ~30 seconds while containers restart.
Postgres is not rebuilt — it uses a stock image and retains the data volume.

---

## Service-Specific Deploy

Use when only one service changed, to minimize downtime and risk.

```bash
cd /srv/pfm

# Rebuild and restart only the api container
docker compose up -d --build api

# Rebuild and restart only the web container
docker compose up -d --build web

# Rebuild and restart only the bot container
docker compose up -d --build bot
```

**Note:** Dependent services are not automatically restarted. If api changes break bot
or web behavior, rebuild those services separately. Postgres is never rebuilt in partial
deploys.

---

## Logic-Affecting Release (Special Rules)

A release is logic-affecting if it changes `engine.ts`, `cron.ts`, period bounds
calculation, income allocation, or debt payoff logic.

**Before deploying:**

1. Update `formulas-and-calculation-policy.md` to reflect the new formula. Do this in
   the same commit or before the release commit.
2. Run a manual smoke test against production before the deploy (capture the before state):
   ```bash
   curl https://mytodaylimit.ru/api/tg/dashboard \
     -H "X-TG-Init-Data: <your-real-initData>" | jq '.s2sToday, .s2sDaily, .s2sPeriod'
   ```
   Record the values.
3. Deploy the code.
4. Run the same curl again and compare before/after for at least one test user.
5. If a known gap in `gap-analysis.md` is closed by this release, mark it closed in that
   doc and commit the update.

**Commit message format for logic-affecting releases:**
```
fix: correct prorate logic for mid-period income

Logic change: income now prorated by days remaining in period, not full period length.
s2sToday increases for users who onboard mid-period.
```

---

## Success Criteria

Deploy is successful when ALL of the following are true:

- [ ] `docker compose ps` shows all 4 services as `Up` / `running` — no `Exit` or `Restarting`
- [ ] `curl http://127.0.0.1:3002/health` returns `{"ok":true,...}`
- [ ] `curl http://127.0.0.1:3002/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] `curl https://mytodaylimit.ru/api/health` returns `{"ok":true,...}`
- [ ] `docker compose logs api | grep "Running on port 3002"` shows the line
- [ ] `docker compose logs api | grep "PFM Cron"` shows all 4 crons scheduled
- [ ] No stack traces in last 50 log lines of api, bot, or web

---

## Verify Deploy Succeeded

### 1. Check all containers are running

```bash
docker compose ps
```

Expected: all four services show `Up` or `running`. No `Exit` or `Restarting`.

### 2. Check API health

```bash
curl http://127.0.0.1:3002/health
# Expected: {"ok":true,"timestamp":"..."}

curl http://127.0.0.1:3002/health/deep
# Expected: {"ok":true,"db":true,"timestamp":"..."}
```

### 3. Check public HTTPS endpoint

```bash
curl https://mytodaylimit.ru/api/health
# Expected: {"ok":true,...}
```

### 4. Tail logs for errors

```bash
# All services (last 50 lines, then follow)
docker compose logs --tail=50 -f

# API only
docker compose logs --tail=100 api

# Bot only
docker compose logs --tail=50 bot

# Web only
docker compose logs --tail=50 web
```

Look for: stack traces, `Error:`, `ECONNREFUSED`, Prisma errors.

### 5. Confirm cron started

```bash
docker compose logs api | grep "PFM Cron"
# Expected lines: notifications (every min), snapshots (23:55), payment alerts (09:00), rollover (00:05)
```

---

## Service Healthy but Financial Numbers Are Wrong

If `curl https://mytodaylimit.ru/api/health` returns 200 but a user reports wrong S2S:

1. **Check the user's active period in DB:**
   ```bash
   docker compose exec postgres psql -U pfm -d pfmdb \
     -c "SELECT id, \"startDate\", \"endDate\", \"s2sDaily\", \"s2sPeriod\", \"totalIncome\", \"totalObligations\" FROM \"Period\" WHERE status = 'ACTIVE' AND \"userId\" = '<user-id>';"
   ```

2. **Trigger a recalculate for the user** (this recomputes period bounds and S2S from
   current incomes/obligations/debts without creating a new period):
   ```bash
   # In production, must use real initData from the user's Telegram mini app session
   # In dev mode only:
   curl -X POST http://127.0.0.1:3002/tg/periods/recalculate \
     -H "X-TG-DEV: <telegram-user-id>" \
     -H "Content-Type: application/json"
   ```

3. **Check which engine formula version is running:**
   ```bash
   docker compose logs api | grep "Running on port 3002"
   # Confirm the build timestamp matches the expected commit
   git log --oneline -3
   ```

4. **If numbers still wrong after recalculate:** this is likely a logic bug. See
   [runbook-rollback.md](./runbook-rollback.md) § Logic Rollback, and file a report using
   [../delivery/logic-issue-template.md](../delivery/logic-issue-template.md).

---

## Common Build Failures and Fixes

### Lockfile out of sync (`frozen-lockfile` error)

```
ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date
```

**Cause:** Server has local package.json changes diverging from the lockfile.

**Fix:** The `git reset --hard origin/main` in step 1 resolves this by discarding
server-side changes. If it persists, check if local Dockerfiles override `--frozen-lockfile`:

```bash
grep -n frozen apps/api/Dockerfile apps/bot/Dockerfile apps/web/Dockerfile
```

If needed, temporarily change `--frozen-lockfile` to `--no-frozen-lockfile` in the
offending Dockerfile, deploy, then revert.

### Docker Hub rate limit

```
toomanyrequests: You have reached your pull rate limit
```

**Fix:**
```bash
docker login
# Enter Docker Hub credentials
docker compose up -d --build
```

### Prisma binary not found

```
Error: Generator "client" failed: Can't find binary "query-engine"
```

**Fix:** The CMD in `apps/api/Dockerfile` uses `packages/db/node_modules/.bin/prisma`.
Verify this line in the Dockerfile:

```
CMD ["sh", "-c", "packages/db/node_modules/.bin/prisma db push ..."]
```

Do not use `/app/node_modules/.bin/prisma` — that binary is not guaranteed to be present.

### Web build fails (standalone mode)

```
Error: ENOENT: no such file or directory, open '.next/standalone/...'
```

**Cause:** `output: 'standalone'` in `next.config.js` is required.

**Fix:**
```bash
grep standalone apps/web/next.config.js
```

If missing, add `output: 'standalone'` to the Next.js config and redeploy.

### Postgres not healthy (api fails to start)

```
api | Error: Can't reach database server
```

**Cause:** Postgres container is still starting when API tries to connect.

**Fix:** The `depends_on` with healthcheck should handle this. If it fails, wait 30s and
restart only api:

```bash
docker compose restart api
```

---

## Note: prisma db push on Startup — TEMPORARY MVP MODE

The API container CMD currently runs `prisma db push` on every startup:
```
packages/db/node_modules/.bin/prisma db push --schema=... && node apps/api/dist/index.js
```

This is intentional for the MVP phase but is NOT production-grade. `db push` does not
create migration files and cannot be safely rolled back.

**Target state:** Replace with `prisma migrate deploy` using proper migration files.
This is tracked as TD-022-adjacent in the debt register. Until then, take a manual backup
before any schema-changing deploy.

---

## Escalation Path

If a deploy cannot be recovered by standard means:

1. Stop writing to the DB immediately: `docker compose stop api bot`
2. Take a backup of the current DB state (even if corrupted — better than nothing):
   ```bash
   docker compose exec postgres pg_dump -U pfm pfmdb | gzip > /root/backups/pfm/emergency_$(date +%Y%m%d_%H%M).sql.gz
   ```
3. Execute a code rollback per [runbook-rollback.md](./runbook-rollback.md).
4. If DB schema is broken, proceed to DB restore per the same runbook.
5. If still broken after rollback + restore: assess data integrity manually in psql before
   bringing API back up.

---

## Rollback

If the deploy broke something, see [runbook-rollback.md](./runbook-rollback.md).

---

## Environment Variables

All secrets live in `/srv/pfm/.env` on the server. The file is NOT in git.

### View current values

```bash
cat /srv/pfm/.env
```

### Update a single variable

```bash
nano /srv/pfm/.env

# After editing, restart the affected service(s) to pick up the new value
docker compose up -d --no-build api
# or
docker compose up -d --no-build bot
```

### Required variables

```
BOT_TOKEN=          # Telegram Bot Token from @BotFather
ADMIN_KEY=          # Secret key for /internal routes
POSTGRES_USER=      # Postgres username
POSTGRES_PASSWORD=  # Postgres password — avoid special chars (!, @, #) in value
POSTGRES_DB=        # Database name
MINI_APP_URL=       # https://mytodaylimit.ru/miniapp
GOD_MODE_TELEGRAM_IDS=  # Comma-separated Telegram IDs with free PRO access
```

### Important: POSTGRES_PASSWORD

Do not use special characters (`!`, `@`, `#`, `$`, `%`, `&`) in POSTGRES_PASSWORD.
The password is embedded in the DATABASE_URL connection string and special chars cause
URL parsing failures. Use alphanumeric + underscore only.
