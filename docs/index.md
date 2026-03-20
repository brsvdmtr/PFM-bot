---
title: "PFM Bot — Documentation Index"
document_type: Operational
status: Active
source_of_truth: YES — for documentation registry
verified_against_code: Partial
last_updated: "2026-03-20"
---

# PFM Bot — Documentation Index

> Last updated: 2026-03-20
> Version: v0.1 MVP
> Domain: [mytodaylimit.ru](https://mytodaylimit.ru)

---

## Canonical Sources

These documents are authoritative for their domain. When in doubt, these win over other docs.

| Document | Path | What it owns |
|----------|------|-------------|
| Formulas and Calculation Policy | [system/formulas-and-calculation-policy.md](./system/formulas-and-calculation-policy.md) | THE formula source — S2S, carry-over, reserve, EF, avalanche |
| Numerical Source of Truth | [system/numerical-source-of-truth.md](./system/numerical-source-of-truth.md) | Where each number (10%, 5%, 3 months) comes from |
| Income Allocation Semantics | [system/income-allocation-semantics.md](./system/income-allocation-semantics.md) | Income split rules, multi-payday proration, trigger payday |
| System Spec v1 | [system/system-spec-v1.md](./system/system-spec-v1.md) | System invariants, architecture, data flow, debugging |
| API Reference v1 | [api/api-v1.md](./api/api-v1.md) | API contract — all routes, types, behaviors |
| Architecture | [architecture/ARCHITECTURE.md](./architecture/ARCHITECTURE.md) | Architecture overview, component relationships |
| Security Checklist | [security/security-privacy-checklist.md](./security/security-privacy-checklist.md) | Security controls, auth matrix, open gaps |

---

## Document Registry

| Document | Path | Doc Type | Status | Source of Truth | Verified vs Code | Drift Risk |
|----------|------|----------|--------|-----------------|------------------|------------|
| **Index** | | | | | | |
| Documentation Index | [index.md](./index.md) | Operational | Active | YES — doc registry | Partial | Medium |
| Audit Summary | [index-audit-summary.md](./index-audit-summary.md) | Gap-Audit | Active | YES — doc health | Partial | Low |
| **Product** | | | | | | |
| North Star Product Spec | [product/north-star-product-spec.md](./product/north-star-product-spec.md) | Normative | Active | No | Partial | Medium |
| How We Calculate (user copy) | [product/how-we-calculate-copy.md](./product/how-we-calculate-copy.md) | UX Copy | Active | No | Partial | Medium |
| FAQ MVP | [product/faq-mvp.md](./product/faq-mvp.md) | UX Copy | Active | No | Partial | Medium |
| Tracking Plan | [product/tracking-plan.md](./product/tracking-plan.md) | Operational | Active — events defined, not implemented | No | No | Low |
| Gap Analysis | [product/gap-analysis.md](./product/gap-analysis.md) | Gap-Audit | Active | No | Partial | Medium |
| Dashboard UI Data Contract | [product/dashboard-ui-data-contract.md](./product/dashboard-ui-data-contract.md) | Normative | Active | No | Partial | High |
| **System** | | | | | | |
| System Spec v1 | [system/system-spec-v1.md](./system/system-spec-v1.md) | Normative | Active | YES | Partial | Medium |
| Formulas & Calculation Policy | [system/formulas-and-calculation-policy.md](./system/formulas-and-calculation-policy.md) | Normative | Active | YES — formulas | Partial | Low |
| Numerical Source of Truth | [system/numerical-source-of-truth.md](./system/numerical-source-of-truth.md) | Normative | Active | YES — numbers | Partial | Low |
| Income Allocation Semantics | [system/income-allocation-semantics.md](./system/income-allocation-semantics.md) | Normative | Active | YES — income rules | Partial | Low |
| Glossary | [system/glossary.md](./system/glossary.md) | Normative | Active | YES — terms | Partial | Low |
| **API** | | | | | | |
| API Reference v1 | [api/api-v1.md](./api/api-v1.md) | Normative | Active — Partial (error model pending) | YES — API contract | Partial | Medium |
| OpenAPI YAML | [api/openapi/api-v1.yaml](./api/openapi/api-v1.yaml) | Normative | Active | YES — API contract | Partial | Medium |
| **Architecture** | | | | | | |
| Architecture Overview | [architecture/ARCHITECTURE.md](./architecture/ARCHITECTURE.md) | Normative | Active — drift risk | No | Partial | High |
| ADR-001: Monolith Web-First | [architecture/adr-001-monolith-web-first.md](./architecture/adr-001-monolith-web-first.md) | ADR | Accepted | No | Partial | Low |
| ADR-002: Money in Minor Units | [architecture/adr-002-money-in-minor-units.md](./architecture/adr-002-money-in-minor-units.md) | ADR | Accepted | No | Partial | Low |
| ADR-003: S2S Formula | [architecture/adr-003-s2s-formula.md](./architecture/adr-003-s2s-formula.md) | ADR | Accepted | No | Partial | Low |
| ADR-004: Debt Avalanche | [architecture/adr-004-debt-avalanche.md](./architecture/adr-004-debt-avalanche.md) | ADR | Accepted | No | Partial | Low |
| ADR-005: Auth Strategy | [architecture/adr-005-auth-strategy.md](./architecture/adr-005-auth-strategy.md) | ADR | Accepted — updated 2026-03-20 | No | Yes | Low |
| ADR-006: Idempotent Expense Model | [architecture/adr-006-idempotent-expense-model.md](./architecture/adr-006-idempotent-expense-model.md) | ADR | Accepted | No | Partial | Low |
| ADR-007: Timezone & Period Boundaries | [architecture/adr-007-timezone-and-period-boundaries.md](./architecture/adr-007-timezone-and-period-boundaries.md) | ADR | Accepted — updated 2026-03-20 | No | Yes | Low |
| **Security** | | | | | | |
| Security & Privacy Checklist | [security/security-privacy-checklist.md](./security/security-privacy-checklist.md) | Operational | Active | YES — security controls | Partial | Medium |
| Privacy Policy Draft | [security/privacy-policy-draft.md](./security/privacy-policy-draft.md) | UX Copy | Draft | No | Partial | Low |
| **Ops** | | | | | | |
| Ops Index | [ops/ops-index.md](./ops/ops-index.md) | Operational | Active | Partial | Partial | Low |
| Deploy Runbook | [ops/runbook-deploy.md](./ops/runbook-deploy.md) | Operational | Active | No | Partial | Medium |
| Rollback Runbook | [ops/runbook-rollback.md](./ops/runbook-rollback.md) | Operational | Active | No | Partial | Medium |
| Cron Runbook | [ops/runbook-cron.md](./ops/runbook-cron.md) | Operational | Active | No | Partial | Medium |
| Backup & Restore Runbook | [ops/runbook-backup-restore.md](./ops/runbook-backup-restore.md) | Operational | Active | No | Partial | Medium |
| Production Checklist | [ops/production-checklist.md](./ops/production-checklist.md) | Operational | Active | No | Partial | Medium |
| Release Rules | [ops/release-rules.md](./ops/release-rules.md) | Operational | Active | No | Partial | Low |
| **Delivery Templates** | | | | | | |
| Bug Report Template | [delivery/bug-report-template.md](./delivery/bug-report-template.md) | Template | Active | No | N/A | Low |
| Logic Issue Template | [delivery/logic-issue-template.md](./delivery/logic-issue-template.md) | Template | Active | No | N/A | Low |
| Technical Debt Register | [delivery/technical-debt-register.md](./delivery/technical-debt-register.md) | Gap-Audit | Active | YES — debt tracking | Partial | High |
| **Root** | | | | | | |
| README.md | [../README.md](../README.md) | Operational | Active — revised 2026-03-20 | No | Partial | Low |

---

## Documents with Known Drift Risk

These documents may lag behind code changes and should be reviewed when their domain changes.

| Document | Drift Risk | Why | What triggers drift |
|----------|------------|-----|---------------------|
| architecture/ARCHITECTURE.md | High | Broad system description, manually maintained | Any structural change to services or infra |
| delivery/technical-debt-register.md | High | Items may be resolved without updating the register | Every bug fix, refactor, or feature add |
| product/dashboard-ui-data-contract.md | High | Tightly coupled to API response shape | Any change to `GET /tg/dashboard` |
| api/api-v1.md | Medium | Manual documentation of code behavior | Any route added, changed, or deprecated |
| api/openapi/api-v1.yaml | Medium | Manual OpenAPI spec | Any route or schema change |
| ops/runbook-*.md | Medium | Steps tied to current infrastructure | Any infra, docker-compose, or nginx change |

---

## Needs Code Verification

Specific claims in documents that have not been verified against running code:

| Document | Claim | Verification Command | Status |
|----------|-------|---------------------|--------|
| api/api-v1.md | `GET /tg/me/profile` exact fields returned | Read the route handler in `apps/api/src/` | Not verified |
| security/security-privacy-checklist.md | ADMIN_KEY is non-default in prod | `grep ADMIN_KEY /srv/pfm/.env` | Not verified |
| security/security-privacy-checklist.md | Secrets not in logs | `docker compose logs api \| grep -i token` | Not verified |
| architecture/adr-007 | DailySnapshot fires at 23:55 UTC | `grep "23:55" apps/api/src/cron.ts` | Partially verified |
| api/api-v1.md | `GET /tg/expenses` scopes to active period only | Read listExpenses route handler | Partially verified |
| delivery/technical-debt-register.md | TD-005 Dockerfile uses migrate deploy | Read `Dockerfile.api` entrypoint | Not verified |

---

## Known Gaps (Top Priority)

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| TD-001 | No rate limiting on API | P1 | open |
| TD-007 / GAP-008 | /delete user data not implemented | P1 | open |
| GAP-001 / TD-011 | Trigger payday not persisted in Period | P1 | open |
| GAP-003 / TD-009 | Notification dedup lost on container restart | P1 | open |
| GAP-004 / TD-003 | Period rollover timing off by UTC offset | P2 | open |
| GAP-007 | EF contribution not resuming after target change | P2 | open |
| TD-C002 | CORS open to all origins | P0 | FIXED 2026-03-20 |
| TD-C003 | auth_date not validated (replay attack) | P0 | FIXED 2026-03-20 |
| TD-C001 | Cron rollover used incomes[0].paydays | P1 | FIXED 2026-03-20 |
| GAP-011 | Duplicate incomes on onboarding re-run | — | FIXED 2026-03-20 |

---

## Deprecated / Moved Docs

| Old path | New path | Reason |
|----------|----------|--------|
| docs/ARCHITECTURE.md | docs/architecture/ARCHITECTURE.md | Moved to architecture/ subfolder |
| docs/adr/* | docs/architecture/adr-* | ADRs co-located with architecture docs |

Note: Both old and new paths may currently exist. The canonical location is `docs/architecture/`. Old paths in `docs/adr/` are the original location; `docs/architecture/` contains copies. When editing ADRs, update `docs/architecture/`.
