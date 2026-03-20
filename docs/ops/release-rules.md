---
title: "Release Rules"
document_type: Operational
status: Active
source_of_truth: "YES — for release classification and process rules"
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - runbook-deploy.md
  - runbook-rollback.md
  - ops-index.md
  - ../delivery/technical-debt-register.md
---

# Release Rules

---

## Branch Strategy

- `main` = production. What is on `main` is what runs on the server.
- No staging branch. Development happens locally; production is the only environment.
- Feature branches are optional for larger changes but not required for solo dev.
- Direct commits to `main` are acceptable for small fixes and chores.

**Deploy trigger:** A deploy is manual. Pushing to `main` does not auto-deploy.
See [runbook-deploy.md](./runbook-deploy.md).

---

## Release Type Classification

Classify every release before deploying. Classification determines which checklist applies.

| Type | Triggers | Examples |
|------|----------|---------|
| `logic-affecting` | Changes `engine.ts`, `cron.ts`, period bounds, income allocation, debt payoff, EF calculation | Fix prorate logic, change s2sToday formula, new cron schedule |
| `infra-only` | Dockerfile, docker-compose.yml, nginx config, env var changes | Change port binding, update base image, add env var |
| `ui-only` | Visual changes in MiniApp components, copy/text changes, style changes | Change button label, fix layout shift, add skeleton loader |
| `security` | Auth middleware, CORS config, initData validation, rate limiting, ADMIN_KEY usage | Add auth_date freshness check, restrict CORS origin |

A single release can have multiple types (e.g., `logic-affecting + security`). Use the
most restrictive checklist that applies.

---

## Logic-Affecting Release Checklist (MANDATORY)

Every release classified as `logic-affecting` must complete this checklist before deploy.

- [ ] `formulas-and-calculation-policy.md` is updated to reflect the new formula or rule
- [ ] Worked examples in that doc still produce the correct output with the new formula
- [ ] `gap-analysis.md` updated if this release closes a known gap
- [ ] Manual smoke test completed:
  - Capture before state: `curl https://mytodaylimit.ru/api/tg/dashboard -H "X-TG-Init-Data: <token>" | jq '.s2sToday, .s2sDaily, .s2sPeriod'`
  - Deploy the code
  - Capture after state with the same curl
  - Verify delta matches the expected formula change
  - Document both before and after values (Telegram saved message is sufficient)
- [ ] Commit message includes: `Logic change: [description of formula impact]`
- [ ] Deploy does NOT happen in the window 23:45 – 00:15 UTC (snapshot + rollover crons)

**Commit message format for logic-affecting releases:**
```
fix: correct income proration for mid-period onboarding

Logic change: income now prorated by daysRemaining/daysTotal instead of full period.
s2sToday increases for users who onboard after period start. No effect on users
onboarded at period start.
```

---

## Standard Release Checklist (All Releases)

- [ ] Change tested locally in development mode
- [ ] No obvious regressions in related features
- [ ] If schema changed: tested `prisma db push` locally
- [ ] If `.env` change needed: `.env` on server updated before deploy
- [ ] Manual backup taken if the change is risky (any schema change, any destructive data operation)

---

## Commit Convention

Follow Conventional Commits. Prefix determines changelog category.

| Prefix | When to use |
|--------|-------------|
| `feat:` | New user-facing feature |
| `fix:` | Bug fix |
| `refactor:` | Code restructuring with no behavior change |
| `chore:` | Build system, deps, tooling |
| `docs:` | Documentation only |
| `test:` | Tests only |
| `perf:` | Performance improvement |

**Format:** `<prefix>: <short imperative description>`

Breaking changes: append `!` after the prefix and add a `BREAKING CHANGE:` footer.

```
feat!: change expense amount field from float to integer

BREAKING CHANGE: all existing float amounts rounded on migration
```

---

## Migration Policy

5 rules. All mandatory.

1. **Never drop columns or tables in the same deploy that removes the code using them.**
   Safe sequence: Deploy 1 removes all code references to the column (column still exists
   in DB). Deploy 2 drops the column.

2. **Always test migrations locally before pushing.**
   ```bash
   pnpm --filter @pfm/db exec prisma db push --schema=prisma/schema.prisma
   # or for proper migrations:
   pnpm --filter @pfm/db exec prisma migrate dev --name <migration-name>
   ```

3. **`prisma db push` is TEMPORARY MVP MODE — target is `prisma migrate deploy`.**
   Current API container CMD runs `prisma db push` on startup. This is intentional for
   MVP but is not production-grade. It does not generate migration files and cannot be
   safely rolled back. Target state: generate proper migration files with
   `prisma migrate dev` locally, commit them, and run `prisma migrate deploy` in production.
   Tracked in technical debt register.

4. **Each migration must be reversible or have a documented rollback.**
   Before deploying any schema change, write down what SQL would undo it. Store the
   rollback note in a git commit message or Telegram saved message.

5. **Schema changes must be in the same PR/commit as the code that requires them.**
   Do not pre-deploy schema changes and code separately unless the safe-removal sequence
   (Rule 1) explicitly requires it.

---

## Hotfix Process

A hotfix is any fix deployed to production outside of normal feature development.

1. Fix the bug in the local codebase.
2. Test locally.
3. Commit with `fix:` prefix. If logic-affecting, complete the Logic-Affecting checklist.
4. Push to `main`:
   ```bash
   git push origin main
   ```
5. Deploy per [runbook-deploy.md](./runbook-deploy.md).
6. Verify health endpoint and logs after deploy.

For a hotfix that also requires a DB change, take a manual backup before deploying.

---

## Zero-Downtime Considerations

**Current reality:** `docker compose up -d --build` results in ~30 seconds of downtime
while containers restart. Acceptable for MVP stage.

**User impact during downtime:**
- Telegram bot: no response to messages. Messages are not lost — Telegram queues them.
- Mini app: shows a loading error. Users need to refresh.
- Cron jobs: if restart happens at 00:05 or 23:55 UTC, the cron run is missed for that day.
  Snapshot can be recalculated manually; period rollover is picked up the next day or
  triggered manually (see [runbook-cron.md](./runbook-cron.md)).

**Deploy timing rules:**
- Deploy during low-traffic hours: 02:00–05:00 UTC (05:00–08:00 Moscow time).
- Do NOT deploy in windows:
  - 23:45–00:15 UTC (snapshot + rollover cron window)
  - 08:55–09:05 UTC (payment alerts cron window)

---

## When to Bump Version

This project does not currently maintain a `version` field in `package.json` for
deployment purposes. Docker images are rebuilt from `main` on every deploy.

If semantic versioning is needed in the future (App Store releases, API versioning):
- **PATCH** (`x.x.1`): bug fixes, no schema changes
- **MINOR** (`x.1.0`): new features, backward-compatible
- **MAJOR** (`2.0.0`): breaking API changes or destructive schema migrations
