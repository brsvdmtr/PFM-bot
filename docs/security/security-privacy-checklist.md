---
title: "Security and Privacy Checklist"
document_type: Operational
status: Active
source_of_truth: YES — for security control tracking
verified_against_code: Partial
last_updated: "2026-03-20"
---

# Security and Privacy Checklist

Last reviewed: 2026-03-20

Legend: ✅ Verified | ⚠️ Partial | ❌ Not implemented | 🔄 Fixed [date]

---

## Authentication

#### SEC-001: CORS restricted to production domain

| Field | Value |
|-------|-------|
| Category | cors |
| Status | ✅ Verified |
| Last verified | 2026-03-20 |
| Verification method | `grep -n "cors" apps/api/src/index.ts` — checks NODE_ENV=production branch |
| Env | prod |
| Owner | dev |
| Next review | next deploy |

Note: In dev, CORS is open (true). In prod, restricted to `MINI_APP_URL` origin + `https://mytodaylimit.ru`. Fixed in commit 2679697 — previously `app.use(cors())` with no origin filter.

---

#### SEC-002: Telegram initData HMAC-SHA256 validation

| Field | Value |
|-------|-------|
| Category | auth |
| Status | ✅ Verified |
| Last verified | 2026-03-20 |
| Verification method | Read `validateTelegramInitData()` in `apps/api/src/index.ts` |
| Env | both |
| Owner | dev |
| Next review | next deploy |

Note: Uses `HMAC(BOT_TOKEN, "WebAppData")` as secret, then `HMAC(secret, data_check_string)`. Compares computed vs received hash.

---

#### SEC-003: auth_date freshness check (replay attack prevention)

| Field | Value |
|-------|-------|
| Category | auth |
| Status | ✅ Verified |
| Last verified | 2026-03-20 |
| Verification method | Read `validateTelegramInitData()` — `Date.now() / 1000 - authDate > 3600` |
| Env | both |
| Owner | dev |
| Next review | next deploy |

Note: 1 hour TTL. initData older than 1 hour is rejected. Fixed in commit 2679697 — previously auth_date was not checked, captured initData was valid indefinitely.

---

#### SEC-004: ADMIN_KEY for internal routes

| Field | Value |
|-------|-------|
| Category | auth |
| Status | ✅ Implemented, ⚠️ Production value not verified externally |
| Last verified | 2026-03-20 (code) / Not verified (prod value) |
| Verification method | `grep ADMIN_KEY /srv/pfm/.env` on server — must NOT be "change_me_in_production" or empty |
| Env | prod |
| Owner | ops |
| Next review | quarterly |

Note: No rotation policy. Recommended generation: `openssl rand -hex 32`.

---

#### SEC-005: No secrets in logs

| Field | Value |
|-------|-------|
| Category | ops |
| Status | ⚠️ Not verified |
| Last verified | N/A |
| Verification method | `docker compose logs api \| grep -i "token\|key\|password\|secret"` |
| Env | prod |
| Owner | ops |
| Next review | next deploy |

Note: BOT_TOKEN and ADMIN_KEY should never appear in logs. `console.error` blocks may inadvertently log full error objects containing tokens. Audit recommended.

---

#### SEC-006: Rate limiting

| Field | Value |
|-------|-------|
| Category | infra |
| Status | ❌ Not implemented |
| Last verified | N/A |
| Verification method | N/A — not implemented |
| Env | prod |
| Owner | dev |
| Next review | N/A |

Note: No `express-rate-limit` or nginx rate limiting configured. Tracked as TD-001 (P1). Risk: API can be hammered without limit, causing DB overload. Planned fix: `express-rate-limit` middleware on `/tg/*` at ~60 req/min per userId.

---

#### SEC-007: No PII in error responses

| Field | Value |
|-------|-------|
| Category | data |
| Status | ⚠️ Partial — not audited |
| Last verified | N/A |
| Verification method | Review all `res.status(4xx).json(...)` call sites in `apps/api/src/` |
| Env | both |
| Owner | dev |
| Next review | quarterly |

Note: Error responses return `{error: "message"}` strings. No user financial data in errors verified. PII audit of `console.error` blocks not completed.

---

#### SEC-008: Dev bypass disabled in production

| Field | Value |
|-------|-------|
| Category | auth |
| Status | ✅ Verified |
| Last verified | 2026-03-20 |
| Verification method | `x-tg-dev` bypass only activates when `NODE_ENV !== 'production'` — read code path in `apps/api/src/index.ts` |
| Env | prod |
| Owner | dev |
| Next review | next deploy |

Note: NODE_ENV must be "production" on server. Verify: `docker compose exec api printenv NODE_ENV`.

---

#### SEC-009: User data isolation (no cross-user access)

| Field | Value |
|-------|-------|
| Category | data |
| Status | ✅ Verified by design |
| Last verified | 2026-03-20 |
| Verification method | `grep -n "userId: req.userId" apps/api/src/` — all Prisma queries on user-owned data |
| Env | both |
| Owner | dev |
| Next review | next deploy |

Note: All queries filter by `userId: req.userId!`. The `userId` comes from validated Telegram auth, not from request body. Ownership verified before patch/delete on all resource types.

---

#### SEC-010: HTTPS / SSL in production

| Field | Value |
|-------|-------|
| Category | infra |
| Status | ✅ Assumed active (nginx + Let's Encrypt) |
| Last verified | 2026-03-20 |
| Verification method | `curl -I http://mytodaylimit.ru` — should return 301 redirect to HTTPS |
| Env | prod |
| Owner | ops |
| Next review | quarterly |

Note: nginx handles SSL termination. HTTP block does 301 redirect to HTTPS. API and web ports bound to `127.0.0.1` only — not directly accessible from internet.

---

#### SEC-011: User data deletion

| Field | Value |
|-------|-------|
| Category | data |
| Status | ❌ Not implemented |
| Last verified | N/A |
| Verification method | N/A — not implemented |
| Env | prod |
| Owner | dev |
| Next review | N/A |

Note: No `/deletedata` bot command. No API endpoint for user-initiated data deletion. Tracked as TD-007 (P1). Risk: Legal risk — users cannot delete their own data. Workaround: manual deletion by administrator upon request.

---

#### SEC-012: Database not exposed externally

| Field | Value |
|-------|-------|
| Category | infra |
| Status | ✅ Assumed (Docker Compose internal network) |
| Last verified | 2026-03-20 |
| Verification method | `nmap -p 5432 147.45.213.51` from external — should show port closed/filtered |
| Env | prod |
| Owner | ops |
| Next review | quarterly |

Note: DB runs in Docker internal network. Port 5432 not mapped to host in `docker-compose.yml`. Should not be accessible from internet.

---

## Data Integrity

#### SEC-013: All monetary amounts stored as integers (kopecks)

| Field | Value |
|-------|-------|
| Category | data |
| Status | ✅ Verified |
| Last verified | 2026-03-20 |
| Verification method | `grep -n "Math.round" apps/api/src/` — check write paths; PostgreSQL schema column type is Int |
| Env | both |
| Owner | dev |
| Next review | next deploy |

Note: `Math.round(amount)` applied at every write path. No float storage.

---

#### SEC-014: Negative amounts rejected

| Field | Value |
|-------|-------|
| Category | data |
| Status | ✅ Verified |
| Last verified | 2026-03-20 |
| Verification method | `grep -n "amount <= 0" apps/api/src/` — check expense and income creation routes |
| Env | both |
| Owner | dev |
| Next review | next deploy |

---

## Auth Matrix

| Route Group | Actor | Auth Method | Prod-Safe | Dev Bypass | Nginx-Proxied |
|-------------|-------|-------------|-----------|------------|---------------|
| `GET /health`, `GET /health/deep` | Anyone | None | Yes | N/A | Yes |
| `GET /tg/onboarding/status`, `POST /tg/onboarding/*` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes |
| `GET /tg/dashboard` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes |
| `POST /tg/expenses`, `GET /tg/expenses*`, `DELETE /tg/expenses/:id` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes |
| `GET /tg/periods/*`, `POST /tg/periods/recalculate` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes |
| `/tg/incomes/*`, `/tg/obligations/*`, `/tg/debts/*` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes |
| `/tg/me/*`, `/tg/billing/*` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes |
| `POST /internal/store-chat-id` | Bot service | X-Internal-Key (ADMIN_KEY) | Yes | No | No — internal only |
| `POST /internal/activate-subscription` | Bot service | X-Internal-Key (ADMIN_KEY) | Yes | No | No — internal only |

---

## Open Security Gaps (Prioritized)

| Priority | ID | Gap | Effort | Status | Action |
|----------|-----|-----|--------|--------|--------|
| P1 | TD-001 | No rate limiting on API | Low | ❌ Open | Add `express-rate-limit` to `/tg/*` at 60 req/min per IP |
| P1 | TD-007 | No user data deletion (/deletedata) | Medium | ❌ Open | Implement `/delete` bot command + `DELETE /tg/me` API |
| P2 | SEC-005 | Secrets not audited in logs | Medium | ⚠️ Not verified | Review all `console.error` call sites; sanitize before logging |
| P2 | SEC-004 | ADMIN_KEY not verified in prod | Low | ⚠️ Not verified | Check `/srv/pfm/.env` — must not be empty or default |
| P2 | — | No CSP headers | Medium | ❌ Open | Add Content-Security-Policy via nginx or Next.js headers config |
| P3 | TD-006 | GOD_MODE has no audit log | Medium | ❌ Open | Add audit middleware for god-mode requests |
| INFO | — | CORS restricted to production origin | — | ✅ Fixed 2026-03-20 (commit 2679697) | — |
| INFO | — | initData auth_date replay attack | — | ✅ Fixed 2026-03-20 (commit 2679697) | — |

---

## Configuration Security Notes

### POSTGRES_PASSWORD character restriction

**Status:** Known configuration limitation (not a security gap per se)

Special characters in `POSTGRES_PASSWORD` break `DATABASE_URL` parsing. Current constraint: use alphanumeric characters and underscores only (`/^[a-zA-Z0-9_]+$/`). A strong alphanumeric+underscore password is acceptable. Tracked as TD-022.

### BOT_TOKEN

- Stored in `.env`, never in code (confirmed)
- Never logged explicitly (verify in prod logs — SEC-005)
- Grants full control over the Telegram bot

### ADMIN_KEY

- Stored in `.env`
- Should be changed from any default or example value
- Recommended generation: `openssl rand -hex 32`
- No rotation policy (known gap)
- Status: verify changed in prod (SEC-004)
