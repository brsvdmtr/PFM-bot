---
title: "Security and Privacy Checklist"
document_type: Operational
status: Active
source_of_truth: YES — for security control tracking
last_updated: "2026-03-20"
owner: Dmitriy
---

# Security and Privacy Checklist

Last reviewed: 2026-03-20

Legend: ✅ Confirmed | ⚠️ Partial | ❌ Gap | 🔄 Fixed [date]

---

## Authentication

| # | Control | Status | Owner | Last Verified | Verification Method | Environment | Detail |
|---|---------|--------|-------|---------------|---------------------|-------------|--------|
| A1 | Telegram initData HMAC-SHA256 validation | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: `validateTelegramInitData()` in `apps/api/src/index.ts` | both | Builds data-check string, uses `crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN)`, compares computed vs received hash. |
| A2 | X-TG-DEV bypass blocked in production | ✅ Confirmed | Dmitriy | 2026-03-20 | `docker compose exec api printenv NODE_ENV` → must print `production` | prod | Code path: `if (process.env.NODE_ENV !== 'production')` — dev bypass is unreachable when `NODE_ENV=production`. |
| A3 | ADMIN_KEY required for internal routes | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: `internalAuth` middleware on `/internal/*` router | both | Returns 401 if `x-internal-key` header missing or doesn't match `ADMIN_KEY` env var. |
| A4 | ADMIN_KEY is a strong random value | ⚠️ Partial | Dmitriy | Not verified | `grep ADMIN_KEY /srv/pfm/.env` — must not be empty, default, or short. Recommended: `openssl rand -hex 32` | prod | Must be verified manually in prod. |
| A5 | initData auth_date freshness check | 🔄 Fixed 2026-03-20 | Dmitriy | 2026-03-20 | Code review: check in `validateTelegramInitData()` | both | Fixed in commit 2679697. Rejects if `Date.now()/1000 - auth_date > 3600` (1 hour). Previously: auth_date was not checked — a captured initData token was valid indefinitely. |

---

## Data Integrity

| # | Control | Status | Owner | Last Verified | Verification Method | Environment | Detail |
|---|---------|--------|-------|---------------|---------------------|-------------|--------|
| D1 | All monetary amounts stored as integer (no float) | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: grep `Math.round` in API write paths | both | `Math.round(amount)` applied at every write path. Postgres column type is Int. |
| D2 | User data isolated by userId in all DB queries | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: grep `userId: req.userId` in routes | both | Every Prisma query on user-owned data includes `userId: req.userId!`. The `userId` comes from the validated Telegram token, not from the request body. |
| D3 | Expense delete checks ownership | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: `findFirst({ where: { id, userId } })` | both | Cannot delete other users' expenses. |
| D4 | Debt / obligation / income ownership enforced | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: same pattern as D3 on all resource types | both | Ownership verified before patch/delete. |
| D5 | Negative amounts rejected | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: `amount <= 0` check in expense/income routes | both | `amount <= 0` check on expense and income creation routes. |

---

## Network

| # | Control | Status | Owner | Last Verified | Verification Method | Environment | Detail |
|---|---------|--------|-------|---------------|---------------------|-------------|--------|
| N1 | API only accessible on localhost (127.0.0.1:3002) | ✅ Confirmed | Dmitriy | 2026-03-20 | `grep ports docker-compose.yml` → `127.0.0.1:3002:3002` | prod | Not reachable from internet directly. |
| N2 | Web only accessible on localhost (127.0.0.1:3003) | ✅ Confirmed | Dmitriy | 2026-03-20 | `grep ports docker-compose.yml` → `127.0.0.1:3003:3003` | prod | |
| N3 | SSL enforced (HTTPS only) | ✅ Confirmed | Dmitriy | 2026-03-20 | `curl -I http://mytodaylimit.ru` → 301 redirect | prod | Nginx HTTP block does 301 redirect to HTTPS. Let's Encrypt cert. |
| N4 | CORS restricted to production origin | 🔄 Fixed 2026-03-20 | Dmitriy | 2026-03-20 | Code review: `cors({ origin: [...] })` in `apps/api/src/index.ts` | prod | Fixed in commit 2679697. Previously: `app.use(cors())` with no origin filter — allowed any origin. Now restricts to `MINI_APP_URL` host and `https://mytodaylimit.ru` in production; allows all in dev. |
| N5 | Rate limiting on API | ❌ Gap | Dmitriy | Not verified | N/A — not implemented | prod | No rate limiting implemented. A malicious actor can spam endpoints. **Priority: HIGH.** TODO: add `express-rate-limit`, e.g., 60 req/min per IP on `/tg/*`. |

---

## Secrets Management

| # | Control | Status | Owner | Last Verified | Verification Method | Environment | Detail |
|---|---------|--------|-------|---------------|---------------------|-------------|--------|
| S1 | BOT_TOKEN stored in .env, not in code | ✅ Confirmed | Dmitriy | 2026-03-20 | `grep -r BOT_TOKEN apps/` → only `process.env.BOT_TOKEN` references | both | Not hardcoded anywhere. |
| S2 | .env file excluded from git | ✅ Confirmed | Dmitriy | 2026-03-20 | `git ls-files \| grep .env` → should return nothing | both | `.env` in `.gitignore`. |
| S3 | ADMIN_KEY: change from default in prod | ⚠️ Partial | Dmitriy | Not verified | `grep ADMIN_KEY /srv/pfm/.env` — must not be a default or example value | prod | Must be verified manually. |
| S4 | Secrets not logged | ⚠️ Partial | Dmitriy | Not verified | `docker compose logs api \| grep -i "token\|secret\|password" \| head -20` | prod | No explicit logging of secrets found, but `console.error` blocks could include token in error objects. Audit recommended. |

---

## Configuration Security Notes

### POSTGRES_PASSWORD character restriction

**Status:** KNOWN CONFIGURATION LIMITATION (not a security gap per se)

The current database connection uses a URL-encoded `DATABASE_URL`. Special characters in `POSTGRES_PASSWORD` break URL parsing. **Restriction:** use alphanumeric characters and underscores only.

This is a temporary limitation of the current config approach, not a security requirement. A strong alphanumeric+underscore password is acceptable. The limitation should be resolved by switching to component-based DB config (separate host/user/password params).

**Current constraint:** `POSTGRES_PASSWORD` must match `/^[a-zA-Z0-9_]+$/`

### BOT_TOKEN

- Stored in `.env`, never in code (✅ confirmed)
- Never logged explicitly (⚠️ verify in prod logs)
- Grants full control over the Telegram bot

### ADMIN_KEY

- Stored in `.env`
- Should be changed from any default or example value
- Recommended generation: `openssl rand -hex 32`
- **Status: ⚠️ verify changed in prod**

---

## Auth Matrix

| Route Group | Actor | Auth Method | Prod-Safe | Dev Bypass | Nginx-Proxied | Verified |
|-------------|-------|-------------|-----------|------------|---------------|----------|
| `GET /health`, `GET /health/deep` | Anyone | None | Yes | N/A | Yes | ✅ |
| `GET /tg/onboarding/status` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes | ✅ |
| `POST /tg/onboarding/*` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes | ✅ |
| `GET /tg/dashboard` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes | ✅ |
| `POST /tg/expenses`, `GET /tg/expenses*`, `DELETE /tg/expenses/:id` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes | ✅ |
| `GET /tg/periods/*`, `POST /tg/periods/recalculate` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes | ✅ |
| `/tg/incomes/*`, `/tg/obligations/*`, `/tg/debts/*` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes | ✅ |
| `/tg/me/*`, `/tg/billing/*` | Telegram user | X-TG-INIT-DATA + HMAC | Yes | X-TG-DEV (dev only) | Yes | ✅ |
| `POST /internal/store-chat-id` | Bot service | X-Internal-Key (ADMIN_KEY) | Yes | No | No — internal only | ✅ |
| `POST /internal/activate-subscription` | Bot service | X-Internal-Key (ADMIN_KEY) | Yes | No | No — internal only | ✅ |

---

## SQL Injection

| # | Control | Status | Owner | Last Verified | Verification Method | Environment | Detail |
|---|---------|--------|-------|---------------|---------------------|-------------|--------|
| Q1 | ORM used for all queries (no raw SQL) | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: grep `$queryRaw\|$executeRaw` in apps/ | both | All DB access via Prisma ORM. Only exception: `prisma.$queryRaw\`SELECT 1\`` in `/health/deep` — no user input, safe. |

---

## Logging and Privacy

| # | Control | Status | Owner | Last Verified | Verification Method | Environment | Detail |
|---|---------|--------|-------|---------------|---------------------|-------------|--------|
| L1 | No PII in logs | ⚠️ Partial | Dmitriy | Not verified | `docker compose logs api \| grep -i "first_name\|firstName\|telegramId\|chatId" \| head -20` | prod | Logs include internal UUIDs and Telegram user IDs in cron logs. `console.error` blocks may log full objects with `firstName`. Audit recommended. |
| L2 | Expense amounts not logged | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: grep `console.log.*amount` in route handlers | both | No logging of individual expense amounts found. |
| L3 | Telegram chatId not logged | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: grep `console.log.*chatId` | both | Not found in log statements. |

**Audit command:**
```bash
docker compose logs api | grep -i "first_name\|firstName\|telegramId\|chatId" | head -20
```

---

## Telegram Payments

| # | Control | Status | Owner | Last Verified | Verification Method | Environment | Detail |
|---|---------|--------|-------|---------------|---------------------|-------------|--------|
| P1 | Payment validated via successful_payment handler | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: bot `successful_payment` handler | both | Bot handles `successful_payment` update, calls `/internal/activate-subscription` with `telegramChargeId`. Card data never touches our server. |
| P2 | Subscription activation requires ADMIN_KEY | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: `internalAuth` middleware on `/internal/*` | both | |
| P3 | GOD_MODE bypass is explicit, opt-in per user | ✅ Confirmed | Dmitriy | 2026-03-20 | Code review: `GOD_MODE_TELEGRAM_IDS` env var check at user creation | both | Only specific IDs get free PRO. Not exposed to users. No audit log — known gap. |

---

## Open Security Gaps (Prioritized)

| Priority | Gap | Effort | Status | TODO |
|----------|-----|--------|--------|------|
| HIGH | No rate limiting | Low | ❌ Open | Add `express-rate-limit`: `npm i express-rate-limit`, apply to `/tg/*` at 60 req/min per IP |
| MEDIUM | PII audit in error logs | Medium | ⚠️ Not verified | Review all `console.error` call sites, sanitize user objects before logging |
| MEDIUM | ADMIN_KEY not verified in prod | Low | ⚠️ Not verified | Check `/srv/pfm/.env` — must not be empty or default |
| LOW | No CSP headers | Medium | ❌ Open | Add Content-Security-Policy via nginx or Next.js headers config |
| LOW | GOD_MODE has no audit log | Medium | ❌ Open | Consider logging god-mode user creation to an admin audit table |
| INFO | CORS restricted to production origin | 🔄 Fixed 2026-03-20 | Fixed in commit 2679697 | — |
| INFO | initData auth_date not validated | 🔄 Fixed 2026-03-20 | Fixed in commit 2679697 | — |
