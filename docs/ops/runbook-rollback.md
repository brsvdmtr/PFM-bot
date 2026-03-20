---
title: "Runbook: Rollback"
document_type: Operational
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - path: ./ops-index.md
    relation: "ops entry point"
  - path: ./runbook-deploy.md
    relation: "normal deploy procedure"
  - path: ./runbook-backup-restore.md
    relation: "DB restore procedure"
  - path: ./runbook-cron.md
    relation: "cron-related failures"
---

# Runbook: Rollback

---

## When to Use

Use this runbook when production is broken and a rollback is needed. This covers container crashes, wrong financial numbers, and data corruption.

---

## Prerequisites

- SSH access to `root@147.45.213.51`
- Knowledge of the last known-good commit hash (from `git log --oneline -10` on server)
- For DB restore: a valid backup file in `/root/backups/pfm/`

---

## Decision Tree

```
Is the site down?
├─ YES → Container crash → docker compose restart api
│        → if still down → git rollback (Section A)
└─ NO → Numbers wrong?
    ├─ YES → Logic incident (Section B)
    └─ NO → Notifications broken → runbook-cron.md
```

More detailed:

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
                          DB Restore  Cron issue →
                          (Section C) runbook-cron.md
```

**Rule of thumb:**
- App crashes, 500s, containers restarting → Section A
- Health green but s2s numbers wrong → Section B
- Prisma schema errors, data corruption → Section C, then Section A
- Single service regressed → Section D

---

## Section A: Container Rollback

Use when: containers exit, health check red, API returns 500s, build was broken.

```bash
ssh root@147.45.213.51
cd /srv/pfm

# Find last good commit:
git log --oneline -10

# Reset to that commit and rebuild:
git reset --hard <commit-hash>
docker compose up -d --build
```

This discards all commits after the target hash on the server and rebuilds all images.

**Success criteria:**
- [ ] `docker compose ps` shows all 4 services `Up`
- [ ] `curl http://127.0.0.1:3002/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] `docker compose logs api | grep "PFM Cron"` shows all 4 crons scheduled
- [ ] No stack traces in `docker compose logs --tail=50 api`

**Note on git state:** After a hard reset on the server, the server's HEAD is behind `origin/main`. The next normal deploy (`git reset --hard origin/main`) moves it back to latest. The server's local git state does not affect the remote repository.

---

## Section B: Logic Incident — Health Green but Numbers Are Wrong

Use when: all containers are `Up`, `/api/health` returns 200, but s2sToday/s2sDaily/s2sPeriod values are incorrect for users.

**Logic incident decision tree:**

```
Are numbers wrong for ALL users or ONE user?
├─ ALL → Formula regression in code → rollback container (Section A)
└─ ONE → Data issue for that user
    ├─ Bad Period record? → trigger recalculate
    ├─ Wrong income/obligations? → user needs to update in app
    └─ Period stuck ACTIVE past endDate? → manual rollover trigger
```

**Step 1:** Identify the commit that changed the formula:
```bash
cd /srv/pfm
git log --oneline -20

# Look for commits touching engine or cron:
git log --oneline --all -- apps/api/src/engine.ts
git log --oneline --all -- apps/api/src/cron.ts
```

**Step 2:** Identify affected users — users whose period was created or recalculated after the bad commit:
```bash
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT p.id, p.\"userId\", p.\"startDate\", p.\"s2sDaily\", p.\"updatedAt\" FROM \"Period\" p WHERE p.status = 'ACTIVE' AND p.\"updatedAt\" > '2026-03-20 10:00:00' ORDER BY p.\"updatedAt\" DESC;"
```

**Step 3:** Roll code back to the last known-good commit:
```bash
cd /srv/pfm
git log --oneline -10

git reset --hard <good-commit-hash>
docker compose up -d --build api
```

**Step 4:** Recalculate affected users' periods. After code rollback, S2S values in the DB still reflect the bad formula. Trigger recalculate for each affected user.

In production, the user opening the mini app triggers recalculate automatically on dashboard load. To trigger directly with a real initData token:
```bash
curl -X POST https://mytodaylimit.ru/api/tg/periods/recalculate \
  -H "X-TG-Init-Data: <user-initData>" \
  -H "Content-Type: application/json"
```

**Step 5:** Verify fix — compare against expected values from `formulas-and-calculation-policy.md`:
```bash
docker compose exec postgres psql -U pfm -d pfmdb \
  -c "SELECT id, \"s2sDaily\", \"s2sPeriod\", \"updatedAt\" FROM \"Period\" WHERE id = '<period-id>';"
```

**Success criteria:**
- [ ] Code is rolled back to known-good commit
- [ ] All affected periods recalculated (updatedAt > rollback timestamp)
- [ ] s2sDaily values match expected formula output for at least one test user
- [ ] No new logic errors in `docker compose logs --tail=100 api`

---

## Section C: DB Restore (Last Resort — Data Loss Risk)

Use when: schema mismatch errors in Prisma, data corruption suspected, or after a destructive migration that needs to be undone.

**Warning:** A DB restore overwrites all data written since the backup was taken. Expenses and period updates made by users since the backup will be lost.

For how to create a backup, see [runbook-backup-restore.md](./runbook-backup-restore.md).

**Step 1:** Identify your backup:
```bash
ls -lh /root/backups/pfm/
```

**Step 2:** Stop the API and bot (prevent writes during restore):
```bash
cd /srv/pfm
docker compose stop api bot
```

**Step 3:** Drop and recreate the database:
```bash
docker compose exec postgres psql -U pfm -c "DROP DATABASE pfmdb;"
docker compose exec postgres psql -U pfm -c "CREATE DATABASE pfmdb;"
```

**Step 4:** Restore the backup:
```bash
# If backup is gzip-compressed:
gunzip -c /root/backups/pfm/pfm_2026-03-19_03-00.sql.gz | \
  docker compose exec -T postgres psql -U pfm -d pfmdb

# If backup is plain SQL:
docker compose exec -T postgres psql -U pfm -d pfmdb < /root/backups/pfm/pfm_2026-03-19.sql
```

**Step 5:** Roll back the code (Section A), then restart services:
```bash
git reset --hard <previous-commit-hash>
docker compose up -d --build
```

**Step 6:** Verify data integrity:
```bash
docker compose exec postgres psql -U pfm -d pfmdb -c "\dt"
# Should list all tables: User, Period, Expense, Income, etc.

docker compose exec postgres psql -U pfm -d pfmdb -c "SELECT count(*) FROM \"User\";"
# Should return the expected number of users
```

**Success criteria:**
- [ ] All expected tables exist (`\dt` output)
- [ ] User count matches pre-restore expectation
- [ ] `curl http://127.0.0.1:3002/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] At least one active period exists

---

## Section D: Single-Container Rollback

Use when only one service is broken and rolling back all containers would disrupt unaffected services:

```bash
ssh root@147.45.213.51
cd /srv/pfm

git log --oneline -10

# Checkout only the relevant source at the good commit (file-level, not full reset):
git checkout <good-commit-hash> -- apps/api/Dockerfile apps/api/src

# Rebuild only that service:
docker compose up -d --build api

# Verify:
docker compose logs --tail=30 api
curl http://127.0.0.1:3002/health/deep
```

After verifying, either continue with the partial state until a proper fix is deployed, or do a full rollback via Section A.

---

## Post-Incident Steps

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
4. Write an incident note: record the bad commit hash, what broke, and what rollback was applied. A note in a git commit message or Telegram saved messages is sufficient.
5. For logic incidents: attach before/after payload to the subsequent fix commit.
6. Fix the bug in a new commit locally, test, then deploy normally per [runbook-deploy.md](./runbook-deploy.md).

**Escalation:** There is no on-call team. Document in git commit and fix forward.

---

## When NOT to Rollback

- **Only one user affected, no code change since last known-good period:** investigate first. The user may have incorrect income/payday setup. Check their Period and Income records in psql before rolling back anything.
- **Wrong numbers immediately after user changed paydays or income:** trigger recalculate first — not a rollback situation.
- **Notification not delivered to one user:** not a reason to rollback. See [runbook-cron.md](./runbook-cron.md).
- **Cosmetic UI issue:** redeploy a fix, do not rollback.

---

## Related Docs

- [runbook-deploy.md](./runbook-deploy.md) — normal deploy procedure
- [runbook-backup-restore.md](./runbook-backup-restore.md) — how to create and restore backups
- [runbook-cron.md](./runbook-cron.md) — cron-related failures
- [ops-index.md](./ops-index.md) — ops entry point
