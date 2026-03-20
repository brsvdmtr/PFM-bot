# Runbook: Cron Jobs

Cron jobs run inside the `api` container. They are registered on API startup in
`apps/api/src/cron.ts` and use `node-cron`. All times are UTC unless noted.

---

## Cron Job Registry

### Cron 1 — Notification Dispatcher
- **Schedule:** `* * * * *` — every minute, 24/7
- **Purpose:** Send morning and evening S2S notifications to users at their configured
  local times.
- **What it does:**
  1. Loads all users with `telegramChatId` set and `onboardingDone = true`.
  2. Converts current UTC time to each user's IANA timezone.
  3. If `localTime == morningNotifyTime` and not yet notified today → sends morning
     notification with today's S2S limit, daily S2S, days left, and status.
  4. Same logic for `eveningNotifyTime` → sends evening summary with today's total
     spending vs. daily limit.
  5. In-memory dedup map prevents duplicate sends within the same UTC day.
- **Log prefix:** `[PFM Cron] Notification dispatch error:`

### Cron 2 — Daily Snapshot
- **Schedule:** `55 23 * * *` — 23:55 UTC every day
- **Purpose:** Save a daily spending snapshot for each active period (used in analytics).
- **What it does:**
  1. Finds all periods with `status = ACTIVE`.
  2. For each period: calculates today's expenses, remaining S2S budget, planned vs.
     actual S2S.
  3. Upserts a `DailySnapshot` row keyed by `(periodId, date)`.
  4. Sets `isOverspent = true` if today's spending exceeded the planned daily limit.
- **Log prefix:** `[PFM Cron] Saving daily snapshots...` / `[PFM Cron] Saved N snapshots`

### Cron 3 — Payment Alerts
- **Schedule:** `0 9 * * *` — 09:00 UTC every day
- **Purpose:** Alert users about debt payments due today or tomorrow.
- **What it does:**
  1. Finds users with `paymentAlerts = true` and unpaid debts where `dueDay` matches
     today's or tomorrow's day-of-month.
  2. Sends a Telegram message per debt via `sendPaymentAlert`.
  3. Uses the same in-memory dedup map as Cron 1, keyed `userId:payment:<debtId>`.
- **Log prefix:** `[PFM Cron] Checking payment alerts...`

### Cron 4 — Period Rollover
- **Schedule:** `5 0 * * *` — 00:05 UTC every day
- **Purpose:** Automatically close expired periods and create new ones.
- **What it does:**
  1. Finds all `ACTIVE` periods where `endDate <= today`.
  2. Calculates savings from the old period (`s2sPeriod - totalSpent`).
  3. Marks old period as `COMPLETED`.
  4. Recalculates period bounds using the user's paydays.
  5. Runs `calculateS2S` with current incomes, obligations, debts, and emergency fund.
  6. Creates a new `ACTIVE` period.
  7. Sends `sendNewPeriodNotification` with new daily S2S and amount saved/overspent.
- **Log prefix:** `[PFM Cron] Checking period rollovers...` /
  `[PFM Cron] Rolled over period for user <id>`

---

## How to Check if a Cron Fired

```bash
ssh root@147.45.213.51
cd /srv/pfm

# Check recent cron activity (last 200 log lines from api)
docker compose logs --tail=200 api | grep "PFM Cron"

# Watch in real time (useful for notification dispatcher — fires every minute)
docker compose logs -f api | grep "PFM Cron"

# Check rollover specifically
docker compose logs api | grep "Rollover\|Rolled over"

# Check snapshot saves
docker compose logs api | grep "snapshot"

# Check payment alerts
docker compose logs api | grep "payment alert"
```

**Note:** Cron 1 (notification dispatcher) only logs on error. Crons 2–4 log on every
run with a status line.

---

## How to Manually Trigger Period Rollover

If a period should have rolled over but did not (e.g., after a crash during rollover, or
for testing), you can force it manually.

### Option 1: Force rollover via psql (mark period as expired, then let cron pick it up)

```bash
docker compose exec postgres psql -U pfm -d pfmdb

-- Find the active period to expire
SELECT id, "userId", "startDate", "endDate", status FROM "Period" WHERE status = 'ACTIVE';

-- Set endDate to yesterday so the 00:05 cron picks it up
UPDATE "Period"
SET "endDate" = NOW() - INTERVAL '1 day'
WHERE id = '<period-id>';

\q
```

Then wait for 00:05 UTC, or restart the API container (cron fires on schedule after
restart).

### Option 2: Call the recalculate endpoint as the user

This does not roll over the period but recalculates S2S for the current period bounds.
Useful after manually editing incomes/obligations in DB.

```bash
# Requires a valid X-TG-INIT-DATA header — call from the mini app context
# Or in dev mode, use X-TG-DEV:
curl -X POST http://127.0.0.1:3002/tg/periods/recalculate \
  -H "X-TG-DEV: <telegram-user-id>" \
  -H "Content-Type: application/json"
```

In production, X-TG-DEV is blocked. Use a real initData token from the Telegram mini app.

---

## How to Disable a Specific Cron

There is no runtime switch. Disabling a cron requires a code change.

**Procedure:**

1. In `apps/api/src/cron.ts`, comment out the `cron.schedule(...)` block for the target
   job.
2. Commit, push, and deploy:
   ```bash
   git add apps/api/src/cron.ts
   git commit -m "chore: disable <cron name> temporarily"
   git push origin main
   ```
3. On server:
   ```bash
   cd /srv/pfm && git reset --hard origin/main && docker compose up -d --build api
   ```
4. Re-enable by reverting the comment and redeploying.

---

## Common Cron Failures and Fixes

### Notification not delivered to user

**Symptoms:** User reports not receiving morning/evening notification.

**Diagnosis:**
```bash
docker compose logs api | grep "Notification dispatch error"
```

**Possible causes:**
- `telegramChatId` is null for the user. The bot stores this on `/start`. Ask user to
  send `/start` to the bot.
- User's `onboardingDone = false`. Check:
  ```bash
  docker compose exec postgres psql -U pfm -d pfmdb \
    -c "SELECT \"telegramId\", \"onboardingDone\", \"telegramChatId\" FROM \"User\" WHERE \"telegramId\" = '<id>';"
  ```
- `morningNotifyEnabled = false` in UserSettings. User can toggle in Settings screen.
- User's timezone is wrong — time comparison fails. Check `timezone` column in User table.
- BOT_TOKEN is invalid or expired. Check:
  ```bash
  curl "https://api.telegram.org/bot$(grep BOT_TOKEN /srv/pfm/.env | cut -d= -f2)/getMe"
  ```

### Period rollover did not run

**Symptoms:** User's period expired but no new period was created.

**Diagnosis:**
```bash
docker compose logs api | grep "Rollover\|00:05"
# Check if the API was running at 00:05 UTC
docker compose logs api | grep -A5 "Rollover check error"
```

**Fix:** Check if api container crashed overnight:
```bash
docker compose ps api
# If it shows Exited, restart it:
docker compose up -d api
```

Then manually trigger via the psql method above.

### Daily snapshot not saved

**Symptoms:** Analytics screen shows no historical data.

**Diagnosis:**
```bash
docker compose logs api | grep "Daily snapshot error"
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT count(*), max(date) FROM \"DailySnapshot\";"
```

**Fix:** Usually a DB connection issue. Restart the api container:
```bash
docker compose restart api
```

### Cron not starting at all

**Symptoms:** No `[PFM Cron] Scheduled:` line in logs after API start.

**Diagnosis:**
```bash
docker compose logs api | grep "Failed to start cron\|PFM Cron"
```

**Cause:** The cron module failed to import (syntax error, missing dependency).

**Fix:** Check for TypeScript compilation errors in the build output:
```bash
docker compose logs api | head -50
```
Fix the error, redeploy.

---

## How to Check Notification Delivery

```bash
# Check Telegram Bot API directly for recent updates (polling fallback)
BOT_TOKEN=$(grep BOT_TOKEN /srv/pfm/.env | cut -d= -f2)
curl "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=5"

# Check if a specific user's chatId is stored
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT \"telegramId\", \"telegramChatId\", \"onboardingDone\" FROM \"User\" ORDER BY \"createdAt\" DESC LIMIT 10;"

# Check bot logs for sendMessage errors
docker compose logs bot | grep -i "error\|failed" | tail -20
```
