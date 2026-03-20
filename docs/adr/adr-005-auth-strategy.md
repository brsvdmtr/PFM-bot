---
title: "ADR-005: Authentication via Telegram initData HMAC-SHA256"
document_type: ADR
status: Accepted
last_updated: "2026-03-20"
owner: Dmitriy
---

# ADR-005: Authentication via Telegram initData HMAC-SHA256

**Status**: Accepted
**Date**: 2025-12
**Author**: Dmitriy

## Implementation Updates

### 2026-03-20 — auth_date freshness check ADDED (commit 2679697)

The `auth_date` freshness check previously listed as a gap has been **implemented**.

The API now rejects requests where `Date.now()/1000 - auth_date > 3600` (older than 1 hour):

```ts
const authDate = parseInt(params.get('auth_date') || '0', 10);
if (Date.now() / 1000 - authDate > 3600) return null; // stale
```

This closes the token replay attack window. A captured initData token is now only valid for 1 hour, not indefinitely.

**Note on the 1-hour window:** Telegram's Mini App injects fresh initData on each app launch. The 1-hour window is conservative — a user actively using the app will get fresh initData; the window only matters for API clients that cache initData.

### 2026-03-20 — CORS restricted to production origin (commit 2679697)

CORS is now restricted in production:

```ts
app.use(cors({
  origin: NODE_ENV === 'production'
    ? [MINI_APP_URL.replace('/miniapp', ''), 'https://mytodaylimit.ru']
    : true,
  credentials: false,
}));
```

Previously `app.use(cors())` allowed any origin.

---

## Context

PFM Bot's API (`apps/api`) needs to identify which Telegram user is making each request without requiring a separate registration or login flow. Options considered:

- **Email/password + JWT**: Requires a registration form, password storage (bcrypt), refresh token rotation. Entirely out of scope for a Telegram Mini App where users have no expectation of entering passwords.
- **Session cookies**: Require a session store (Redis or DB), cookie handling, CSRF protection. Adds stateful infrastructure.
- **OAuth2 (e.g., Google)**: Completely disconnected from the Telegram context; adds friction.
- **Telegram initData verification**: Telegram's own mechanism. When the Mini App opens, Telegram injects a signed `initData` string in the WebApp object. The signature can be verified with the bot's token.

Since the app runs exclusively as a Telegram Mini App, the user is always authenticated with Telegram. Using their Telegram identity directly is zero-friction.

## Decision

Every API request to `POST/GET /tg/*` must include the Telegram `initData` string in the `X-TG-Init-Data` header. The API verifies it using HMAC-SHA256 with a derived secret key.

### Verification algorithm (implemented in `apps/api/src/index.ts`)

```ts
function validateTelegramInitData(initData: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  // Sort all fields alphabetically
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  // Derive secret key: HMAC-SHA256('WebAppData', BOT_TOKEN)
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  // Compute expected hash: HMAC-SHA256(secret, dataCheckString)
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  if (computed !== hash) return null;

  // Check auth_date freshness (added 2026-03-20)
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Date.now() / 1000 - authDate > 3600) return null;

  return JSON.parse(params.get('user')!) as TelegramUser;
}
```

The `user` object extracted from `initData` contains `{ id, first_name, last_name?, username?, language_code? }`.

### User provisioning

On first authenticated request, the `ensureUser` middleware creates a DB row in `User`:

```ts
user = await prisma.user.create({
  data: {
    telegramId: String(req.tgUser.id),
    firstName: req.tgUser.first_name,
    godMode: GOD_MODE_IDS.includes(telegramId), // from env
    locale: req.tgUser.language_code === 'en' ? 'en' : 'ru',
    profile: { create: { displayName: req.tgUser.first_name } },
    settings: { create: {} },
  },
});
```

### GOD_MODE

Users whose Telegram ID appears in the `GOD_MODE_TELEGRAM_IDS` environment variable are created with `godMode: true`. This grants PRO access without a subscription (`isPro` check: `user.godMode || subscription.status === 'ACTIVE'`).

**Environment variable:** `GOD_MODE_TELEGRAM_IDS` — comma-separated list of Telegram IDs, e.g. `"123456789,987654321"`. Set in `.env`.

**Known gap:** No audit log is kept for god-mode actions. A god-mode user's API calls are indistinguishable from regular user calls in the logs. If an audit log is needed, a `AdminAuditLog` table would need to be added.

### Development bypass

In `NODE_ENV !== 'production'`, the `X-TG-DEV` header containing a Telegram user ID (as a plain integer string) bypasses initData validation:

```ts
if (process.env.NODE_ENV !== 'production') {
  const devId = req.headers['x-tg-dev'];
  if (devId) {
    req.tgUser = { id: parseInt(devId, 10), first_name: 'Dev' };
    next(); return;
  }
}
```

This header is **only active when `NODE_ENV !== 'production'`**. The production Docker image sets `NODE_ENV=production` via the Dockerfile, so this path is unreachable in production.

Note: `apps/bot/src/index.ts` currently uses `X-TG-DEV` for the `/today` and `/spend` commands in all environments, which means the bot effectively bypasses initData verification when calling the API. This is a known issue — the bot should be updated to use an internal service account or the initData received from Telegram contexts.

### Internal routes

`POST /internal/*` routes use a separate `X-Internal-Key` header checked against the `ADMIN_KEY` environment variable. These routes (e.g., `store-chat-id`, `activate-subscription`) are called only by `apps/bot` and never exposed externally (Nginx only proxies `/tg/*` and static assets externally).

## Consequences

### Positive
- **Zero registration friction**: Users open the app, Telegram sends `initData`, they are immediately identified. No passwords, no email, no verification codes.
- **Stateless API**: No session store needed. Each request carries its own proof of identity.
- **Telegram-side security**: If Telegram is compromised, PFM Bot is too — but this is an acceptable dependency given Telegram is the deployment platform.
- **Automatic user creation**: The `ensureUser` middleware creates a DB record on first visit with sensible defaults (locale from `language_code`, default timezone `Europe/Moscow`).
- **Token replay window limited to 1 hour**: auth_date check (added 2026-03-20) limits replay attack window.

### Negative / Tradeoffs
- **Tied to Telegram**: The API cannot be used by any non-Telegram client without implementing an additional auth mechanism.
- **GOD_MODE has no audit log**: Admin-level access is granted via env var and leaves no trace in the DB.
- **Bot calls API with X-TG-DEV**: `apps/bot` bypasses initData in all environments, meaning bot-initiated API calls are not cryptographically verified.

### Open Questions
- Should GOD_MODE actions be logged to a `AdminAuditLog` table?
- Should the bot use a proper internal service account instead of X-TG-DEV for API calls?

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| JWT with email/password | No email exists in Telegram context; adds friction |
| Session cookies | Requires stateful session store; complicates horizontal scaling |
| OAuth2 (Google/Yandex) | Completely disconnected from Telegram identity |
| Telegram Login Widget (not TMA) | Designed for web pages, not embedded Mini Apps |
