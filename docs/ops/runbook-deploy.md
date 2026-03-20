# Runbook: Deploy

## Prerequisites

- SSH access to `root@147.45.213.51` is working
- Local changes are committed and pushed: `git push origin main`
- `/srv/pfm/.env` on server is current (see Environment Variables section below)

---

## Full Deploy Procedure

```bash
ssh root@147.45.213.51

cd /srv/pfm

# 1. Pull latest code — use reset because server Dockerfiles may have local edits
git fetch origin main
git reset --hard origin/main

# 2. (If Docker Hub rate limit error during build — log in first)
# docker login

# 3. Build and start all services
docker compose up -d --build
```

This will rebuild all four images (postgres is not rebuilt — it uses a stock image) and
restart containers. Expect ~2–3 minutes for build. Downtime is ~30 seconds while
containers restart.

---

## Deploy Only One Service

Useful when only one app changed (e.g., only API was modified).

```bash
cd /srv/pfm

# Rebuild and restart only the api container
docker compose up -d --build api

# Or only the web container
docker compose up -d --build web

# Or only the bot container
docker compose up -d --build bot
```

Postgres is never rebuilt in partial deploys. Dependent services (bot, web depend on api)
will not be restarted automatically — that is intentional for partial deploys.

---

## Verify Deploy Succeeded

### 1. Check all containers are running

```bash
docker compose ps
```

Expected output: all four services show `Up` or `running` status. No `Exit` or `Restarting`.

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
# Expected: [PFM Cron] Scheduled: notifications (every min), snapshots (23:55), ...
```

---

## Common Build Failures and Fixes

### Lockfile out of sync (`frozen-lockfile` error)

```
ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date
```

**Cause:** Server has local package.json changes diverging from the lockfile.

**Fix:** The `git reset --hard origin/main` in step 2 above resolves this by discarding
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

**Fix:** The CMD in `apps/api/Dockerfile` uses the path
`packages/db/node_modules/.bin/prisma`. Verify this line in the Dockerfile:

```
CMD ["sh", "-c", "packages/db/node_modules/.bin/prisma db push ..."]
```

Do not use `/app/node_modules/.bin/prisma` — that binary is not guaranteed to be present.

### Web build fails (standalone mode)

```
Error: ENOENT: no such file or directory, open '.next/standalone/...'
```

**Cause:** `output: 'standalone'` in `next.config.js` is required. Check it is set.

**Fix:**

```bash
cat apps/web/next.config.js | grep standalone
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
# Edit in place
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
