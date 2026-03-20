# PFM Bot — Personal Finance Manager

Telegram mini-app + bot for daily spending management. The core feature: **"Можно сегодня"** — a daily spending limit that automatically accounts for income, fixed expenses, debts, and emergency fund contributions.

> Live: [mytodaylimit.ru](https://mytodaylimit.ru) | Bot: @PFMBudgetBot

## The Main Number

The product has one central number: **Safe to Spend Today** ("Можно сегодня").

Formula summary: `income - obligations - debt_min_payments - reserve(10%) - EF_contribution - avalanche_pool = S2S Period`. Then: `daily_limit = (S2S_period - total_spent) / days_left`.

- **Canonical formula**: [docs/system/formulas-and-calculation-policy.md](./docs/system/formulas-and-calculation-policy.md)
- **Source of truth for numbers**: [docs/system/numerical-source-of-truth.md](./docs/system/numerical-source-of-truth.md)

## Documentation

| Need | Go to |
|------|-------|
| How calculations work | [docs/system/formulas-and-calculation-policy.md](./docs/system/formulas-and-calculation-policy.md) |
| All terms and definitions | [docs/system/glossary.md](./docs/system/glossary.md) |
| Income and two-payday logic | [docs/system/income-allocation-semantics.md](./docs/system/income-allocation-semantics.md) |
| System invariants and debugging | [docs/system/system-spec-v1.md](./docs/system/system-spec-v1.md) |
| API reference | [docs/api/api-v1.md](./docs/api/api-v1.md) |
| Dashboard UI fields | [docs/product/dashboard-ui-data-contract.md](./docs/product/dashboard-ui-data-contract.md) |
| Architecture decisions | [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) |
| Known bugs and gaps | [docs/product/gap-analysis.md](./docs/product/gap-analysis.md) |
| Technical debt register | [docs/delivery/technical-debt-register.md](./docs/delivery/technical-debt-register.md) |
| Deploy to production | [docs/ops/runbook-deploy.md](./docs/ops/runbook-deploy.md) |
| Security checklist | [docs/security/security-privacy-checklist.md](./docs/security/security-privacy-checklist.md) |
| All docs index | [docs/index.md](./docs/index.md) |

## Tech Stack

- **apps/api** — Express.js + TypeScript, port 3002, Prisma ORM
- **apps/bot** — Telegraf.js, Telegram bot
- **apps/web** — Next.js 14 standalone, port 3003, Telegram mini-app
- **packages/db** — Prisma schema + client (PostgreSQL 15)
- **packages/shared** — Shared types

## Local Development

```bash
# Prerequisites: Node.js 20+, pnpm, Docker
cp .env.example .env
# Edit .env: set BOT_TOKEN, DATABASE_URL

# Start DB:
docker compose up -d db

# Install deps:
pnpm install

# Build packages first:
pnpm --filter @pfm/db build

# Run migrations:
packages/db/node_modules/.bin/prisma migrate deploy --schema=packages/db/prisma/schema.prisma

# Start services:
pnpm --filter @pfm/api dev    # port 3002
pnpm --filter @pfm/bot dev    # Telegram bot
pnpm --filter @pfm/web dev    # port 3003 (mini-app)
```

## Production Deploy

See [docs/ops/runbook-deploy.md](./docs/ops/runbook-deploy.md).

```bash
ssh root@147.45.213.51
cd /srv/pfm && git reset --hard origin/main
docker compose up -d --build api
```

## Known Open Issues

**P1 — need code fix:**
- **TD-001** No rate limiting on API
- **TD-007 / GAP-008** No user data deletion (`/deletedata` not implemented)
- **GAP-001 / TD-011** Trigger payday not persisted — payday changes affect current period retroactively
- **TD-009 / GAP-003** Notification dedup is in-memory — lost on container restart
- **TD-005** Dockerfile uses `prisma db push` in production — should be `migrate deploy`

**P2 — fix eventually:**
- **GAP-004 / TD-003** Period rollover at 00:05 UTC, not user's local midnight
- **GAP-007** EF target change silently alters daily limit — no UI feedback
- **GAP-012 / GAP-013** `s2sDaily` naming ambiguity; `targetAmount` derived not stored

Full product/tech gaps: [docs/index.md §Known Gaps](./docs/index.md) | [docs/product/gap-analysis.md](./docs/product/gap-analysis.md) | [docs/delivery/technical-debt-register.md](./docs/delivery/technical-debt-register.md)

Audit findings (verification/compliance/docs drift): [docs/index-audit-summary.md §Audit Findings](./docs/index-audit-summary.md)
