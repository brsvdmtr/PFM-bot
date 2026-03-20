---
title: "Runbook: Cron Jobs"
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
  - path: ./runbook-rollback.md
    relation: "rollback if cron causes data issues"
---

# Runbook: Cron Jobs

---

## When to Use

Use this runbook when: notifications are not sending, daily snapshots are missing, or period rollover is not happening at midnight. Also use it to verify all crons are running after a deploy.

---

## Prerequisites

- SSH access to `root@147.45.213.51`
- `api` container is running (`docker compose ps` shows `Up`)

---

## Cron Job Inventory

All cron jobs run inside the `api` container, registered in `apps/api/src/cron.ts` using `node-cron`. All schedules are UTC. Cron state is in-memory — lost on container restart.

| Job | Schedule | What it does |
|-----|----------|-------------|
| Notification dispatch | `* * * * *` | Morning/evening/payment alerts per user timezone |
| DailySnapshot | `55 23 * * *` | Saves s2sPlanned, s2sActual, totalExpenses per active period |
| Period rollover | `5 0 * * *` | Closes expired ACTIVE periods, creates new ones |
| Payment alerts | `0 9 * * *` | Alerts for debts due today or tomorrow |

---

## Verify Cron Is Running

```bash
docker compose logs api --tail=100 | grep "PFM Cron"
```

Expected: lines showing all 4 crons scheduled at startup. For the notification dispatcher (fires every minute), watch in real time:

```bash
docker compose logs -f api | grep "PFM Cron"
```

If no `PFM Cron` lines appear after API start, the cron module failed to load — see the Failures section below.

---

## Cron 1 — Notification Dispatcher (`* * * * *`)

Runs every minute. Sends morning and evening S2S notifications to users at their configured local times. Also dispatches payment alerts (see Cron 3).

**How it works:**
1. Loads all users with `telegramChatId` set and `onboardingDone = true`.
2. Converts current UTC time to each user's IANA timezone (from `User.timezone`).
3. If `localTime == morningNotifyTime` and not yet notified today → sends morning notification.
4. If `localTime == eveningNotifyTime` and not yet notified today → sends evening summary.
5. In-memory dedup map prevents duplicate sends within the same UTC day.

**Check for errors:**
```bash
docker compose logs --tail=200 api | grep "Notification dispatch error"
```

**Notification not received — diagnosis checklist:**

- Check `telegramChatId` is set (bot stores this on `/start`):
  ```bash
  docker compose exec postgres psql -U pfm -d pfmdb \
    -c "SELECT \"telegramId\", \"onboardingDone\", \"telegramChatId\" FROM \"User\" WHERE \"telegramId\" = '<id>';"
  ```
- Check `onboardingDone = true` (same query above).
- Check `morningNotifyEnabled = true` in UserSettings — user can toggle in Settings screen.
- Check user's `timezone` column is a valid IANA timezone string (e.g., `Europe/Moscow`).
- Check `BOT_TOKEN` is valid:
  ```bash
  curl "https://api.telegram.org/bot$(grep BOT_TOKEN /srv/pfm/.env | cut -d= -f2)/getMe"
  ```

**Known gap:** Dedup map is in-memory. Lost on container restart. Can cause double-send if restart happens at notification time. Tracked as TD-009.

---

## Cron 2 — DailySnapshot (`55 23 * * *`)

Fires at 23:55 UTC every day. Saves a daily spending snapshot for each active period.

**Check if it ran:**
```bash
docker compose logs api | grep "snapshot"
# Expected: "[PFM Cron] Saving daily snapshots..." and "[PFM Cron] Saved N snapshots"
```

**Check last snapshot date in DB:**
```bash
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT count(*), max(date) FROM \"DailySnapshot\";"
```

**DailySnapshot missing — fix:**
If the API container was down at 23:55 UTC, the snapshot is missed. There is no catch-up mechanism. To insert a snapshot manually:
```bash
docker compose exec postgres psql -U pfm -d pfmdb
```
```sql
INSERT INTO "DailySnapshot" ("periodId", "date", "totalSpent", "s2sRemaining", "isOverspent", "createdAt", "updatedAt")
SELECT
  '<period-id>',
  CURRENT_DATE,
  COALESCE((SELECT SUM(amount) FROM "Expense" WHERE "periodId" = '<period-id>' AND "spentAt"::date = CURRENT_DATE), 0),
  0,
  false,
  NOW(),
  NOW()
ON CONFLICT ("periodId", "date") DO UPDATE SET "updatedAt" = NOW();
```

**Known gap:** Snapshot is at 23:55 UTC, not per-user timezone. For users in UTC+10, the snapshot captures mid-morning state. `isOverspent` flag is misleading for eastern timezones. Tracked as TD-004.

---

## Cron 3 — Payment Alerts (`0 9 * * *`)

Fires at 09:00 UTC every day (12:00 noon Moscow time). Alerts users about debt payments due today or tomorrow.

**Check if it ran:**
```bash
docker compose logs api | grep "payment alert"
# Expected: "[PFM Cron] Checking payment alerts..."
```

**Payment alerts not sending — checklist:**
- Check `debt.dueDay` is set on the debt record.
- Check `debt.isPaidOff = false`.
- Check `user.settings.paymentAlerts = true`.

---

## Cron 4 — Period Rollover (`5 0 * * *`)

Fires at 00:05 UTC every day (03:05 AM Moscow time). Closes expired periods and creates new ones.

**Check if it ran:**
```bash
docker compose logs api | grep "Rollover\|Rolled over"
# Expected: "[PFM Cron] Checking period rollovers..." and "[PFM Cron] Rolled over period for user <id>"
```

**Check a specific user's period history:**
```bash
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT id, \"startDate\", \"endDate\", status, \"createdAt\" FROM \"Period\" WHERE \"userId\" = '<user-id>' ORDER BY \"createdAt\" DESC LIMIT 3;"
```

**Period rollover did not run — fix:**

Check if the api container crashed overnight:
```bash
docker compose ps api
# If Exited:
docker compose up -d api
```

Check for stuck ACTIVE periods:
```bash
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT * FROM \"Period\" WHERE status = 'ACTIVE' AND \"endDate\" <= NOW();"
```

If records found: rollover cron has not run or errored. To manually trigger: update the period's `endDate` to yesterday so the next 00:05 UTC cron picks it up:
```bash
docker compose exec postgres psql -U pfm -d pfmdb
```
```sql
UPDATE "Period"
SET "endDate" = NOW() - INTERVAL '1 day'
WHERE id = '<period-id>';
```
Then wait for the next 00:05 UTC cron run, or restart the api container.

**Note:** There is no admin endpoint for immediate manual rollover. If urgent, the psql method above is the only option.

**Known gap:** Rollover fires at 00:05 UTC, not at each user's local midnight. Users in UTC+5 to UTC+12 have their period roll over mid-morning. Expenses recorded before rollover but after local midnight land in the old period. Tracked as TD-003.

---

## Step-by-Step Procedure: Diagnosing a Cron Failure

1. Confirm the api container is running: `docker compose ps api`
2. Check that crons were scheduled at startup: `docker compose logs api | grep "PFM Cron"`
3. If no `PFM Cron` lines: cron module failed to load — check `docker compose logs api | head -50` for errors
4. Identify which cron is failing based on the symptom table above
5. Check the relevant log lines and DB state per the cron-specific section above
6. If the issue is a container crash: restart with `docker compose up -d api`
7. If the issue is a bad Period record: use the manual trigger procedures above
8. If cron is stuck or firing incorrectly: a code change and redeploy is required (there is no runtime switch)

---

## Success Criteria

After resolving a cron issue:

- [ ] `docker compose logs api | grep "PFM Cron"` shows all 4 crons scheduled
- [ ] No `error` lines for the affected cron in `docker compose logs --tail=200 api`
- [ ] For rollover: no ACTIVE periods exist with `endDate <= NOW()`
- [ ] For snapshots: `SELECT max(date) FROM "DailySnapshot"` returns today (if past 23:55 UTC)
- [ ] For notifications: affected user receives the next scheduled notification

---

## If Something Goes Wrong

- **Double notification received:** The in-memory dedup was lost on restart. No DB harm — inform affected users if needed.
- **Duplicate active periods created:** Check for and fix duplicates:
  ```bash
  docker compose exec postgres psql -U pfm -d pfmdb \
    -c "SELECT \"userId\", count(*) FROM \"Period\" WHERE status = 'ACTIVE' GROUP BY \"userId\" HAVING count(*) > 1;"
  ```
  Fix by marking the older duplicate as `COMPLETED`:
  ```sql
  UPDATE "Period" SET status = 'COMPLETED' WHERE id = '<older-duplicate-id>';
  ```
- **Cron not starting at all:** Fix the TypeScript compilation error in `cron.ts`, then redeploy.

---

## Related Docs

- [runbook-deploy.md](./runbook-deploy.md) — deploy procedure
- [runbook-rollback.md](./runbook-rollback.md) — if cron causes data issues requiring rollback
- [ops-index.md](./ops-index.md) — ops entry point
