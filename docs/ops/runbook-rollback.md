# Runbook: Rollback

## Decision Tree: Which Rollback to Use?

```
Production is broken after deploy
         |
         v
Is there a failed database migration?
  (new columns missing, schema mismatch errors in logs)
         |
    YES  |  NO
         |    \
         |     v
         |   Is it a code bug (wrong logic, crash, 500 errors)?
         |          |
         |     YES  |  NO
         |          |    \
         |          |     Investigate — might be config/env issue
         |          v     See: runbook-deploy.md > Environment Variables
         |   Code-only rollback (Section A)
         v
Database rollback required (Section B)
Then code rollback (Section A)
```

**Rule of thumb:**
- Bug in behavior or UI — Section A only
- App crashes with Prisma schema errors — Section B then Section A
- Single service regressed — Section C

---

## Section A: Rollback to Previous Git Commit

### 1. Find the commit to roll back to

```bash
ssh root@147.45.213.51
cd /srv/pfm

git log --oneline -10
```

Copy the commit hash you want to roll back to (e.g., `d785b05`).

### 2. Reset to that commit and rebuild

```bash
git reset --hard d785b05

docker compose up -d --build
```

This discards all commits after the target hash on the server and rebuilds all images.

### 3. Verify

```bash
curl http://127.0.0.1:3002/health/deep
docker compose ps
```

### Note on git push

After a hard reset on server, the server's HEAD is behind `origin/main`. The next normal
deploy (`git reset --hard origin/main`) will move it back to latest. This is intentional —
the server's git state does not affect the remote.

---

## Section B: Rollback the Database

Use only when the current schema is incompatible with the rolled-back code, or when data
corruption occurred.

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

Postgres and web stay running (web will show errors, that is acceptable).

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
```

---

## Section C: Rollback Only One Container

Use when only one service is broken and rolling back all containers would disrupt
unaffected services.

```bash
ssh root@147.45.213.51
cd /srv/pfm

# Identify the bad commit and the good commit hash
git log --oneline -10

# Check out only the relevant Dockerfile and source at the good commit
# (This is a targeted file-level checkout, not a full reset)
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

4. Document what happened: note the bad commit hash, what broke, and what rollback was
   applied. This is your own runbook — a note in git commit message or Telegram saved
   messages is fine.

5. Fix the bug in a new commit locally, test, then deploy normally per
   [runbook-deploy.md](./runbook-deploy.md).
