# Runbook: Backup and Restore

## Database Location

Postgres data lives in a Docker named volume:

```
/var/lib/docker/volumes/pfm_postgres_data/_data
```

Do not back up the raw volume directory directly — use `pg_dump` via `docker exec` for
consistent, portable backups.

---

## How to Create a Database Backup

### Manual backup (run on server)

```bash
ssh root@147.45.213.51

# Create backup directory if it doesn't exist
mkdir -p /root/backups/pfm

# Dump compressed backup with timestamp
docker compose -f /srv/pfm/docker-compose.yml exec -T postgres \
  pg_dump -U pfm pfmdb | gzip > /root/backups/pfm/pfm_$(date +%Y-%m-%d_%H-%M).sql.gz
```

Replace `pfm` (user) and `pfmdb` (db name) with values from `/srv/pfm/.env` if different.

### Verify the backup was created

```bash
ls -lh /root/backups/pfm/
# e.g.: -rw-r--r-- 1 root root 42K 2026-03-20 03:00 pfm_2026-03-20_03-00.sql.gz

# Check the backup is non-empty and valid gzip
gunzip -t /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz && echo "OK"

# Quick sanity: check it contains table definitions
gunzip -c /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz | head -30
# Should show: -- PostgreSQL database dump, CREATE TABLE, etc.
```

---

## Where to Store Backups

The `/root/backups/pfm/` directory is on the same server as the database. This protects
against application bugs and accidental data deletion, but NOT against server loss.

**TODO: Set up off-server backup copy.** Options:
- `scp` or `rsync` to a second server/VPS after each backup
- `rclone` to object storage (e.g., Yandex.Cloud S3, Backblaze B2)
- Download manually to local machine before risky deploys

Manual download to local machine:

```bash
# Run from your local machine
scp root@147.45.213.51:/root/backups/pfm/pfm_2026-03-20_03-00.sql.gz ~/Desktop/
```

---

## Backup Schedule (Recommended Daily Cron)

Add a daily cron on the server to automate backups at 03:00 UTC. Run this once:

```bash
ssh root@147.45.213.51

crontab -e
```

Add this line:

```
0 3 * * * docker compose -f /srv/pfm/docker-compose.yml exec -T postgres pg_dump -U pfm pfmdb | gzip > /root/backups/pfm/pfm_$(date +\%Y-\%m-\%d_\%H-\%M).sql.gz
```

Keep the last 14 backups, delete older ones (add a second cron line):

```
30 3 * * * find /root/backups/pfm/ -name "*.sql.gz" -mtime +14 -delete
```

Verify cron was added:

```bash
crontab -l
```

Verify it runs the next morning:

```bash
ls -lh /root/backups/pfm/
```

---

## How to Restore from Backup

### When to restore

- Data corruption detected
- Accidental mass delete
- Rolling back after a bad database migration (see also runbook-rollback.md)

### Restore procedure

```bash
ssh root@147.45.213.51
cd /srv/pfm

# 1. Stop api and bot to prevent writes during restore
docker compose stop api bot

# 2. Drop and recreate the database
docker compose exec postgres psql -U pfm -c "DROP DATABASE pfmdb;"
docker compose exec postgres psql -U pfm -c "CREATE DATABASE pfmdb;"

# 3. Restore from backup
gunzip -c /root/backups/pfm/pfm_2026-03-19_03-00.sql.gz | \
  docker compose exec -T postgres psql -U pfm -d pfmdb

# If backup is plain (uncompressed) SQL:
# docker compose exec -T postgres psql -U pfm -d pfmdb < /root/backups/pfm/pfm_2026-03-19.sql

# 4. Restart all services
docker compose up -d api bot
```

### Verify restore

```bash
# Check tables exist
docker compose exec postgres psql -U pfm -d pfmdb -c "\dt"

# Check row counts look reasonable
docker compose exec postgres psql -U pfm -d pfmdb -c \
  "SELECT 'User' AS tbl, count(*) FROM \"User\"
   UNION ALL SELECT 'Period', count(*) FROM \"Period\"
   UNION ALL SELECT 'Expense', count(*) FROM \"Expense\"
   UNION ALL SELECT 'Income', count(*) FROM \"Income\";"

# Check API health (includes DB connectivity check)
curl http://127.0.0.1:3002/health/deep
```

---

## Verify Backup Integrity (Without Restoring)

Run this to confirm a backup file is a valid, complete pg_dump:

```bash
# Check gzip integrity
gunzip -t /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz && echo "gzip OK"

# Check SQL structure: should start with pg_dump header
gunzip -c /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz | head -5

# Check SQL structure: should end with pg_dump footer
gunzip -c /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz | tail -5
# Expected last line: "-- PostgreSQL database dump complete"

# Check file size (should be at minimum a few KB for a real DB)
ls -lh /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz
```

A valid dump ends with `-- PostgreSQL database dump complete`. If that line is missing,
the dump was truncated (e.g., disk full) and is unusable.
