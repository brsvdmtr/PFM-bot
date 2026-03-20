# Security and Privacy Checklist

Last reviewed: 2026-03-20

Legend: ✅ implemented | ⚠️ partial / needs verification | ❌ not implemented | 📋 TODO

---

## Authentication

| # | Control | Status | Detail |
|---|---------|--------|--------|
| A1 | Telegram initData HMAC-SHA256 validation | ✅ | `validateTelegramInitData()` in `apps/api/src/index.ts`: builds data-check string, uses `crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN)`, compares computed vs received hash. |
| A2 | X-TG-DEV bypass blocked in production | ✅ | Code path: `if (process.env.NODE_ENV !== 'production')` — dev bypass is unreachable when `NODE_ENV=production`. Verify: `docker compose exec api printenv NODE_ENV` → should print `production`. |
| A3 | ADMIN_KEY required for internal routes | ✅ | `internalAuth` middleware on `/internal/*` router: returns 401 if `x-internal-key` header missing or doesn't match `ADMIN_KEY` env var. |
| A4 | ADMIN_KEY is a strong random value | ⚠️ | Verify `/srv/pfm/.env` — ADMIN_KEY must not be empty, default, or short. Recommended: `openssl rand -hex 32`. |
| A5 | initData expiry validation | ❌ | The `auth_date` field in initData is not checked for staleness. A captured initData token is valid indefinitely. **Priority: MEDIUM.** TODO: reject if `Date.now()/1000 - auth_date > 86400` (24h). |

---

## Data Integrity

| # | Control | Status | Detail |
|---|---------|--------|--------|
| D1 | All monetary amounts stored as integer (no float) | ✅ | `Math.round(amount)` applied at every write path in API. Postgres column type is Int. |
| D2 | User data isolated by userId in all DB queries | ✅ | Every Prisma query on user-owned data includes `userId: req.userId!` in the `where` clause. The `userId` comes from the validated Telegram token, not from the request body. |
| D3 | Expense delete checks ownership | ✅ | `findFirst({ where: { id, userId: req.userId! } })` before delete — cannot delete other users' expenses. |
| D4 | Debt / obligation / income ownership enforced | ✅ | Same pattern: ownership verified before patch/delete on all resource types. |
| D5 | Negative amounts rejected | ✅ | `amount <= 0` check on expense and income creation routes. |

---

## Network

| # | Control | Status | Detail |
|---|---------|--------|--------|
| N1 | API only accessible on localhost (127.0.0.1:3002) | ✅ | `ports: "127.0.0.1:3002:3002"` in docker-compose.yml. Not reachable from internet directly. |
| N2 | Web only accessible on localhost (127.0.0.1:3003) | ✅ | `ports: "127.0.0.1:3003:3003"` in docker-compose.yml. |
| N3 | SSL enforced (HTTPS only) | ✅ | Nginx HTTP block does 301 redirect to HTTPS. Let's Encrypt cert on mytodaylimit.ru. |
| N4 | CORS restricted to production origin | ⚠️ | Current code: `app.use(cors())` with no origin filter — allows any origin. **Priority: MEDIUM.** Fix: `cors({ origin: 'https://mytodaylimit.ru' })`. |
| N5 | Rate limiting on API | ❌ | No rate limiting implemented. A malicious actor can spam endpoints. **Priority: HIGH.** TODO: add `express-rate-limit`, e.g., 60 req/min per IP on `/tg/*`. |

---

## Secrets Management

| # | Control | Status | Detail |
|---|---------|--------|--------|
| S1 | BOT_TOKEN stored in .env, not in code | ✅ | `process.env.BOT_TOKEN` — not hardcoded anywhere. |
| S2 | .env file excluded from git | ✅ | `.env` in `.gitignore`. Verify: `git ls-files | grep .env` → should return nothing. |
| S3 | POSTGRES_PASSWORD safe (no special chars) | ✅ | Lesson learned: special chars in password break the DATABASE_URL connection string. Use alphanumeric + underscore. |
| S4 | Secrets not logged | ⚠️ | No explicit logging of secrets found, but `console.error('[PFM API] createInvoiceLink error:', err)` could potentially include token in error object depending on fetch library. Verify with: `docker compose logs api | grep -i token`. |

---

## SQL Injection

| # | Control | Status | Detail |
|---|---------|--------|--------|
| Q1 | ORM used for all queries (no raw SQL) | ✅ | All database access via Prisma ORM. Only exception: `prisma.$queryRaw\`SELECT 1\`` in `/health/deep` — no user input involved, safe. |

---

## Logging and Privacy

| # | Control | Status | Detail |
|---|---------|--------|--------|
| L1 | No PII in logs | ⚠️ | Logs include `user.id` (internal UUID) and Telegram user IDs in cron rollover logs (`[PFM Cron] Rolled over period for user ${user.id}`). These are internal IDs, not names. However, `console.error` blocks may log full objects containing `firstName`. **Audit recommended.** |
| L2 | Expense amounts not logged | ✅ | No logging of individual expense amounts found in codebase. |
| L3 | Telegram chatId not logged | ✅ | Not found in log statements. |

**Audit command:**
```bash
docker compose logs api | grep -i "first_name\|firstName\|telegramId\|chatId" | head -20
```

---

## Telegram Payments

| # | Control | Status | Detail |
|---|---------|--------|--------|
| P1 | Telegram Stars payment validated via successful_payment handler | ✅ | Bot handles `successful_payment` update, calls `/internal/activate-subscription` with `telegramChargeId`. Card data never touches our server — Telegram handles payment. |
| P2 | Subscription activation requires ADMIN_KEY | ✅ | `/internal/activate-subscription` is behind `internalAuth` middleware. |
| P3 | GOD_MODE bypass is explicit, opt-in per user | ✅ | `GOD_MODE_TELEGRAM_IDS` env var — only specific IDs get free PRO. Not exposed to users. |

---

## Open Security Gaps (Prioritized)

| Priority | Gap | Effort | TODO |
|----------|-----|--------|------|
| HIGH | No rate limiting | Low | Add `express-rate-limit`: `npm i express-rate-limit`, apply to `/tg/*` at 60 req/min per IP |
| MEDIUM | CORS allows all origins | Low | Change `cors()` to `cors({ origin: 'https://mytodaylimit.ru' })` |
| MEDIUM | initData auth_date not validated (token replay possible) | Low | Add `auth_date` expiry check: reject if older than 24h |
| LOW | PII audit in error logs | Medium | Review all `console.error` call sites, sanitize user objects before logging |
| LOW | No CSP headers | Medium | Add Content-Security-Policy via nginx or Next.js headers config |
