---
title: "Runbook: Deploy"
document_type: Operational
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - path: ./ops-index.md
    relation: "ops entry point"
  - path: ./runbook-rollback.md
    relation: "if deploy breaks something"
  - path: ./release-rules.md
    relation: "release classification"
  - path: ./runbook-backup-restore.md
    relation: "take backup before risky deploys"
---

# Runbook: Deploy

---

## When to Use

Use this runbook whenever deploying new code from `main` to the production server. Covers feature releases, bug fixes, hotfixes, and infra-only changes.

For rollback procedures, see [runbook-rollback.md](./runbook-rollback.md).
For release classification (logic-affecting vs. infra-only), see [release-rules.md](./release-rules.md).

---

## Prerequisites

- SSH access to `root@147.45.213.51` is working
- Changes are committed and pushed: `git push origin main`
- `/srv/pfm/.env` on the server is current and contains all required variables
- If this is a logic-affecting release (touches `engine.ts`, `cron.ts`, period bounds): complete the Logic-Affecting Release checklist in [release-rules.md](./release-rules.md) first
- You are NOT in a high-risk cron window:
  - Do NOT deploy between 23:45–00:15 UTC (snapshot + rollover cron window)
  - Do NOT deploy between 08:55–09:05 UTC (payment alerts cron window)

---

## Standard Deploy Procedure

```bash
ssh root@147.45.213.51

cd /srv/pfm

# Pull latest code — always use reset, never merge.
git fetch origin
git reset --hard origin/main

# Build and start all services
docker compose up -d --build
```

Expect ~2–3 minutes for build. Downtime is ~30 seconds while containers restart. Postgres is not rebuilt — it uses a stock image and retains the data volume.

---

## Full Rebuild (All Services)

Use when a dependency or base image change requires all services to rebuild:

```bash
docker compose up -d --build
```

---

## Service-Specific Deploy

Use when only one service changed, to minimize downtime and risk:

```bash
# Rebuild and restart only the api container
docker compose up -d --build api

# Rebuild and restart only the web container
docker compose up -d --build web

# Rebuild and restart only the bot container
docker compose up -d --build bot
```

Dependent services are not automatically restarted. If api changes break bot or web behavior, rebuild those services separately.

---

## DB Migration (After Schema Changes)

The API container CMD currently runs `prisma db push` on every startup. This is intentional for MVP but is not production-grade.

```bash
# Verify migration ran on startup:
docker compose logs api | grep "prisma db push\|migrate"

# If needed, run manually inside the running container:
docker compose exec api sh -c "packages/db/node_modules/.bin/prisma migrate deploy --schema=packages/db/prisma/schema.prisma"
```

**Important:** Never use `prisma db push` in production for schema changes — it does not create migration files and cannot be safely rolled back. See [release-rules.md](./release-rules.md) § Migration Policy.

---

## Verification Steps

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

### 4. Check logs for errors

```bash
docker compose logs --tail=20 api
```

Look for: stack traces, `Error:`, `ECONNREFUSED`, Prisma errors.

### 5. Confirm cron started

```bash
docker compose logs api | grep "PFM Cron"
# Expected: lines showing all 4 crons scheduled
```

---

## Success Criteria

Deploy is successful when ALL of the following are true:

- [ ] `docker compose ps` shows all 4 services as `Up` / `running` — no `Exit` or `Restarting`
- [ ] `curl http://127.0.0.1:3002/health` returns `{"ok":true,...}`
- [ ] `curl http://127.0.0.1:3002/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] `curl https://mytodaylimit.ru/api/health` returns `{"ok":true,...}`
- [ ] `docker compose logs api | grep "PFM Cron"` shows all 4 crons scheduled
- [ ] No stack traces in last 50 log lines of api, bot, or web

---

## Rollback Trigger

If health check fails after deploy, or logs show critical errors, proceed to [runbook-rollback.md](./runbook-rollback.md).

---

## Logic-Affecting Releases

A release is logic-affecting if it changes `engine.ts`, `cron.ts`, period bounds calculation, income allocation, or debt payoff logic. These releases must also:

1. Update `formulas-and-calculation-policy.md` to reflect the new formula (in the same commit or before the release commit)
2. Capture a before/after payload for at least one user:
   ```bash
   curl https://mytodaylimit.ru/api/tg/dashboard \
     -H "X-TG-Init-Data: <your-real-initData>" | jq '.s2sToday, .s2sDaily, .s2sPeriod'
   ```
3. Deploy the code, then run the same curl and compare before/after values
4. If a known gap in `gap-analysis.md` is closed by this release, mark it closed in that doc

---

## Note: /srv/pfm/.env Is Not in Git

The env file must be managed manually on the server. To update a variable:

```bash
nano /srv/pfm/.env

# After editing, restart the affected service to pick up the new value:
docker compose up -d --no-build api
# or
docker compose up -d --no-build bot
```

Required variables: `DATABASE_URL`, `BOT_TOKEN`, `ADMIN_KEY`, `API_PORT=3002`, `MINI_APP_URL`, `NEXT_PUBLIC_API_URL`, `NODE_ENV`, `GOD_MODE_TELEGRAM_IDS`.

**Important:** Do not use special characters (`!`, `@`, `#`, `$`, `%`, `&`) in `POSTGRES_PASSWORD`. The password is embedded in the `DATABASE_URL` connection string and special chars cause URL parsing failures.

---

## If Something Goes Wrong

See [runbook-rollback.md](./runbook-rollback.md) for the full decision tree. Quick reference:

- Containers exiting or health check red → Section A: Container Rollback
- Health green but numbers wrong → Section B: Logic Rollback
- Prisma schema errors or data corruption → Section C: DB Restore
