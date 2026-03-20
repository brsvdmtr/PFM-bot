---
title: "Runbook: Cron Jobs"
document_type: Operational
status: Active
source_of_truth: "YES — for all cron job procedures and behavioral documentation"
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - runbook-deploy.md
  - runbook-rollback.md
  - ../delivery/technical-debt-register.md
---

# Runbook: Cron Jobs

Cron jobs run inside the `api` container. They are registered on API startup in
`apps/api/src/cron.ts` using `node-cron`. All schedules are UTC unless noted.
Cron state is in-memory — it is lost on container restart.

---

## Cron Job Registry

### Cron 1 — Notification Dispatcher

- **Schedule:** `* * * * *` — every minute, 24/7
- **UTC schedule:** every minute
- **Moscow equivalent:** every minute (UTC+3)
- **Purpose:** Send morning and evening S2S notifications to users at their configured
  local times.

**Step-by-step:**
1. Loads all users with `telegramChatId` set and `onboardingDone = true`.
2. Converts current UTC time to each user's IANA timezone (from `User.timezone`).
3. If `localTime == morningNotifyTime` and not yet notified today → sends morning
   notification with today's S2S limit, daily S2S, days left in period, and period status.
4. If `localTime == eveningNotifyTime` and not yet notified today → sends evening summary
   with today's total spending vs. daily limit.
5. In-memory dedup map (`notifLog`) keyed by `userId:morning|evening:YYYY-MM-DD` prevents
   duplicate sends within the same UTC day.

**DB changes:** None — read-only. Sends via Telegram Bot API only.

**Notification content (morning):** Today's S2S limit, daily budget, days remaining,
current balance status.

**Notification content (evening):** Today's actual spending vs. daily limit, over/under
status.

**How to verify it ran:**
```bash
# Cron 1 only logs on error. Verify by checking for absence of errors:
docker compose logs --tail=200 api | grep "Notification dispatch error"

# To watch in real time (fires every minute):
docker compose logs -f api | grep "PFM Cron"
```

**Known behavioral gap:** Dedup map is in-memory. If API container restarts at exactly
the user's notification time, the notification fires again when the container comes back up.
Tracked as TD-009.

---

### Cron 2 — Daily Snapshot

- **Schedule:** `55 23 * * *` — 23:55 UTC every day
- **Moscow equivalent:** 02:55 AM (next calendar day)
- **Purpose:** Save a daily spending snapshot for each active period (used in analytics).

**Step-by-step:**
1. Finds all periods with `status = ACTIVE`.
2. For each period: calculates total expenses for today (UTC day), remaining S2S budget,
   planned vs. actual S2S.
3. Upserts a `DailySnapshot` row keyed by `(periodId, date)` — idempotent on re-run.
4. Sets `isOverspent = true` if today's spending exceeded the planned daily limit.

**DB changes:** Upserts rows in `DailySnapshot` table.

**How to verify it ran:**
```bash
docker compose logs api | grep "snapshot"
# Expected: "[PFM Cron] Saving daily snapshots..." and "[PFM Cron] Saved N snapshots"

# Check last snapshot date in DB:
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT count(*), max(date) FROM \"DailySnapshot\";"
```

**Known behavioral gap:** Snapshot is at 23:55 UTC — not per-user timezone. For users
in UTC+10 (Vladivostok), the snapshot captures mid-morning state, not end-of-day.
`isOverspent` flag is misleading for eastern timezones. Tracked as TD-004.

---

### Cron 3 — Payment Alerts

- **Schedule:** `0 9 * * *` — 09:00 UTC every day
- **Moscow equivalent:** 12:00 noon (UTC+3)
- **Purpose:** Alert users about debt payments due today or tomorrow.

**Step-by-step:**
1. Finds users with `paymentAlerts = true` in their settings.
2. For each user: finds unpaid debts where `dueDay` matches today's or tomorrow's
   day-of-month.
3. Sends a Telegram message per debt via `sendPaymentAlert`.
4. Uses the same in-memory dedup map as Cron 1, keyed `userId:payment:<debtId>`.

**DB changes:** None — read-only.

**Notification content:** Debt name, amount due, due date.

**How to verify it ran:**
```bash
docker compose logs api | grep "payment alert"
# Expected: "[PFM Cron] Checking payment alerts..."
```

---

### Cron 4 — Period Rollover

- **Schedule:** `5 0 * * *` — 00:05 UTC every day
- **Moscow equivalent:** 03:05 AM (UTC+3)
- **Purpose:** Automatically close expired periods and create new ones.

**Step-by-step:**
1. Finds all `ACTIVE` periods where `endDate <= today` (UTC date).
2. Calculates savings from the old period: `s2sPeriod - totalSpent`.
3. Marks old period as `COMPLETED`.
4. Recalculates period bounds using the user's current paydays.
5. Runs `calculateS2S` with current incomes, obligations, debts, and emergency fund
   settings.
6. Creates a new `ACTIVE` period with the new bounds and S2S values.
7. Sends `sendNewPeriodNotification` with new daily S2S and amount saved or overspent.

**DB changes:**
- Updates `Period.status` from `ACTIVE` to `COMPLETED` on old period.
- Creates new `Period` row with `status = ACTIVE`.

**How to verify it ran:**
```bash
docker compose logs api | grep "Rollover\|Rolled over"
# Expected: "[PFM Cron] Checking period rollovers..." and "[PFM Cron] Rolled over period for user <id>"

# Check a specific user's period history:
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT id, \"startDate\", \"endDate\", status, \"createdAt\" FROM \"Period\" WHERE \"userId\" = '<user-id>' ORDER BY \"createdAt\" DESC LIMIT 3;"
```

**Known behavioral gap:** Rollover fires at 00:05 UTC, not at each user's local midnight.
Users in UTC+5 to UTC+12 have their period roll over mid-morning. Expenses recorded before
rollover but after local midnight land in the old period. Tracked as TD-003.

---

## Manual Trigger Procedures

### Manually Trigger Period Rollover

Use when a period should have rolled over but did not (container crashed during rollover,
or for testing).

**Option 1: Force rollover via psql — mark period as expired, let cron pick it up**

```bash
docker compose exec postgres psql -U pfm -d pfmdb

-- Find the active period to expire
SELECT id, "userId", "startDate", "endDate", status FROM "Period" WHERE status = 'ACTIVE';

-- Set endDate to yesterday so the 00:05 UTC cron picks it up
UPDATE "Period"
SET "endDate" = NOW() - INTERVAL '1 day'
WHERE id = '<period-id>';

\q
```

Then wait for the next 00:05 UTC cron run. To trigger immediately, restart the api
container after the psql update (cron fires on schedule after restart).

**Option 2: Trigger recalculate for the current period**

This does not roll over the period but recomputes S2S values from current data. Useful
after manually editing incomes or obligations in DB.

```bash
# In development mode only (production blocks X-TG-DEV):
curl -X POST http://127.0.0.1:3002/tg/periods/recalculate \
  -H "X-TG-DEV: <telegram-user-id>" \
  -H "Content-Type: application/json"

# In production: user must open mini app (recalculate fires on dashboard load)
# or provide real initData token:
curl -X POST https://mytodaylimit.ru/api/tg/periods/recalculate \
  -H "X-TG-Init-Data: <real-initData>" \
  -H "Content-Type: application/json"
```

### Manually Trigger Daily Snapshot

Use when the snapshot was missed (API was down at 23:55 UTC) or for testing.

**Option: psql direct upsert**

```bash
docker compose exec postgres psql -U pfm -d pfmdb

-- Insert a snapshot for a specific period and date (adjust values):
INSERT INTO "DailySnapshot" ("periodId", "date", "totalSpent", "s2sRemaining", "isOverspent", "createdAt", "updatedAt")
SELECT
  '<period-id>',
  CURRENT_DATE,
  COALESCE((SELECT SUM(amount) FROM "Expense" WHERE "periodId" = '<period-id>' AND "spentAt"::date = CURRENT_DATE), 0),
  0,  -- fill in s2sRemaining manually or leave 0
  false,
  NOW(),
  NOW()
ON CONFLICT ("periodId", "date") DO UPDATE SET "updatedAt" = NOW();

\q
```

For a full recalculated snapshot, it is safer to restart the API container and wait for
the next 23:55 UTC run.

---

## Known Behavioral Gaps

| Cron | Gap | Tracked |
|------|-----|---------|
| Period rollover (Cron 4) | Fires at 00:05 UTC, not user's local midnight. Users in UTC+5 to UTC+12 have mid-morning rollovers. | TD-003 |
| Daily snapshot (Cron 2) | 23:55 UTC snapshot time — not per-user timezone. `isOverspent` misleading for eastern timezones. | TD-004 |
| Notification dispatcher (Cron 1) | Dedup map is in-memory. Lost on container restart. Can cause double-send if restart happens at notification time. | TD-009 |
| Weekly digest | `weeklyDigest` setting exists in UserSettings schema but no cron implementation exists. Setting has no effect. | TD-020 |
| Deficit alert | `sendDeficitAlert` function exists in `notify.ts` but is never called. Dead code. | TD-019 |

---

## Disable a Specific Cron

There is no runtime switch. Disabling a cron requires a code change and redeploy.

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

## What to Do if a Cron Fired Double

**Cause:** Notification dedup map (`notifLog`) was lost due to a container restart at
the same time the cron was due to fire.

**Immediate:**
- For notifications (Cron 1, 3): users received a duplicate message. No DB harm. Inform
  affected users if needed.
- For snapshots (Cron 2): upsert is idempotent — no harm from double run.
- For rollover (Cron 4): check if two new ACTIVE periods were created for the same user.

**Check for duplicate periods:**
```bash
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT \"userId\", count(*) FROM \"Period\" WHERE status = 'ACTIVE' GROUP BY \"userId\" HAVING count(*) > 1;"
```

**Fix duplicate active periods:**
```bash
docker compose exec postgres psql -U pfm -d pfmdb

-- Identify the duplicate (keep the one with the later startDate):
SELECT id, "userId", "startDate", "endDate", status FROM "Period"
WHERE "userId" = '<affected-user-id>'
ORDER BY "startDate" DESC;

-- Mark the earlier duplicate as COMPLETED:
UPDATE "Period" SET status = 'COMPLETED' WHERE id = '<older-duplicate-id>';

\q
```

---

## Common Cron Failures and Fixes

### Notification not delivered to user

**Symptoms:** User reports not receiving morning/evening notification.

**Diagnosis:**
```bash
docker compose logs api | grep "Notification dispatch error"
```

**Possible causes:**
- `telegramChatId` is null. Bot stores this on `/start`. Ask user to send `/start`.
- `onboardingDone = false`:
  ```bash
  docker compose exec postgres psql -U pfm -d pfmdb \
    -c "SELECT \"telegramId\", \"onboardingDone\", \"telegramChatId\" FROM \"User\" WHERE \"telegramId\" = '<id>';"
  ```
- `morningNotifyEnabled = false` in UserSettings. User can toggle in Settings screen.
- User's `timezone` is wrong — time comparison fails. Check `timezone` column in User.
- BOT_TOKEN is invalid:
  ```bash
  curl "https://api.telegram.org/bot$(grep BOT_TOKEN /srv/pfm/.env | cut -d= -f2)/getMe"
  ```

### Period rollover did not run

**Symptoms:** User's period expired but no new period was created.

**Diagnosis:**
```bash
docker compose logs api | grep "Rollover\|00:05"
docker compose logs api | grep -A5 "Rollover check error"
```

**Fix:** Check if api container crashed overnight:
```bash
docker compose ps api
# If Exited:
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

**Fix:** Usually a DB connection issue. Restart:
```bash
docker compose restart api
```

### Cron not starting at all

**Symptoms:** No `[PFM Cron] Scheduled:` line in logs after API start.

**Diagnosis:**
```bash
docker compose logs api | grep "Failed to start cron\|PFM Cron"
docker compose logs api | head -50
```

**Cause:** Cron module failed to import (syntax error, missing dependency).
Fix the TypeScript compilation error, then redeploy.

---

## How to Check Notification Delivery

```bash
# Check Telegram Bot API directly for recent updates
BOT_TOKEN=$(grep BOT_TOKEN /srv/pfm/.env | cut -d= -f2)
curl "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=5"

# Check if a specific user's chatId is stored
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT \"telegramId\", \"telegramChatId\", \"onboardingDone\" FROM \"User\" ORDER BY \"createdAt\" DESC LIMIT 10;"

# Check bot logs for sendMessage errors
docker compose logs bot | grep -i "error\|failed" | tail -20
```
