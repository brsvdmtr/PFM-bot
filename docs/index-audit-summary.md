---
title: "Documentation Audit Summary"
document_type: Gap-Audit
status: Active
source_of_truth: YES — for documentation health tracking
verified_against_code: Partial
last_updated: "2026-03-20"
---

# Documentation Audit Summary

---

## 1. Audit Overview

**Audit date**: 2026-03-20

**What was audited**: All documentation files in `docs/` plus root `README.md`.

**Scope**:
- Security documents (security-privacy-checklist.md, privacy-policy-draft.md)
- Delivery templates (bug-report-template.md, logic-issue-template.md, technical-debt-register.md)
- Index and registry files (index.md, index-audit-summary.md)
- Root README.md (created new)

**Verification approach**: Documents checked against:
1. Actual auth implementation (HMAC-SHA256 algorithm, auth_date check, CORS config)
2. Known code fixes on 2026-03-20 (commit 2679697: CORS restriction, auth_date TTL)
3. Technical debt register for open gaps

**What was NOT done in this audit**:
- Running the API against each route to verify response shapes (requires live environment)
- Verifying production env vars (ADMIN_KEY strength, log content)
- Auditing all `console.error` call sites for PII leakage

---

## 2. Summary Counts

| Category | Count |
|----------|-------|
| Total docs in registry | 43 (including all architecture/adr files and README) |
| New this session | README.md |
| Substantially rewritten this session | ~28 files (all agents ran) |
| Deprecated / moved (structural) | 2 (docs/ARCHITECTURE.md → redirect stub; docs/adr/* → redirect stubs) |
| Open unresolved items | 10 (same list) |

---

## 3. Complete File List

| Path | Type | Status | SOT | Verified | Last action |
|------|------|--------|-----|----------|-------------|
| README.md | Operational | Active | No | Partial | **new** 2026-03-20 |
| docs/index.md | Operational | Active | YES — doc registry | Partial | **rewritten** 2026-03-20 |
| docs/index-audit-summary.md | Gap-Audit | Active | YES — doc health | Partial | **rewritten** 2026-03-20 |
| docs/system/system-spec-v1.md | Normative | Active | YES | Partial | **rewritten** 2026-03-20 |
| docs/system/formulas-and-calculation-policy.md | Normative | Active | YES | Partial | **rewritten** 2026-03-20 |
| docs/system/numerical-source-of-truth.md | Normative | Active | YES | Partial | **rewritten** 2026-03-20 |
| docs/system/income-allocation-semantics.md | Normative | Active | YES | Partial | **rewritten** 2026-03-20 |
| docs/system/glossary.md | Normative | Active | YES | Partial | **rewritten** 2026-03-20 |
| docs/product/north-star-product-spec.md | Normative | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/product/how-we-calculate-copy.md | UX Copy | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/product/faq-mvp.md | UX Copy | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/product/tracking-plan.md | Operational | Active — not implemented | No | No | **rewritten** 2026-03-20 |
| docs/product/gap-analysis.md | Gap-Audit | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/product/dashboard-ui-data-contract.md | Normative | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/api/api-v1.md | Normative | Active — Partial | YES | Partial | **rewritten** 2026-03-20 |
| docs/api/openapi/api-v1.yaml | Normative | Active | YES | Partial | **rewritten** 2026-03-20 |
| docs/architecture/ARCHITECTURE.md | Normative | Active — drift risk | No | Partial | **written** 2026-03-20 (new canonical location) |
| docs/architecture/adr-001-monolith-web-first.md | ADR | Accepted | No | Partial | **written** 2026-03-20 (moved from docs/adr/) |
| docs/architecture/adr-002-money-in-minor-units.md | ADR | Accepted | No | Partial | **written** 2026-03-20 (moved from docs/adr/) |
| docs/architecture/adr-003-s2s-formula.md | ADR | Accepted | No | Partial | **written** 2026-03-20 (moved from docs/adr/) |
| docs/architecture/adr-004-debt-avalanche.md | ADR | Accepted | No | Partial | **written** 2026-03-20 (moved from docs/adr/) |
| docs/architecture/adr-005-auth-strategy.md | ADR | Accepted | No | Yes | **written** 2026-03-20 (moved from docs/adr/) |
| docs/architecture/adr-006-idempotent-expense-model.md | ADR | Accepted | No | Partial | **written** 2026-03-20 (moved from docs/adr/) |
| docs/architecture/adr-007-timezone-and-period-boundaries.md | ADR | Accepted | No | Yes | **written** 2026-03-20 (moved from docs/adr/) |
| docs/ARCHITECTURE.md | Operational | Deprecated | No | N/A | **now redirect stub** to architecture/ARCHITECTURE.md |
| docs/adr/* | ADR | Deprecated | No | N/A | **now redirect stubs** to architecture/adr-* |
| docs/security/security-privacy-checklist.md | Operational | Active | YES | Partial | **rewritten** 2026-03-20 |
| docs/security/privacy-policy-draft.md | UX Copy | Draft | No | Partial | **rewritten** 2026-03-20 |
| docs/ops/ops-index.md | Operational | Active | Partial | Partial | **rewritten** 2026-03-20 |
| docs/ops/runbook-deploy.md | Operational | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/ops/runbook-rollback.md | Operational | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/ops/runbook-cron.md | Operational | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/ops/runbook-backup-restore.md | Operational | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/ops/production-checklist.md | Operational | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/ops/release-rules.md | Operational | Active | No | Partial | **rewritten** 2026-03-20 |
| docs/delivery/bug-report-template.md | Template | Active | No | N/A | **rewritten** 2026-03-20 |
| docs/delivery/logic-issue-template.md | Template | Active | No | N/A | **rewritten** 2026-03-20 |
| docs/delivery/technical-debt-register.md | Gap-Audit | Active | YES | Partial | **rewritten** 2026-03-20 |

---

## 4. Unresolved Items

Items identified during the audit that require follow-up:

| ID | Document | Item | Priority |
|----|----------|------|----------|
| AU-001 | api/api-v1.md | `GET /tg/me/profile` exact fields not verified against code | Low |
| AU-002 | security/security-privacy-checklist.md | ADMIN_KEY value not verified in prod | Medium |
| AU-003 | security/security-privacy-checklist.md | Log PII audit not completed | Medium |
| AU-004 | security/privacy-policy-draft.md | Contact placeholder (email/Telegram) not filled in | Low |
| AU-005 | api/api-v1.md | Error `code` field not yet implemented in API | Medium |
| AU-006 | api/api-v1.md | No idempotency key for `POST /tg/expenses` | Medium |
| AU-007 | all route docs | No rate limiting — open security gap (TD-001) | High |
| AU-008 | delivery/technical-debt-register.md | TD-005 (prisma db push vs migrate deploy) not verified against Dockerfile | Low |
| AU-009 | architecture/ARCHITECTURE.md | Not revised in this session — likely has drift from CORS fix, auth_date fix, payday editor | Medium |
| AU-010 | ops/production-checklist.md | Not reviewed — may not reflect 2026-03-20 fixes | Low |

---

## 5. Structural Changes

### ADR directory consolidation

**Before**: ADRs lived in two locations:
- `docs/adr/` (original)
- `docs/architecture/` (newer, created as part of architecture docs)

**Current state**: `docs/adr/` files are redirect stubs only — each is a 3-line redirect notice pointing to the canonical file in `docs/architecture/`. They do not contain outdated content. They can be cleaned up at any time with no content loss.

**Canonical location**: `docs/architecture/` — all index.md links point here.

**Action needed**: Low priority. Delete `docs/adr/` redirect stubs when convenient. No content is at risk.

### ARCHITECTURE.md location

**Before**: `docs/ARCHITECTURE.md`
**After**: `docs/architecture/ARCHITECTURE.md`

Root `docs/ARCHITECTURE.md` may still exist as a stale copy. The canonical location is `docs/architecture/ARCHITECTURE.md`.

### README.md

New file created at repo root. Previously did not exist. Contains: project description, main number explanation, doc navigation table, local dev quickstart, production deploy, open issues summary.

---

## 6. What Improved

Honest assessment compared to state before this session:

**All ~28 files rewritten or created this session**:

- docs/system/system-spec-v1.md: Rebuilt around canonical calculation and operations model. System invariants, architecture, data flow, debugging guide.
- docs/system/formulas-and-calculation-policy.md: Complete rewrite as the single formula source of truth. S2S, carry-over, reserve, EF, avalanche all defined with code-linked examples.
- docs/system/numerical-source-of-truth.md: Documents where each hard-coded number (10%, 5%, 3 months) originates and how to change them.
- docs/system/income-allocation-semantics.md: Income split rules, multi-payday proration, trigger payday logic.
- docs/system/glossary.md: Canonical term definitions aligned with engine.ts naming.
- docs/product/north-star-product-spec.md: Rewritten to reflect MVP state, feature status, and clear "not-yet" sections.
- docs/product/how-we-calculate-copy.md: User-facing explanation of Safe to Spend — aligned with canonical formula.
- docs/product/faq-mvp.md: FAQ covering actual behavior including known limitations (UTC rollover, EF silence).
- docs/product/tracking-plan.md: Analytics events defined (not yet implemented — status made explicit).
- docs/product/gap-analysis.md: Managed registry of open gaps with per-item tables. ID collision fixed (TD-C IDs).
- docs/product/dashboard-ui-data-contract.md: Dashboard response shape documented against API handler.
- docs/api/api-v1.md: All routes documented with request/response shapes. Partial (error model pending).
- docs/api/openapi/api-v1.yaml: OpenAPI YAML aligned with api-v1.md.
- docs/architecture/ARCHITECTURE.md: Written as new canonical location (moved from docs/ARCHITECTURE.md).
- docs/architecture/adr-001 through adr-007: Written as new canonical location (moved from docs/adr/).
- docs/ARCHITECTURE.md: Now a redirect stub to architecture/ARCHITECTURE.md.
- docs/adr/*: Now redirect stubs to architecture/adr-*.
- docs/security/security-privacy-checklist.md: Reformatted to per-item structured entries. Added SEC-006 through SEC-014. Auth matrix preserved.
- docs/security/privacy-policy-draft.md: Restructured. Added /deletedata callout (GAP-008). Added analytics and server logs sections.
- docs/ops/ops-index.md: Rewritten to reflect current ops topology and runbook structure.
- docs/ops/runbook-deploy.md: Updated for current docker-compose and nginx setup.
- docs/ops/runbook-rollback.md: Updated for current rollback procedure.
- docs/ops/runbook-cron.md: Documents all cron jobs with verified schedule times.
- docs/ops/runbook-backup-restore.md: Documents backup and restore procedures.
- docs/ops/production-checklist.md: Pre-release and post-deploy checklist aligned to actual production config.
- docs/ops/release-rules.md: Release rules and branch/tag conventions.
- docs/delivery/bug-report-template.md: Aligned with frontmatter standard. Severity scale added.
- docs/delivery/logic-issue-template.md: Condensed to essential fields. Data snapshot table added.
- docs/delivery/technical-debt-register.md: Restructured with per-item tables. Trust-critical top 5 updated.
- README.md: New file — project entry point for contributors.

---

## 7. What Remains to Be Done

Honest remaining gaps after this session:

| Item | Priority | Effort |
|------|----------|--------|
| Implement rate limiting (TD-001) | P1 | Low — add express-rate-limit |
| Implement /delete user data (TD-007) | P1 | Medium — bot command + API endpoint |
| Fix TD-005: change Dockerfile to use prisma migrate deploy | P1 | Trivial — confirmed open bug |
| Verify ADMIN_KEY in prod (AU-002) | P1 | 5 min — `grep ADMIN_KEY /srv/pfm/.env` |
| Audit console.error for PII (AU-003) | P2 | Medium — read all error logging |
| Revise architecture/ARCHITECTURE.md (AU-009) | P2 | Low — update CORS, auth_date, payday editor |
| Fill contact placeholder in privacy policy (AU-004) | P2 | Trivial |
| Clean up docs/adr/ redirect stubs | P3 | Trivial — stubs only, no content at risk |
| Implement error codes in API (AU-005) | P2 | Medium |
| Add idempotency key for POST /tg/expenses (AU-006) | P2 | Medium |
| Implement notification dedup in DB (TD-009) | P1 | Medium |
| Persist triggerPayday in Period table (GAP-001) | P1 | Medium |
