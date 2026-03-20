---
title: "ADR-007: Timezone Handling and Period Boundary Strategy"
document_type: ADR
status: Accepted
last_updated: "2026-03-20"
owner: Dmitriy
---

# ADR-007: Timezone Handling and Period Boundary Strategy

**Status**: Accepted
**Date**: 2025-12
**Author**: Dmitriy

## Context

PFM Bot runs on a single VPS in UTC. Users are predominantly in Russia (UTC+3 to UTC+12), with potential future users in UTC±N timezones. Two timezone-sensitive concerns exist:

**1. Notifications**: Morning ("good morning, here's your limit") and evening ("here's how today went") messages must fire at the user's local time, not UTC.

**2. Period boundaries**: A period runs from payday to the next payday. "Today's expenses" means expenses since local midnight, not UTC midnight. Period rollover should happen at the user's local midnight.

### Options for notification timing

- **Pre-scheduled UTC times per user**: Store UTC-equivalent of each user's local notification time. Requires updating all stored times when user changes timezone.
- **Cron fires every minute, checks each user's local time**: No pre-computation. Every minute, iterate users and compute their local `HH:MM`, compare to their configured times.

### Options for period boundaries

- **UTC midnight**: All periods start and end at UTC midnight. Easy to reason about in DB queries. Off by up to ±12 hours from user's actual midnight.
- **User local midnight**: Accurate, but makes `endDate` a per-user moving target. Period rollover cron must fire at different UTC times per user.
- **Fixed UTC offset per user**: Simpler than full IANA tz, but breaks on DST transitions.

## Decision

### Timezone storage

Each `User` row stores `timezone String @default("Europe/Moscow")` — a full IANA timezone string (e.g., `"Europe/Moscow"`, `"Asia/Yekaterinburg"`). No UTC offset is stored; the IANA string is the source of truth and handles DST automatically.

### auth_date: timezone-agnostic

`auth_date` in Telegram's initData is a Unix timestamp (seconds since epoch), which is always UTC-based. The freshness check (`Date.now()/1000 - auth_date > 3600`) is correctly timezone-agnostic — it compares two Unix timestamps regardless of the user's timezone.

### Notification dispatch

The notification cron (`apps/api/src/cron.ts`) runs every minute (`* * * * *`). For each eligible user, it computes the current `HH:MM` in their timezone using `Intl.DateTimeFormat`:

```ts
function currentTimeInTZ(tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(/^24:/, '00:');
}
```

If `localTime === user.settings.morningNotifyTime` (string equality, e.g., `"09:00"`) and the user hasn't been notified today, the morning notification fires.

Deduplication uses an in-memory `Map<string, Set<string>>` keyed by UTC date string:

```ts
const notifLog = new Map<string, Set<string>>(); // "2025-12-01" → Set<"userId:morning">
```

This dedup map is lost on process restart, meaning if the API restarts exactly at 09:00 Moscow time, a user could receive a duplicate notification.

### Period boundaries

Period `startDate` and `endDate` in the `Period` table store **UTC midnight values** (`DateTime` in Prisma, stored as UTC). For example, a period starting March 15 for a Moscow user (UTC+3) is stored as `2025-03-15T00:00:00.000Z` (which is 3:00 AM Moscow time, not midnight Moscow time).

Period rollover cron fires at **00:05 UTC** (`5 0 * * *`) and marks periods whose `endDate <= today (UTC midnight)` as `COMPLETED` and creates new periods.

**Concrete drift examples:**

| User timezone | Period rollover (UTC time) | User's local time at rollover | Drift from user's midnight |
|--------------|---------------------------|-------------------------------|---------------------------|
| Moscow (UTC+3) | 00:05 UTC | 03:05 AM Moscow | +3 hours |
| Yekaterinburg (UTC+5) | 00:05 UTC | 05:05 AM Yekaterinburg | +5 hours |
| Vladivostok (UTC+10) | 00:05 UTC | 10:05 AM Vladivostok | +10 hours |

**Worst-case example (Vladivostok, UTC+10):** A user in Vladivostok with a payday on the 15th will have their period roll over at 10:05 AM local time on the 15th, not at midnight. Any expense recorded between midnight and 10:05 AM on the 15th will be attributed to the old (ending) period, not the new one.

### DailySnapshot timing

`DailySnapshot` is saved at **23:55 UTC** by the cron job. This means:

| User timezone | Snapshot time (UTC) | User's local time at snapshot |
|--------------|---------------------|-------------------------------|
| Moscow (UTC+3) | 23:55 UTC | 02:55 AM Moscow (next day) |
| Vladivostok (UTC+10) | 23:55 UTC | 09:55 AM Vladivostok |

For Moscow users, the snapshot is near end-of-day (02:55 AM is close enough — most users are asleep). For Vladivostok users, the snapshot is taken at 09:55 AM local time — a mid-morning snapshot, not an end-of-day summary. This means `overspentDays` in the last-completed period report may not accurately reflect the Vladivostok user's actual end-of-day spending.

### "Today's expenses" calculation

`GET /tg/dashboard` queries expenses since `new Date().setHours(0, 0, 0, 0)` — UTC midnight, not the user's local midnight. For a Moscow user (UTC+3), "today" in the app starts at 03:00 AM Moscow time, not midnight. Expenses between midnight and 03:00 AM Moscow time are counted as "yesterday."

### Expense `spentAt`

`Expense.spentAt` defaults to `now()` (UTC). There is no user-adjustable timestamp on expense creation — the record captures when the API received the request, not when the user perceives they spent the money.

## Consequences

### Positive
- **Notifications respect user timezone**: A Moscow user who sets morning time to "09:00" gets notified at 09:00 Moscow time regardless of UTC offset.
- **IANA strings handle DST**: Russia abolished DST in 2014, but users in other timezones (e.g., `Europe/Berlin`) get correct behavior at DST transitions.
- **Simple period DB schema**: UTC midnight dates are consistent and easily queried (`endDate <= today`). No per-user UTC offset math at query time.
- **Fallback to Moscow**: If an invalid timezone string is stored, `currentTimeInTZ` falls back to `Europe/Moscow` silently.
- **auth_date check is timezone-agnostic**: Unix timestamps are always UTC-based; the 1-hour freshness check is correct for all users regardless of timezone.

### Negative / Tradeoffs
- **Period boundaries are not at user's midnight**: For a Vladivostok user (UTC+10), the period rolls over at 10:05 AM local time, not at midnight. Expenses recorded at 10:00 AM on payday day go into the old period.
- **"Today's expenses" uses UTC midnight**: A Moscow user's "today" in the app starts at 03:00 AM Moscow time. Late-night expenses (midnight to 03:00 AM) appear as "yesterday."
- **DailySnapshot at 23:55 UTC is wrong for eastern users**: For Vladivostok users, the snapshot is taken at 09:55 AM local time — a snapshot of mid-day spending, not end-of-day. The `overspentDays` metric in last-period reports is unreliable for UTC+7 and higher timezones.
- **Notification dedup lost on restart**: In-memory `notifLog` is cleared on API process restart. A restart at exactly 09:00 could double-send morning notifications.
- **Every-minute cron iterates all users**: As user count grows, the notification cron iterates every onboarded user every minute. With 10 000 users, this is 10 000 `Intl.DateTimeFormat` computations + 10 000 DB time comparisons per minute.

### Open Questions
- Should period `startDate`/`endDate` be stored in user-local midnight (derived from user timezone at creation time)?
- Should "today's expenses" query use the user's local midnight (from stored timezone) rather than UTC midnight?
- Should the notification dedup be moved to a DB table (`NotificationLog`) to survive restarts?
- Should the notification cron use a scheduled worker per user rather than a polling loop?

## Alternatives Considered

| Option | Reason Rejected |
|--------|----------------|
| Store UTC offset (e.g., +3) instead of IANA | Breaks at DST transitions; IANA is more correct |
| Pre-compute notification UTC times | Must update all users when timezone changes; IANA-based runtime check is simpler |
| Period boundaries at user's local midnight | Increases rollover complexity; each user needs a different cron trigger time |
| Redis-backed notification dedup | Adds Redis dependency; in-memory acceptable for single-process MVP |
