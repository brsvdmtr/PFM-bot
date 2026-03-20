---
title: "Documentation Audit Summary"
document_type: Gap/Audit
status: Active
source_of_truth: "YES — for documentation health tracking"
last_updated: "2026-03-20"
owner: Dmitriy
---

# Documentation Audit Summary

---

## 1. Audit Overview

**What was audited:** All documentation files in `/docs/` plus root `ARCHITECTURE.md` and `README.md`.

**When:** 2026-03-20

**Scope:**
- API documentation (api-v1.md, openapi/api-v1.yaml)
- Security documents (security-privacy-checklist.md, privacy-policy-draft.md)
- Architecture Decision Records (ADR-001 through ADR-007)
- System documentation (system-spec-v1.md and new system docs)
- Product documentation (north-star, FAQ, how-we-calculate, tracking-plan, gap-analysis)
- Ops runbooks and checklists
- Delivery templates and debt register
- Index files

**Verification approach:** Documents were checked against:
1. The actual auth implementation (HMAC-SHA256 algorithm, auth_date check, CORS config)
2. The actual route list and response shapes
3. Known code fixes made on 2026-03-20 (commit 2679697)

**What was NOT done in this audit:**
- Running the API against each route to verify response shapes (would require a live environment)
- Verifying production env vars (ADMIN_KEY strength, log content)
- Auditing all `console.error` call sites for PII leakage

---

## 2. Complete Document Registry

| Path | Type | Status | SoT | Code Verified | New/Revised |
|------|------|--------|-----|---------------|-------------|
| docs/index.md | Operational | Active | Partial | Partial | Revised |
| docs/index-audit-summary.md | Gap/Audit | Active | YES | Partial | **NEW** |
| docs/system/system-spec-v1.md | Normative | Active | YES | Partial | Not revised |
| docs/system/formulas-and-calculation-policy.md | Normative | Active | YES | Partial | NEW (prior audit) |
| docs/system/numerical-source-of-truth.md | Normative | Active | YES | Partial | NEW (prior audit) |
| docs/system/income-allocation-semantics.md | Normative | Active | YES | Partial | NEW (prior audit) |
| docs/system/glossary.md | Normative | Active | YES | Partial | NEW (prior audit) |
| docs/product/north-star-product-spec.md | Normative | Active | No | Partial | Not revised |
| docs/product/how-we-calculate-copy.md | UX Copy | Active | No | Partial | Not revised |
| docs/product/faq-mvp.md | UX Copy | Active | No | Partial | Not revised |
| docs/product/tracking-plan.md | Operational | Active — not implemented | No | No | Not revised |
| docs/product/gap-analysis.md | Gap/Audit | Active | No | Partial | Not revised |
| docs/product/dashboard-ui-data-contract.md | Normative | Active | No | Partial | NEW (prior audit) |
| docs/api/api-v1.md | Normative | Active — Partial | YES | Partial | **Revised** |
| docs/api/openapi/api-v1.yaml | Normative | Active — Partial | YES | Partial | **Revised** |
| docs/adr/adr-001-monolith-web-first.md | ADR | Accepted | No | Partial | Not revised |
| docs/adr/adr-002-money-in-minor-units.md | ADR | Accepted | No | Partial | Not revised |
| docs/adr/adr-003-s2s-formula.md | ADR | Accepted | No | Partial | Not revised |
| docs/adr/adr-004-debt-avalanche.md | ADR | Accepted | No | Partial | Not revised |
| docs/adr/adr-005-auth-strategy.md | ADR | Accepted | No | Yes | **Revised** |
| docs/adr/adr-006-idempotent-expense-model.md | ADR | Accepted | No | Partial | Not revised |
| docs/adr/adr-007-timezone-and-period-boundaries.md | ADR | Accepted | No | Yes | **Revised** |
| docs/security/security-privacy-checklist.md | Operational | Active | YES | Partial | **Revised** |
| docs/security/privacy-policy-draft.md | UX Copy | Draft | No | Partial | **Revised** |
| docs/ops/ops-index.md | Operational | Active | Partial | Partial | NEW (prior audit) |
| docs/ops/runbook-deploy.md | Operational | Active | No | Partial | Not revised |
| docs/ops/runbook-rollback.md | Operational | Active | No | Partial | Not revised |
| docs/ops/runbook-cron.md | Operational | Active | No | Partial | Not revised |
| docs/ops/runbook-backup-restore.md | Operational | Active | No | Partial | Not revised |
| docs/ops/production-checklist.md | Operational | Active | No | Partial | Not revised |
| docs/ops/release-rules.md | Operational | Active | No | Partial | Not revised |
| docs/delivery/bug-report-template.md | Template | Active | No | N/A | Not revised |
| docs/delivery/logic-issue-template.md | Template | Active | No | N/A | Not revised |
| docs/delivery/technical-debt-register.md | Gap/Audit | Active | No | Partial | Not revised |
| ARCHITECTURE.md | Normative | Active — drift risk | No | Partial | Not revised |
| README.md | Operational | Active | No | Partial | Not revised |

---

## 3. New Documents Created (This Session)

| Document | Purpose |
|----------|---------|
| docs/index-audit-summary.md | This file — tracks documentation health, audit findings, and open items |

**Documents created in the prior audit session (now registered):**
- docs/system/formulas-and-calculation-policy.md — Canonical formula reference for S2S, carry-over, reserve
- docs/system/numerical-source-of-truth.md — Traces each magic number (10%, 5%, etc.) to its decision
- docs/system/income-allocation-semantics.md — Rules for income split, multi-payday proration, trigger payday
- docs/system/glossary.md — Shared terminology dictionary (S2S, Period, payday, etc.)
- docs/product/dashboard-ui-data-contract.md — Maps each dashboard UI element to its API field
- docs/ops/ops-index.md — Entry point to all ops runbooks

---

## 4. Documents Substantially Revised (This Session)

### docs/api/api-v1.md
Key changes:
- Added metadata header (document_type, status, source_of_truth)
- Added **Section 2: Calculation Caveats** — documents live vs. stored s2sDaily, expense scoping, no idempotency key
- Added **Section 4: Error Codes** — lists target error codes (not yet implemented)
- Added **Section 5: PATCH Semantics** — explicit allowed/forbidden fields for each PATCH endpoint
- Added **Contract Stability Level** to every endpoint (Stable / Provisional / Current Behavior)
- Added **Section 18: Auth Appendix** — table of all route groups with auth method, dev bypass, nginx proxy status
- Moved all inline TODO/VERIFY comments to **Section 19: Open Issues**
- Added note on `weeklyDigest` dead setting in PATCH /tg/me/settings
- Added auth_date freshness note (1-hour window, implemented 2026-03-20)

### docs/api/openapi/api-v1.yaml
Key changes (surgical — no full rewrite):
- Added metadata comment block at top
- Added auth_date freshness note to TelegramInitData security scheme
- Added `x-stability` extension to every operation
- Added `x-calculation-policy` extension to dashboard, recalculate, and onboarding/complete
- Added `x-internal-only: true` to internal routes
- Updated `weeklyDigest` description to note dead setting
- Added no-idempotency warning to POST /tg/expenses
- Added UTC-midnight note to GET /tg/expenses/today
- Added isFocusDebt forbidden note to PATCH /tg/debts/:id
- Added active-period-only scoping note to GET /tg/expenses

### docs/security/security-privacy-checklist.md
Key changes:
- Added metadata header
- Added per-item columns: Owner, Last Verified, Verification Method, Environment, Status
- Marked A5 (initData auth_date) as Fixed 2026-03-20 (was ❌)
- Marked N4 (CORS) as Fixed 2026-03-20 (was ⚠️)
- Added **Auth Matrix** table — all route groups with auth requirements
- Added **Configuration Security Notes** section — POSTGRES_PASSWORD limitation, BOT_TOKEN, ADMIN_KEY
- Reframed POSTGRES_PASSWORD item as "KNOWN CONFIGURATION LIMITATION"
- Updated Open Security Gaps table with current statuses

### docs/security/privacy-policy-draft.md
Key changes:
- Added metadata header
- Filled in contact placeholder: "Через бота: @[BOT_USERNAME]"
- Rewrote `/delete` command section: "функция в разработке, данные удаляются по письменному запросу"
- Added **Section 4: Аналитика** — no analytics currently, future note
- Added **Section 5: Логи сервера** — logs don't contain request bodies, reset on restart
- Added **Section 6: Обработка IP-адреса** — nginx processes IP, not stored
- Removed reference to data export (not implemented)
- Added version number and date at bottom

### docs/adr/adr-005-auth-strategy.md
Key changes:
- Added metadata header
- Added **Implementation Updates** section at top:
  - auth_date freshness check ADDED 2026-03-20
  - CORS restricted 2026-03-20
- Added auth_date check to the code example
- Added GOD_MODE section — what it does, env var name, no audit log gap
- Updated Consequences and Open Questions to reflect current state

### docs/adr/adr-007-timezone-and-period-boundaries.md
Key changes:
- Added metadata header
- Added **auth_date: timezone-agnostic** subsection — Unix timestamp is always UTC-based
- Added **concrete drift examples table** — Moscow, Yekaterinburg, Vladivostok rollover times
- Added **DailySnapshot timing table** — shows local time of snapshot for each timezone
- Made Vladivostok worst-case example explicit (10:05 AM rollover, 09:55 AM snapshot)
- Added note that `overspentDays` is unreliable for UTC+7 and higher timezones

### docs/index.md
Key changes:
- Added metadata header
- Added **Canonical Sources** section — lists the 5 authoritative documents
- Expanded document table with: Doc Type, Source of Truth, Verified vs Code, Drift Risk columns
- Added **Documents with Known Drift Risk** section with explanations
- Added **Needs Code Verification** section — specific unverified claims

---

## 5. Unresolved Items

These items were identified during the audit and require follow-up:

| ID | Document | Item | Priority |
|----|----------|------|----------|
| AU-001 | api/api-v1.md | `GET /tg/me/profile` exact fields not verified against code | Low |
| AU-002 | security/security-privacy-checklist.md | ADMIN_KEY value not verified in prod | Medium |
| AU-003 | security/security-privacy-checklist.md | Log PII audit not completed | Medium |
| AU-004 | security/privacy-policy-draft.md | BOT_USERNAME placeholder not filled in | Low |
| AU-005 | api/api-v1.md | Error `code` field not yet implemented in API | Medium |
| AU-006 | api/api-v1.md | No idempotency key for POST /tg/expenses | Medium |
| AU-007 | All route docs | No rate limiting — open security gap | High |
| AU-008 | delivery/technical-debt-register.md | Not reviewed in this session — may have stale items | Low |
| AU-009 | ARCHITECTURE.md | Not revised — likely has drift from recent changes | Medium |
| AU-010 | ops/production-checklist.md | Not reviewed — may not reflect CORS and auth_date fixes | Low |

---

## 6. Code Verification Needed

Specific API and code behaviors that documents claim but have not been verified by reading/running the code:

| Claim | Document Making Claim | How to Verify |
|-------|----------------------|---------------|
| `GET /tg/me/profile` returns full User + profile + subscription fields | api/api-v1.md | Read the route handler at `apps/api/src/routes/me.ts` or equivalent |
| `GET /tg/expenses` scopes to active period only (not all-time) | api/api-v1.md | Read the listExpenses handler, confirm `periodId: activeperiod.id` in query |
| DailySnapshot cron fires at 23:55 UTC exactly | adr-007 | `grep -r "23:55\|DailySnapshot" apps/api/src/cron.ts` |
| Period rollover cron fires at 00:05 UTC | adr-007 | `grep "5 0" apps/api/src/cron.ts` |
| `GOD_MODE_TELEGRAM_IDS` is the exact env var name | adr-005 | `grep GOD_MODE apps/api/src/index.ts` |
| CORS origin is `MINI_APP_URL.replace('/miniapp', '')` | security checklist | Read `apps/api/src/index.ts` CORS config |
| avalanche extra estimate uses `round(s2sPeriod × 0.10 / (daysTotal / 30))` | api/api-v1.md | Read the avalanche-plan route handler |

---

## 7. Terminology Gaps Found

During the audit, the following terminology inconsistencies were observed:

| Term | Where used inconsistently |
|------|--------------------------|
| "payday" vs "pay day" | Used interchangeably in product docs; glossary defines it as one word |
| "S2S" vs "s2s" | Capitalization inconsistent across docs; API uses lowercase field names |
| "kopecks" vs "minor units" | Both used; "kopecks" is Russia-specific, "minor units" is currency-agnostic. The canonical term is "minor units (kopecks)" |
| "active period" vs "current period" | Used interchangeably in some routes and docs; they mean the same thing |
| "focus debt" | Well-defined in ADR-004 and glossary; occasionally referred to as "priority debt" in product copy |

---

## 8. Highest Priority Actions

After this audit, the top 5 actions to take:

1. **Implement rate limiting** (AU-007 / TD-001) — No rate limiting on any endpoint. This is the highest-priority open security gap. Add `express-rate-limit` to `/tg/*` at ~60 req/min per IP. Effort: Low.

2. **Verify ADMIN_KEY in production** (AU-002) — Confirm `ADMIN_KEY` in `/srv/pfm/.env` is a strong random value, not a default or placeholder. Command: `grep ADMIN_KEY /srv/pfm/.env`. Effort: 5 minutes.

3. **Implement error codes** (AU-005 / OI-005) — The API currently returns `{ error: string }` only. Adding `code` and `requestId` fields would make errors machine-readable and debuggable. This is a targeted API change in the error handler middleware. Effort: Medium.

4. **Add idempotency key for POST /tg/expenses** (AU-006 / OI-002) — Currently retrying a failed expense POST creates a duplicate. Add an optional `idempotencyKey` field that the client generates (UUID), and deduplicate on the server side. Effort: Medium.

5. **Revise ARCHITECTURE.md** (AU-009) — The root `ARCHITECTURE.md` was not reviewed in this audit and likely drifts from current reality (e.g., CORS fix, auth_date fix, payday editor). Should be updated to reflect the current system state. Effort: Low.
