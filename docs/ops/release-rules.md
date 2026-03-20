# Release Process Rules

## Branch Strategy

- `main` = production. What is on `main` is what runs on the server.
- No staging branch. Development happens locally; production is the only environment.
- Feature branches are optional for larger changes but not required for solo dev.
- Direct commits to `main` are acceptable for small fixes and chores.

**Deploy trigger:** A deploy is manual. Pushing to `main` does not auto-deploy.
See [runbook-deploy.md](./runbook-deploy.md).

---

## Commit Convention

Follow Conventional Commits. The prefix determines changelog category.

| Prefix | When to use |
|--------|-------------|
| `feat:` | New user-facing feature |
| `fix:` | Bug fix |
| `refactor:` | Code restructuring with no behavior change |
| `chore:` | Build system, deps, tooling, CI |
| `docs:` | Documentation only |
| `test:` | Tests only |
| `perf:` | Performance improvement |

**Format:** `<prefix>: <short imperative description>`

Examples:
```
feat: add weekly digest notification
fix: prorate multi-payday income per period
chore: upgrade pnpm to 10.2
refactor: extract period bounds calculation to engine module
```

Breaking changes: append `!` after the prefix and add a `BREAKING CHANGE:` footer.

```
feat!: change expense amount field from float to integer

BREAKING CHANGE: all existing float amounts rounded on migration
```

---

## When to Bump Version

This project does not currently maintain a `version` field in `package.json` for
deployment purposes. Docker images are not tagged by version — they are always rebuilt
from `main`.

If semantic versioning is needed in the future (e.g., for App Store releases or API
versioning), adopt this rule:

- **PATCH** (`x.x.1`): bug fixes, no schema changes
- **MINOR** (`x.1.0`): new features, backward-compatible
- **MAJOR** (`2.0.0`): breaking API changes or destructive schema migrations

---

## Database Migration Policy

**Rule 1: Never drop columns or tables in the same deploy that removes the code using them.**

Safe migration sequence for removing a column:
1. Deploy 1: Remove all code references to the column (it still exists in DB).
2. Deploy 2 (separate): Add migration to drop the column.

**Rule 2: Always test migrations locally before pushing.**

```bash
# Local test
pnpm --filter @pfm/db exec prisma db push --schema=prisma/schema.prisma
# or
pnpm --filter @pfm/db exec prisma migrate dev --name <migration-name>
```

**Rule 3: The API container runs `prisma db push` on every startup.**

This means schema changes are applied automatically when the container restarts. There is
no separate migration step in the deploy procedure. The risk: if the push fails, the API
container will not start. Fix the schema or revert the code before redeploying.

**Rule 4: For destructive changes (column drop, type change), take a manual backup first.**

```bash
# Before a risky deploy
docker compose -f /srv/pfm/docker-compose.yml exec -T postgres \
  pg_dump -U pfm pfmdb | gzip > /root/backups/pfm/pre-deploy_$(date +%Y-%m-%d).sql.gz
```

**Rule 5: Additive changes (new columns with defaults, new tables) are safe to deploy directly.**

---

## Hotfix Process

A hotfix is any fix deployed to production outside of normal feature development.

1. Fix the bug in the local codebase.
2. Test locally.
3. Commit with `fix:` prefix.
4. Push to `main`:
   ```bash
   git push origin main
   ```
5. Deploy immediately per [runbook-deploy.md](./runbook-deploy.md).
6. Verify health endpoint and logs after deploy.

For a hotfix that also requires a DB change, back up before deploying (Rule 4 above).

---

## Zero-Downtime Considerations

**Current reality:** The deploy procedure (`docker compose up -d --build`) results in
approximately 30 seconds of downtime while containers restart. This is acceptable for
the current MVP stage.

**User impact during downtime:**
- Telegram bot: users get no response to messages. Messages are not lost — Telegram
  queues them and the bot processes them when it comes back up.
- Mini app: shows a loading error. Users need to refresh.
- Cron jobs: if restart happens at 00:05 or 23:55, the cron run is missed for that day.
  The snapshot can be recalculated; the period rollover will be picked up the next day
  (or triggered manually).

**To reduce downtime risk:**
- Deploy during low-traffic hours (02:00–05:00 UTC, i.e., 05:00–08:00 Moscow time).
- Avoid deploying at 23:50–23:59 UTC (before snapshot cron) or 00:00–00:10 UTC (rollover
  cron window).

---

## Who Approves Releases

This is a solo developer project. Self-review is the approval process.

**Pre-deploy checklist (mental):**
- [ ] Change tested locally in development mode
- [ ] No obvious regressions in related features
- [ ] If schema changed: tested `prisma db push` locally
- [ ] If `.env` change needed: `.env` on server updated before deploy
- [ ] Backup taken if the change is risky
