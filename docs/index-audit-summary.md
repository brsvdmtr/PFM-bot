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
| Total docs in registry | 35 |
| New this session | 1 (README.md) |
| Substantially rewritten this session | 7 |
| Deprecated / moved (structural) | 2 (ARCHITECTURE.md, adr/* → architecture/) |
| Open unresolved items | 10 |

---

## 3. Complete File List

| Path | Type | Status | SOT | Verified | Last action |
|------|------|--------|-----|----------|-------------|
| README.md | Operational | Active | No | Partial | **new** 2026-03-20 |
| docs/index.md | Operational | Active | YES — doc registry | Partial | **rewritten** 2026-03-20 |
| docs/index-audit-summary.md | Gap-Audit | Active | YES — doc health | Partial | **rewritten** 2026-03-20 |
| docs/system/system-spec-v1.md | Normative | Active | YES | Partial | not revised |
| docs/system/formulas-and-calculation-policy.md | Normative | Active | YES | Partial | not revised |
| docs/system/numerical-source-of-truth.md | Normative | Active | YES | Partial | not revised |
| docs/system/income-allocation-semantics.md | Normative | Active | YES | Partial | not revised |
| docs/system/glossary.md | Normative | Active | YES | Partial | not revised |
| docs/product/north-star-product-spec.md | Normative | Active | No | Partial | not revised |
| docs/product/how-we-calculate-copy.md | UX Copy | Active | No | Partial | not revised |
| docs/product/faq-mvp.md | UX Copy | Active | No | Partial | not revised |
| docs/product/tracking-plan.md | Operational | Active — not implemented | No | No | not revised |
| docs/product/gap-analysis.md | Gap-Audit | Active | No | Partial | not revised |
| docs/product/dashboard-ui-data-contract.md | Normative | Active | No | Partial | not revised |
| docs/api/api-v1.md | Normative | Active — Partial | YES | Partial | not revised |
| docs/api/openapi/api-v1.yaml | Normative | Active | YES | Partial | not revised |
| docs/architecture/ARCHITECTURE.md | Normative | Active — drift risk | No | Partial | moved from docs/ARCHITECTURE.md |
| docs/architecture/adr-001-monolith-web-first.md | ADR | Accepted | No | Partial | moved from docs/adr/ |
| docs/architecture/adr-002-money-in-minor-units.md | ADR | Accepted | No | Partial | moved from docs/adr/ |
| docs/architecture/adr-003-s2s-formula.md | ADR | Accepted | No | Partial | moved from docs/adr/ |
| docs/architecture/adr-004-debt-avalanche.md | ADR | Accepted | No | Partial | moved from docs/adr/ |
| docs/architecture/adr-005-auth-strategy.md | ADR | Accepted | No | Yes | moved from docs/adr/ |
| docs/architecture/adr-006-idempotent-expense-model.md | ADR | Accepted | No | Partial | moved from docs/adr/ |
| docs/architecture/adr-007-timezone-and-period-boundaries.md | ADR | Accepted | No | Yes | moved from docs/adr/ |
| docs/security/security-privacy-checklist.md | Operational | Active | YES | Partial | **rewritten** 2026-03-20 |
| docs/security/privacy-policy-draft.md | UX Copy | Draft | No | Partial | **rewritten** 2026-03-20 |
| docs/ops/ops-index.md | Operational | Active | Partial | Partial | not revised |
| docs/ops/runbook-deploy.md | Operational | Active | No | Partial | not revised |
| docs/ops/runbook-rollback.md | Operational | Active | No | Partial | not revised |
| docs/ops/runbook-cron.md | Operational | Active | No | Partial | not revised |
| docs/ops/runbook-backup-restore.md | Operational | Active | No | Partial | not revised |
| docs/ops/production-checklist.md | Operational | Active | No | Partial | not revised |
| docs/ops/release-rules.md | Operational | Active | No | Partial | not revised |
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

**Current state**: Both directories exist and contain the same ADR files. This is a known duplication.

**Canonical location**: `docs/architecture/` — all index.md links now point here.

**Action needed**: Delete `docs/adr/` directory once confirmed that `docs/architecture/` has all files. No content loss — both are identical.

### ARCHITECTURE.md location

**Before**: `docs/ARCHITECTURE.md`
**After**: `docs/architecture/ARCHITECTURE.md`

Root `docs/ARCHITECTURE.md` may still exist as a stale copy. The canonical location is `docs/architecture/ARCHITECTURE.md`.

### README.md

New file created at repo root. Previously did not exist. Contains: project description, main number explanation, doc navigation table, local dev quickstart, production deploy, open issues summary.

---

## 6. What Improved

Honest assessment compared to state before this session:

**Improved**:
- security-privacy-checklist.md: Reformatted from flat table to per-item structured entries with owner, verification method, next review. Added new items SEC-006 through SEC-014. Auth matrix preserved.
- privacy-policy-draft.md: Restructured to match provided format. Added explicit "not implemented" callout for /deletedata (GAP-008). Added analytics and server logs sections. Removed false claim about data export.
- bug-report-template.md: Aligned fields with frontmatter standard. Added severity/P-level scale. Added reference to logic-issue-template when appropriate.
- logic-issue-template.md: Condensed to essential fields. Added data snapshot table. Added checklist. Removed redundant example blocks.
- technical-debt-register.md: Restructured with proper per-item tables. Aligned IDs with the actual debt register (TD-001 through TD-023 from prior session). Trust-critical top 5 updated to reflect actual register state.
- README.md: New file — project did not have a README. Provides entry point for new contributors.
- index.md: Added architecture/ folder to registry. Updated ADR paths. Added deprecation/moved docs section.

**Not changed** (out of scope for this session):
- docs/product/* — not revised
- docs/system/* — not revised
- docs/api/* — not revised
- docs/ops/* — not revised
- docs/architecture/* — not revised

---

## 7. What Remains to Be Done

Honest remaining gaps after this session:

| Item | Priority | Effort |
|------|----------|--------|
| Implement rate limiting (TD-001) | P1 | Low — add express-rate-limit |
| Implement /delete user data (TD-007) | P1 | Medium — bot command + API endpoint |
| Verify ADMIN_KEY in prod (AU-002) | P1 | 5 min — `grep ADMIN_KEY /srv/pfm/.env` |
| Audit console.error for PII (AU-003) | P2 | Medium — read all error logging |
| Revise architecture/ARCHITECTURE.md (AU-009) | P2 | Low — update CORS, auth_date, payday editor |
| Fill contact placeholder in privacy policy (AU-004) | P2 | Trivial |
| Delete duplicate docs/adr/ directory | P3 | Trivial |
| Implement error codes in API (AU-005) | P2 | Medium |
| Add idempotency key for POST /tg/expenses (AU-006) | P2 | Medium |
| Implement notification dedup in DB (TD-009) | P1 | Medium |
| Persist triggerPayday in Period table (GAP-001) | P1 | Medium |
