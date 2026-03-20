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

## 2. Real Open Items (Honest Classification)

> **Glossary for this section:**
> - **Product gap** — affects product behavior, logic correctness, or user data. Requires a code or schema change.
> - **Technical debt** — implementation shortcut or missing feature. Same resolution path as product gap.
> - **Audit finding** — verification, compliance, doc drift, or ops review item. Does NOT require code changes — requires grep, manual check, doc update, or environment confirmation.
> - IDs may be shared: e.g. `GAP-001 / TD-011` = same issue tracked in both gap-analysis and technical-debt-register.

### P1 — Product Gaps (Need Code)

| ID | Title | Trust-Critical | Canonical doc |
|----|-------|----------------|---------------|
| TD-001 | No rate limiting on API | No (availability risk) | technical-debt-register |
| TD-007 / GAP-008 | /delete user data not implemented (GDPR) | No (legal risk) | gap-analysis + technical-debt-register |
| TD-005 | Dockerfile uses `prisma db push --accept-data-loss` in production | No (production safety) | technical-debt-register |
| GAP-001 / TD-011 | Trigger payday not persisted — payday changes affect current period retroactively | **Yes** | gap-analysis + technical-debt-register |
| TD-009 / GAP-003 | Notification dedup in-memory only — lost on container restart | No (UX annoyance) | gap-analysis + technical-debt-register |

### P2 — Product Gaps

| ID | Title | Trust-Critical | Canonical doc |
|----|-------|----------------|---------------|
| GAP-004 / TD-003 | Period rollover at 00:05 UTC, not user's local midnight | Partial (non-Moscow TZ) | gap-analysis |
| GAP-007 | EF target change silently lowers daily limit — no UI feedback | No | gap-analysis |
| GAP-012 | `s2sDaily` naming ambiguity (snapshot vs live value) | No | gap-analysis |
| GAP-013 | `emergencyFund.targetAmount` derived from current obligations, not stored | No | gap-analysis |

### Audit Findings (Verification / Docs / Compliance)

These are verification, compliance, doc drift, or ops review items. Resolution may require either a code change or a spec/doc correction depending on the chosen path — they are not pure documentation tasks, but they are not tracked as product gaps because the root issue is an unverified or undocumented state, not a known behavior defect.

| ID | Finding | Action needed | Priority |
|----|---------|---------------|----------|
| AU-002 | ADMIN_KEY not verified in production | `grep ADMIN_KEY /srv/pfm/.env` on server | P1 |
| AU-003 | PII in logs not audited | Read all `console.error` / `console.log` call sites in apps/api | P2 |
| AU-004 | Privacy policy contact placeholder not filled | Add real email/Telegram handle to privacy-policy-draft.md | P2 |
| AU-005 | Error `code` field documented in API spec but not implemented | Implement in code, or remove from spec | P2 |
| AU-006 | No idempotency key for `POST /tg/expenses` | Implement, or document as known gap | P2 |
| AU-009 | ARCHITECTURE.md may have drift (CORS fix, auth_date, payday editor) | Re-verify architecture/ARCHITECTURE.md against current code | P2 |
| AU-010 | ops/production-checklist.md not smoke-tested against live prod | Run through checklist on server | P3 |

### Closed Items

| ID | Finding | Resolution | Closed |
|----|---------|------------|--------|
| AU-001 | `GET /tg/me/profile` fields not verified | Verified: returns User + profile + subscription (index.ts:343-349) | 2026-03-20 |
| AU-007 | Rate limiting not reflected in route docs | Closed — tracked as TD-001 (product gap); not a standalone doc finding | 2026-03-20 |
| AU-008 | TD-005 Dockerfile not verified | Verified: `prisma db push --accept-data-loss` confirmed in Dockerfile | 2026-03-20 |

---

## 3. Summary Counts

| Category | Count |
|----------|-------|
| Total docs in registry | 36 (docs/adr/ deleted 2026-03-20) |
| New this session | README.md |
| Substantially rewritten this session | ~28 files |
| Deleted (structural cleanup) | docs/adr/ — 7 files deleted 2026-03-20 |
| Remaining redirect stub | docs/ARCHITECTURE.md → docs/architecture/ARCHITECTURE.md |
| Open product/tech gaps | 9 open (see docs/index.md § Known Gaps) |
| Open audit findings (AU-*) | 7 open (AU-002, 003, 004, 005, 006, 009, 010) |
| Closed audit findings (AU-*) | 3 closed (AU-001, AU-007, AU-008) |

---

## 4. Complete File List

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
| docs/ARCHITECTURE.md | Operational | Deprecated | No | N/A | **redirect stub** → architecture/ARCHITECTURE.md |
| docs/adr/* | ADR | **Deleted** | N/A | N/A | **deleted 2026-03-20** — were redirect stubs only |
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

## 5. Audit Findings (AU-*)

> **What these are**: verification, compliance, doc drift, and ops review items. Resolution may require a code change or a spec/doc correction depending on chosen path. They are not tracked as product gaps because the root issue is an unverified or undocumented state, not a known behavior defect.
> For product/tech open issues, see `docs/index.md § Known Gaps`.
> For the canonical AU-* list, see **Section 2 § Audit Findings** above.

### Open Audit Findings

See **Section 2 § Audit Findings** above for the current canonical list (AU-002, 003, 004, 005, 006, 009, 010 — 7 open).

This section contains only the closed-item record.

### Closed Audit Findings

| ID | Finding | Resolution | Closed |
|----|---------|------------|--------|
| AU-001 | `GET /tg/me/profile` exact fields not verified | Verified against index.ts:343-349 — returns User + profile + subscription | 2026-03-20 |
| AU-007 | Rate limiting not reflected in route docs | Closed — covered by TD-001 as a product gap; not a standalone documentation finding | 2026-03-20 |
| AU-008 | TD-005 (prisma db push vs migrate deploy) not verified | Verified against Dockerfile — confirmed `db push --accept-data-loss` in production | 2026-03-20 |

---

## 6. Structural Changes

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

## 7. What Improved

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
- docs/adr/*: Deleted 2026-03-20 after ADR consolidation. Canonical location is docs/architecture/adr-*.
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

## 8. What Remains to Be Done

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
