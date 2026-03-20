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

> **Two types of unresolved items exist in this document. They are different:**
>
> - **Audit Findings (AU-*)** — documentation-level gaps: unverified claims, missing placeholders, drift between docs and code, docs not yet code-verified. These do not require code changes — they require verification, doc updates, or confirmation.
> - **Product / Tech Gaps** — real open issues in the product, code, or infrastructure. These require code changes. See `docs/index.md § Known Gaps` and `docs/product/gap-analysis.md` for the canonical list.
>
> Do not conflate AU-* findings with product gaps. They have different owners and resolution paths.

**Scope — what was rebuilt**:
- All 28+ documentation files rewritten or written fresh (see Section 3)
- Root README.md created (did not previously exist)
- ADRs consolidated from `docs/adr/` → `docs/architecture/`
- `docs/adr/` has been deleted (2026-03-20) — contained only redirect stubs

**Verification approach**: Documents checked against:
1. Actual auth implementation (HMAC-SHA256 algorithm, auth_date check, CORS config)
2. Known code fixes on 2026-03-20 (commit 2679697: CORS restriction, auth_date TTL)
3. Technical debt register for open gaps
4. Direct code inspection of: cron.ts schedules, index.ts route handlers, Dockerfile entrypoint

### What this session did NOT re-audit

The following document groups were **rewritten for structure and content** but were **not individually re-verified against running code**. Claims in these files are based on code review at the time of writing, not live API testing:

- `docs/product/*` — feature status, UI copy, FAQ answers
- `docs/system/*` — formula steps, invariant list, income semantics
- `docs/api/*` — route descriptions, response shapes (partial verification only)
- `docs/ops/*` — runbook commands, cron schedules (cron times verified; full procedure not smoke-tested)
- `docs/architecture/*` — ARCHITECTURE.md has known drift risk (see AU-009)

**No document in this corpus should be treated as fully verified against a live running environment.**
All `Verified` claims in individual documents refer to code-level verification (reading source files), not live API testing.

---

## 2. Summary Counts

| Category | Count |
|----------|-------|
| Total docs in registry | 36 (docs/adr/ deleted; redirect stubs removed) |
| New this session | README.md |
| Substantially rewritten this session | ~28 files |
| Deleted (structural cleanup) | docs/adr/ — 7 redirect stubs deleted 2026-03-20 |
| Remaining redirect stub | docs/ARCHITECTURE.md → docs/architecture/ARCHITECTURE.md |
| Open product/tech gaps | 9 open (see docs/index.md § Known Gaps) |
| Open audit findings (AU-*) | 8 open, 2 closed |

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

## 4. Audit Findings (AU-*)

> **What these are**: documentation-level gaps — unverified claims, placeholders, drift between docs and code.
> These are NOT product gaps. They do not require code changes.
> For product/tech open issues, see `docs/index.md § Known Gaps`.

### Open Audit Findings

| ID | Document | Finding | Priority | Status |
|----|----------|---------|----------|--------|
| AU-002 | security/security-privacy-checklist.md | ADMIN_KEY value not verified in prod — requires `grep ADMIN_KEY /srv/pfm/.env` | Medium | open |
| AU-003 | security/security-privacy-checklist.md | Log PII audit not completed — requires reading all `console.error` call sites | Medium | open |
| AU-004 | security/privacy-policy-draft.md | Contact placeholder (email/Telegram handle) not filled in | Low | open |
| AU-005 | api/api-v1.md | Error `code` field documented in spec but not yet implemented in API code | Medium | open |
| AU-006 | api/api-v1.md | No idempotency key for `POST /tg/expenses` — documented as missing, no fix yet | Medium | open |
| AU-007 | all route docs | Rate limiting (TD-001) is a product gap AND affects doc accuracy — routes documented without rate limit | High | open (product fix needed) |
| AU-009 | architecture/ARCHITECTURE.md | Drift risk — written 2026-03-20 but not verified for CORS fix, auth_date fix, and payday editor additions | Medium | open |
| AU-010 | ops/production-checklist.md | Not smoke-tested against live production config | Low | open |

### Closed Audit Findings

| ID | Finding | Resolution | Closed |
|----|---------|------------|--------|
| AU-001 | `GET /tg/me/profile` exact fields not verified | Verified against index.ts:343-349 — returns User + profile + subscription | 2026-03-20 |
| AU-008 | TD-005 (prisma db push vs migrate deploy) not verified | Verified against Dockerfile — confirmed `db push --accept-data-loss` in production | 2026-03-20 |

---

## 5. Structural Changes

### ADR directory consolidation — COMPLETED

**Before**: ADRs lived in two locations:
- `docs/adr/` (original location, 7 files)
- `docs/architecture/` (canonical location, created as part of architecture docs rebuild)

**Action taken**: `docs/adr/` **deleted** (2026-03-20). No content was lost — the directory contained only redirect stubs pointing to `docs/architecture/`. Canonical ADR files are and remain in `docs/architecture/`.

**Canonical location**: `docs/architecture/adr-001` through `adr-007`. This is the only location. There is no duplicate.

### ARCHITECTURE.md location

**Before**: `docs/ARCHITECTURE.md`
**After**: `docs/architecture/ARCHITECTURE.md`

`docs/ARCHITECTURE.md` remains as a one-liner redirect stub. The canonical document is `docs/architecture/ARCHITECTURE.md`. No ambiguity — when editing architecture, update `docs/architecture/ARCHITECTURE.md`.

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

**Product / tech gaps (require code changes):**

| Item | ID | Priority | Effort |
|------|----|----------|--------|
| Implement rate limiting | TD-001 | P1 | Low — add express-rate-limit |
| Implement /delete user data | TD-007 / GAP-008 | P1 | Medium — bot command + API endpoint |
| Fix Dockerfile: prisma migrate deploy | TD-005 | P1 | Trivial — confirmed open bug |
| Persist triggerPayday in Period table | GAP-001 | P1 | Medium — schema migration |
| Implement notification dedup in DB | TD-009 / GAP-003 | P1 | Medium — NotificationLog table |
| Fix period rollover for non-UTC users | GAP-004 / TD-003 | P2 | Large — per-user timezone scheduling |
| Add before/after UI on EF target change | GAP-007 | P2 | Small — UI only |

**Audit findings (require verification/doc updates, not code changes):**

| Item | ID | Priority | Effort |
|------|----|----------|--------|
| Verify ADMIN_KEY non-default in prod | AU-002 | P1 | 5 min — `grep ADMIN_KEY /srv/pfm/.env` |
| Audit console.error for PII leakage | AU-003 | P2 | Medium — read all error logging |
| Revise architecture/ARCHITECTURE.md for drift | AU-009 | P2 | Low — update CORS, auth_date, payday editor |
| Fill contact placeholder in privacy policy | AU-004 | P2 | Trivial |
| Implement error codes in API (or remove from spec) | AU-005 | P2 | Medium |
| Add idempotency key for POST /tg/expenses | AU-006 | P2 | Medium |
