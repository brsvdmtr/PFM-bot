---
title: "ADR-005: Authentication via Telegram initData HMAC-SHA256"
document_type: ADR
status: Accepted
source_of_truth: NO
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./ARCHITECTURE.md
    relation: "parent document"
  - path: ../security/
    relation: "security documentation"
---

# ADR-005: Authentication via Telegram initData HMAC-SHA256

## Status

Accepted

## Context

PFM Bot's API (`apps/api`) needs to identify which Telegram user is making each request without requiring a separate registration or login flow. Options considered:

- **Email/password + JWT**: Requires a registration form, password storage (bcrypt), refresh token rotation. Entirely out of scope for a Telegram Mini App where users have no expectation of entering passwords.
- **Session cookies**: Require a session store (Redis or DB), cookie handling, CSRF protection. Adds stateful infrastructure.
- **OAuth2 (e.g., Google)**: Completely disconnected from the Telegram context; adds friction.
- **Telegram initData verification**: Telegram's own mechanism. When the Mini App opens, Telegram injects a signed `initData` string into the WebApp object. The signature can be verified with the bot's token.

Since the app runs exclusively as a Telegram Mini App, the user is always authenticated with Telegram. Using their Telegram identity directly is zero-friction.

## Decision

Every API request to `/tg/*` must include the Telegram `initData` string in the `X-TG-Init-Data` header. The API verifies it using HMAC-SHA256 with a derived secret key.

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

  // Freshness check: reject initData older than 1 hour
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
    godMode: GOD_MODE_IDS.includes(telegramId),
    locale: req.tgUser.language_code === 'en' ? 'en' : 'ru',
    profile: { create: { displayName: req.tgUser.first_name } },
    settings: { create: {} },
  },
});
```

### auth_date freshness check

The API rejects requests where `Date.now()/1000 - auth_date > 3600` (older than 1 hour). This limits the token replay attack window. A captured initData token is valid for at most 1 hour.

Telegram's Mini App injects fresh `initData` on each app launch, so active users are never affected. The 1-hour window only matters for API clients that cache `initData`.

### CORS

In production, CORS is restricted to `https://mytodaylimit.ru`. In development, all origins are allowed.

### GOD_MODE

Users whose Telegram ID appears in the `GOD_MODE_TELEGRAM_IDS` environment variable are created with `godMode: true`. This grants PRO access without a subscription. The check is: `user.godMode || subscription.status === 'ACTIVE'`.

No audit log is kept for god-mode actions.

### Development bypass

In `NODE_ENV !== 'production'`, the `X-TG-Dev` header with a Telegram user ID (plain integer string) bypasses `initData` validation. The production Dockerfile sets `NODE_ENV=production`, so this path is unreachable in production.

### Internal routes

`/internal/*` routes use a separate `X-Internal-Key` header checked against the `ADMIN_KEY` environment variable. These routes are called only by `apps/bot` and are never exposed externally (nginx only proxies `/tg/*` and static assets).

**Known issue**: `apps/bot` currently uses `X-TG-Dev` for its internal API calls in all environments, meaning bot-initiated API calls are not cryptographically verified. The bot should be updated to use `X-Internal-Key` or a proper service account.

## Consequences

### Positive

- **Zero registration friction**: Users open the app, Telegram sends `initData`, they are immediately identified. No passwords, no email, no verification codes.
- **Stateless API**: No session store needed. Each request carries its own proof of identity.
- **Telegram-side security**: Acceptable dependency given Telegram is the deployment platform.
- **Automatic user creation**: `ensureUser` creates a DB record on first visit with sensible defaults (locale from `language_code`, default timezone `Europe/Moscow`).
- **Token replay window limited to 1 hour**: `auth_date` freshness check limits the replay attack window.

### Negative / Trade-offs

- **Tied to Telegram**: The API cannot be used by any non-Telegram client without an additional auth mechanism.
- **GOD_MODE has no audit log**: Admin-level access is granted via env var and leaves no trace in the DB.
- **Bot calls API with X-TG-Dev**: `apps/bot` bypasses `initData` in all environments; bot-initiated API calls are not cryptographically verified.

## Implementation Status

Implemented and verified in production. Both the HMAC-SHA256 signature check and the `auth_date` freshness check are active. CORS is restricted to `https://mytodaylimit.ru` in production.

The `X-TG-Dev` / bot internal call issue remains open (see known issue above).

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — authentication section overview
- [ADR-001](./adr-001-monolith-web-first.md) — rationale for Telegram-native deployment
