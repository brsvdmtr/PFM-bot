# PFM Bot — Documentation Index

> Last updated: 2026-03-20
> Version: v0.1 MVP
> Domain: [mytodaylimit.ru](https://mytodaylimit.ru)

---

## Index

| Document | Path | Status | Owner | Notes |
|---|---|---|---|---|
| **Product** | | | | |
| North Star Product Spec | [product/north-star-product-spec.md](./product/north-star-product-spec.md) | ✅ done | Dmitriy | v0.1 MVP scope |
| How We Calculate (user copy) | [product/how-we-calculate-copy.md](./product/how-we-calculate-copy.md) | ✅ done | Dmitriy | Ready for in-app FAQ |
| FAQ MVP | [product/faq-mvp.md](./product/faq-mvp.md) | ✅ done | Dmitriy | 17 вопросов на русском |
| Tracking Plan | [product/tracking-plan.md](./product/tracking-plan.md) | ✅ done — events defined, **not implemented** | Dmitriy | PostHog recommended |
| Gap Analysis | [product/gap-analysis.md](./product/gap-analysis.md) | ✅ done | Dmitriy | 12 gaps, 1 fixed |
| **System** | | | | |
| System Spec v1 | [system/system-spec-v1.md](./system/system-spec-v1.md) | ✅ done | Dmitriy | Architecture, data flow, topology |
| **API** | | | | |
| API Reference v1 | [api/api-v1.md](./api/api-v1.md) | ✅ done | Dmitriy | All routes documented |
| OpenAPI YAML | [api/openapi/api-v1.yaml](./api/openapi/api-v1.yaml) | ✅ done | Dmitriy | OpenAPI 3.0, ~2100 lines |
| **ADRs** | | | | |
| ADR-001: Monolith Web-First | [adr/adr-001-monolith-web-first.md](./adr/adr-001-monolith-web-first.md) | ✅ done | Dmitriy | |
| ADR-002: Money in Minor Units | [adr/adr-002-money-in-minor-units.md](./adr/adr-002-money-in-minor-units.md) | ✅ done | Dmitriy | Int kopecks, 21M ₽ ceiling risk noted |
| ADR-003: S2S Formula | [adr/adr-003-s2s-formula.md](./adr/adr-003-s2s-formula.md) | ✅ done | Dmitriy | Full formula with worked example |
| ADR-004: Debt Avalanche | [adr/adr-004-debt-avalanche.md](./adr/adr-004-debt-avalanche.md) | ✅ done | Dmitriy | APR thresholds, pool allocation rates |
| ADR-005: Auth Strategy | [adr/adr-005-auth-strategy.md](./adr/adr-005-auth-strategy.md) | ✅ done | Dmitriy | Telegram HMAC-SHA256 |
| ADR-006: Idempotent Expense Model | [adr/adr-006-idempotent-expense-model.md](./adr/adr-006-idempotent-expense-model.md) | ✅ done | Dmitriy | No edit, delete-only |
| ADR-007: Timezone & Period Boundaries | [adr/adr-007-timezone-and-period-boundaries.md](./adr/adr-007-timezone-and-period-boundaries.md) | ✅ done | Dmitriy | UTC midnight drift documented |
| **Security** | | | | |
| Security & Privacy Checklist | [security/security-privacy-checklist.md](./security/security-privacy-checklist.md) | ✅ done | Dmitriy | CORS & auth_date gaps fixed in code |
| Privacy Policy Draft | [security/privacy-policy-draft.md](./security/privacy-policy-draft.md) | ⚠️ partial | Dmitriy | Contact + /delete command TODO |
| **Ops** | | | | |
| Deploy Runbook | [ops/runbook-deploy.md](./ops/runbook-deploy.md) | ✅ done | Dmitriy | |
| Rollback Runbook | [ops/runbook-rollback.md](./ops/runbook-rollback.md) | ✅ done | Dmitriy | |
| Cron Runbook | [ops/runbook-cron.md](./ops/runbook-cron.md) | ✅ done | Dmitriy | All 4 cron jobs |
| Backup & Restore Runbook | [ops/runbook-backup-restore.md](./ops/runbook-backup-restore.md) | ✅ done | Dmitriy | pg_dump, 14-day rotation |
| Production Checklist | [ops/production-checklist.md](./ops/production-checklist.md) | ✅ done | Dmitriy | 46 items |
| Release Rules | [ops/release-rules.md](./ops/release-rules.md) | ✅ done | Dmitriy | |
| **Delivery Templates** | | | | |
| Bug Report Template | [delivery/bug-report-template.md](./delivery/bug-report-template.md) | ✅ done | Dmitriy | |
| Logic Issue Template | [delivery/logic-issue-template.md](./delivery/logic-issue-template.md) | ✅ done | Dmitriy | |
| Technical Debt Register | [delivery/technical-debt-register.md](./delivery/technical-debt-register.md) | ✅ done | Dmitriy | 18 items |

---

## Known Gaps (Top Priority)

| ID | Title | Priority | Status |
|---|---|---|---|
| GAP-001 | Trigger payday not persisted in Period | P1 | open |
| GAP-003 | Notification dedup lost on container restart | P1 | open |
| GAP-004 | Period rollover timing off by ±UTC offset | P2 | open |
| GAP-007 | EF contribution not resuming after target change | P2 | open |
| GAP-008 | /delete user data command not implemented | P1 | open |
| GAP-011 | Duplicate incomes on onboarding re-run | — | ✅ FIXED |
| TD-001 | No rate limiting on API | P1 | open |
| TD-003 | CORS open to all origins | P0 | ✅ FIXED |
| TD-004 | auth_date not validated (replay attack) | P0 | ✅ FIXED |
| TD-007 | Cron rollover uses incomes[0].paydays | P1 | ✅ FIXED |
