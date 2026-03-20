---
title: "Runbook: Rollback"
document_type: Operational
status: Active
source_of_truth: "YES — for all rollback and recovery procedures"
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - runbook-deploy.md
  - runbook-cron.md
  - runbook-backup-restore.md
  - ../delivery/logic-issue-template.md
---

# Runbook: Rollback

---

## Decision Tree: Which Rollback to Use?

```
Something is wrong after a deploy or at runtime
         |
         v
Is the health check red?
  (containers Exiting, /api/health fails, API returns 500)
         |
    YES  |  NO
         |    \
         v     v
  Container    Is the problem wrong financial numbers?
  Rollback     (s2sToday, s2sDaily, s2sPeriod incorrect;
  (Section A)  health check GREEN but numbers are off)
                  |
             YES  |  NO
                  |    \
                  v     v
            Logic        Is there a schema mismatch?
            Rollback      (Prisma errors, missing columns,
            (Section B)   data corruption suspected)
                               |
                          YES  |  NO
                               |    \
                               v     v
                          DB Restore  Did a cron fire
                          (Section C)  incorrectly or double?
                                           |
                                           v
                                     Cron Investigation
                                     (runbook-cron.md)
```

**Rule of thumb:**
- App crashes, 500s, containers restarting → Section A
- Health green but s2s numbers wrong → Section B
- Prisma schema errors, data corruption → Section C, then Section A
- Single service regressed → Section D

---

## When NOT to Rollback

- **Only one user affected, no code change since last known-good period**: investigate
  first. The user may have incorrect income/payday setup. Use psql to inspect their Period
  and Income records before rolling back anything.
- **Wrong numbers immediately after user changed their paydays or income**: trigger
  recalculate first (`POST /tg/periods/recalculate`) — not a rollback situation.
- **Notification not delivered to one user**: not a reason to rollback. Check cron logs
  and user's `telegramChatId`, `onboardingDone` in DB.
- **Cosmetic UI issue**: redeploy a fix, do not rollback.

---

## Section A: Container Rollback — Roll Code Back to Previous Commit

Use when: containers exit, health check red, API returns 500s, build was broken.

### 1. Find the commit to roll back to

```bash
ssh root@147.45.213.51
cd /srv/pfm

git log --oneline -10
```

Copy the commit hash of the last known-good commit (e.g., `d785b05`).

### 2. Reset to that commit and rebuild

```bash
git reset --hard d785b05

docker compose up -d --build
```

This discards all commits after the target hash on the server and rebuilds all images.

### 3. Success criteria

- [ ] `docker compose ps` shows all 4 services `Up`
- [ ] `curl http://127.0.0.1:3002/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] `docker compose logs api | grep "PFM Cron"` shows all 4 crons scheduled
- [ ] No stack traces in `docker compose logs --tail=50 api`

### Note on git state

After a hard reset on server, the server's HEAD is behind `origin/main`. The next normal
deploy (`git reset --hard origin/main`) will move it back to latest. The server's local
git state does not affect the remote repository.

---

## Section B: Logic Rollback — Health Green but Financial Numbers Are Wrong

Use when: all containers `Up`, `/api/health` returns 200, but s2sToday/s2sDaily/s2sPeriod
values are incorrect for users.

### 1. Identify the commit that changed the formula

```bash
cd /srv/pfm
git log --oneline -20

# Look for commits touching engine or cron:
git log --oneline --all -- apps/api/src/engine.ts
git log --oneline --all -- apps/api/src/cron.ts
```

### 2. Identify affected users

Users whose period was created or recalculated after the bad commit are affected.

```bash
docker compose exec postgres psql -U pfm -d pfmdb

-- Find periods created or updated since the bad deploy (adjust timestamp):
SELECT p.id, p."userId", p."startDate", p."endDate", p."s2sDaily", p."updatedAt"
FROM "Period" p
WHERE p.status = 'ACTIVE'
  AND p."updatedAt" > '2026-03-20 10:00:00'
ORDER BY p."updatedAt" DESC;

\q
```

Record the affected user IDs and their period IDs for post-rollback verification.

### 3. Roll code back to the last known-good commit

```bash
cd /srv/pfm
git log --oneline -10  # identify the good commit hash

git reset --hard <good-commit-hash>
docker compose up -d --build api
```

### 4. Recalculate affected users' periods

After code rollback, S2S values in the DB still reflect the bad formula. Trigger
recalculate for each affected user. In production this requires a valid Telegram initData
token, which means asking the user to open the mini app (recalculate fires on dashboard
load) or using the internal admin endpoint if available.

```bash
# Confirm recalculate endpoint is live (health check):
curl http://127.0.0.1:3002/health/deep

# Option: ask user to open mini app — dashboard load triggers recalculate automatically
# Option: if you have their initData token from a recent session:
curl -X POST https://mytodaylimit.ru/api/tg/periods/recalculate \
  -H "X-TG-Init-Data: <user-initData>" \
  -H "Content-Type: application/json"
```

### 5. Verify fix for each affected user

```bash
docker compose exec postgres psql -U pfm -d pfmdb

SELECT id, "s2sDaily", "s2sPeriod", "updatedAt"
FROM "Period"
WHERE id = '<period-id>';
```

Compare against manually calculated expected value from
`formulas-and-calculation-policy.md`.

### Success criteria

- [ ] Code is rolled back to known-good commit
- [ ] All affected periods recalculated (updatedAt > rollback timestamp)
- [ ] s2sDaily values match expected formula output for at least one test user
- [ ] No new logic errors in `docker compose logs --tail=100 api`

---

## Section C: DB Restore

Use when: schema mismatch errors in Prisma, data corruption suspected, or after a
destructive migration that needs to be undone.

**Warning:** A DB restore overwrites all data written since the backup was taken.
Expenses and period updates made by users since the backup will be lost.

### Step 1: Identify your backup

```bash
ls -lh /root/backups/pfm/
# e.g.: pfm_2026-03-19_03-00.sql.gz
```

If no local backup exists, see [runbook-backup-restore.md](./runbook-backup-restore.md)
for how to create one first (before making things worse).

### Step 2: Stop the API and bot (prevent writes during restore)

```bash
cd /srv/pfm
docker compose stop api bot
```

Postgres and web stay running (web will show errors — acceptable during restore).

### Step 3: Drop and recreate the database

```bash
docker compose exec postgres psql -U pfm -c "DROP DATABASE pfmdb;"
docker compose exec postgres psql -U pfm -c "CREATE DATABASE pfmdb;"
```

Replace `pfm` and `pfmdb` with your actual `POSTGRES_USER` and `POSTGRES_DB` from `.env`.

### Step 4: Restore the backup

```bash
# If backup is gzip-compressed
gunzip -c /root/backups/pfm/pfm_2026-03-19_03-00.sql.gz | \
  docker compose exec -T postgres psql -U pfm -d pfmdb

# If backup is plain SQL
docker compose exec -T postgres psql -U pfm -d pfmdb < /root/backups/pfm/pfm_2026-03-19.sql
```

### Step 5: Roll back the code (Section A), then restart services

```bash
git reset --hard <previous-commit-hash>
docker compose up -d --build
```

### Step 6: Verify data integrity

```bash
docker compose exec postgres psql -U pfm -d pfmdb -c "\dt"
# Should list all tables: User, Period, Expense, Income, etc.

docker compose exec postgres psql -U pfm -d pfmdb -c "SELECT count(*) FROM \"User\";"
# Should return the expected number of users

docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT count(*) FROM \"Period\" WHERE status = 'ACTIVE';"
# Should be >= 1
```

### Success criteria

- [ ] All expected tables exist (`\dt` output)
- [ ] User count matches pre-restore expectation
- [ ] `curl http://127.0.0.1:3002/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] At least one active period exists
- [ ] No Prisma connection errors in `docker compose logs --tail=50 api`

---

## Section D: Single-Container Rollback

Use when only one service is broken and rolling back all containers would disrupt
unaffected services.

```bash
ssh root@147.45.213.51
cd /srv/pfm

# Identify the bad commit and the good commit hash
git log --oneline -10

# Check out only the relevant source at the good commit
# (file-level checkout, not a full reset)
git checkout <good-commit-hash> -- apps/api/Dockerfile apps/api/src

# Rebuild only that service
docker compose up -d --build api

# Verify
docker compose logs --tail=30 api
curl http://127.0.0.1:3002/health/deep
```

After verifying, either continue with the partial state until a proper fix is deployed,
or do a full rollback via Section A.

---

## After Any Rollback

1. Confirm all containers are `Up`:
   ```bash
   docker compose ps
   ```

2. Check health endpoint:
   ```bash
   curl https://mytodaylimit.ru/api/health
   ```

3. Check cron started in API logs:
   ```bash
   docker compose logs api | grep "PFM Cron"
   ```

4. Document what happened: note the bad commit hash, what broke, what rollback was
   applied. A note in a git commit message or Telegram saved messages is sufficient.

5. Fix the bug in a new commit locally, test, then deploy normally per
   [runbook-deploy.md](./runbook-deploy.md).
