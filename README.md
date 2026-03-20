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

- No rate limiting (TD-001, P1) — API can be flooded
- No user data deletion command (TD-007, P1) — GDPR right to erasure not yet implemented
- Trigger payday not persisted (GAP-001, P1) — payday changes affect current period retroactively

Full list: [docs/delivery/technical-debt-register.md](./docs/delivery/technical-debt-register.md)
