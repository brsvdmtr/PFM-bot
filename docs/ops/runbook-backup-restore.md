---
title: "Runbook: Backup and Restore"
document_type: Operational
status: Active
source_of_truth: NO
verified_against_code: Partial
last_updated: "2026-03-20"
related_docs:
  - path: ./ops-index.md
    relation: "ops entry point"
  - path: ./runbook-rollback.md
    relation: "uses backup during DB restore"
  - path: ./production-checklist.md
    relation: "backup gaps tracked here"
---

# Runbook: Backup and Restore

---

## When to Use

- Before any risky deploy (schema changes, destructive data operations)
- On a scheduled basis to protect against data loss
- When restoring after data corruption or an accidental mass delete

---

## Prerequisites

- SSH access to `root@147.45.213.51`
- `postgres` container is running (`docker compose ps` shows postgres `Up` / `healthy`)
- For restore: a valid backup file in `/root/backups/pfm/`

---

## Backup (Manual)

```bash
ssh root@147.45.213.51

# Create backup directory if it doesn't exist
mkdir -p /root/backups/pfm

# Dump compressed backup with timestamp
docker compose -f /srv/pfm/docker-compose.yml exec -T postgres \
  pg_dump -U pfm pfmdb | gzip > /root/backups/pfm/pfm_$(date +%Y-%m-%d_%H-%M).sql.gz
```

Replace `pfm` (user) and `pfmdb` (db name) with values from `/srv/pfm/.env` if different.

---

## List Backups

```bash
ls -lah /root/backups/pfm/
```

---

## Verify Backup Integrity

After creating a backup, confirm it is valid:

```bash
# Check gzip integrity
gunzip -t /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz && echo "gzip OK"

# Check SQL structure: should start with pg_dump header
gunzip -c /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz | head -5

# Check SQL structure: should end with pg_dump footer
gunzip -c /root/backups/pfm/pfm_2026-03-20_03-00.sql.gz | tail -5
# Expected last line: "-- PostgreSQL database dump complete"
```

A valid dump ends with `-- PostgreSQL database dump complete`. If that line is missing, the dump was truncated (e.g., disk full) and is unusable.

---

## Restore

**Warning:** This will overwrite all current data. All changes since the backup was taken will be lost.

```bash
ssh root@147.45.213.51
cd /srv/pfm

# 1. Stop api and bot to prevent writes during restore
docker compose stop api bot

# 2. Drop and recreate the database
docker compose exec postgres psql -U pfm -c "DROP DATABASE pfmdb;"
docker compose exec postgres psql -U pfm -c "CREATE DATABASE pfmdb;"

# 3. Restore from backup
gunzip -c /root/backups/pfm/pfm_YYYYMMDD_HH-MM.sql.gz | \
  docker compose exec -T postgres psql -U pfm -d pfmdb

# Or for uncompressed SQL:
# docker compose exec -T postgres psql -U pfm -d pfmdb < /root/backups/pfm/pfm_YYYYMMDD.sql

# 4. Restart all services
docker compose up -d api bot
```

---

## Success Criteria

After restore:

- [ ] `\dt` in psql lists all expected tables: User, Period, Expense, Income, etc.
- [ ] Row counts look reasonable:
  ```bash
  docker compose exec postgres psql -U pfm -d pfmdb -c \
    "SELECT 'User' AS tbl, count(*) FROM \"User\"
     UNION ALL SELECT 'Period', count(*) FROM \"Period\"
     UNION ALL SELECT 'Expense', count(*) FROM \"Expense\";"
  ```
- [ ] `curl http://127.0.0.1:3002/health/deep` returns `{"ok":true,"db":true,...}`
- [ ] At least one ACTIVE period exists

---

## Copy Backup Off Server

```bash
# Run from your local machine
scp root@147.45.213.51:/root/backups/pfm/pfm_2026-03-20_03-00.sql.gz ~/Desktop/
```

---

## Automated Backups: NOT Configured

**Current state:** Manual backup only. No automated backup schedule is configured. This is a known ops gap.

**Recommended setup:** Add a daily cron on the server host. Run this once:

```bash
ssh root@147.45.213.51
crontab -e
```

Add these two lines:

```
# Daily backup at 03:00 UTC
0 3 * * * docker compose -f /srv/pfm/docker-compose.yml exec -T postgres pg_dump -U pfm pfmdb | gzip > /root/backups/pfm/pfm_$(date +\%Y-\%m-\%d_\%H-\%M).sql.gz

# Delete backups older than 14 days
30 3 * * * find /root/backups/pfm/ -name "*.sql.gz" -mtime +14 -delete
```

Verify:

```bash
crontab -l
```

---

## Rollback / If Something Goes Wrong

- If restore fails mid-way (network drop, disk full): the DB may be in a partial state. Re-run steps 2–4 from scratch.
- If the backup file itself is corrupt (truncated dump): you have no valid restore point. See production-checklist.md for off-server backup recommendations.
- If you restore but the app fails health checks: check that code version matches the schema in the backup — a mismatch may require a code rollback too (see [runbook-rollback.md](./runbook-rollback.md) § Section C).

---

## Known Limitations

- No automated backup schedule configured (manual only)
- No off-site backup storage — if the server is lost, all data is gone
- No point-in-time recovery (no WAL archiving configured)

---

## Related Docs

- [runbook-rollback.md](./runbook-rollback.md) — DB restore is part of the rollback flow
- [production-checklist.md](./production-checklist.md) — backup gaps tracked in Known Gaps section
- [ops-index.md](./ops-index.md) — ops entry point
