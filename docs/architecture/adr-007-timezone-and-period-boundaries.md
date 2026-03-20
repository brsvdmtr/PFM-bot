---
title: "ADR-007: Timezone Handling and Period Boundary Strategy"
document_type: ADR
status: Accepted
source_of_truth: NO
verified_against_code: Yes
last_updated: "2026-03-20"
related_docs:
  - path: ./ARCHITECTURE.md
    relation: "parent document — known limitations section"
---

# ADR-007: Timezone Handling and Period Boundary Strategy

## Status

Accepted

## Context

PFM Bot runs on a single VPS in UTC. Users are predominantly in Russia (UTC+3 to UTC+12), with potential future users in other timezones. Two timezone-sensitive concerns exist:

**1. Notifications**: Morning ("here's your limit") and evening ("how did today go?") messages must fire at the user's local time, not UTC.

**2. Period boundaries**: A period runs from payday to the next payday. "Today's expenses" means expenses since local midnight, not UTC midnight. Period rollover should happen at the user's local midnight.

### Options for notification timing

- **Pre-scheduled UTC times per user**: Store UTC-equivalent of each user's local notification time. Requires updating all stored times when user changes timezone.
- **Cron fires every minute, checks each user's local time**: No pre-computation. Every minute, iterate users and compute their local `HH:MM`, compare to configured times.

### Options for period boundaries

- **UTC midnight**: All periods start/end at UTC midnight. Easy to reason about in DB queries. Off by up to ±12 hours from user's actual midnight.
- **User local midnight**: Accurate, but makes `endDate` a per-user moving target. Period rollover cron must fire at different UTC times per user.
- **Fixed UTC offset per user**: Simpler than full IANA tz, but breaks on DST transitions.

## Decision

### Timezone storage

Each `User` row stores `timezone String @default("Europe/Moscow")` — a full IANA timezone string. No UTC offset is stored. The IANA string handles DST automatically.

### Notification dispatch

The notification cron runs every minute (`* * * * *`). For each eligible user, it computes the current `HH:MM` in their timezone using `Intl.DateTimeFormat`:

```ts
function currentTimeInTZ(tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(/^24:/, '00:');
}
```

If `localTime === user.settings.morningNotifyTime` (string equality, e.g., `"09:00"`) and the user has not been notified today, the morning notification fires.

Deduplication uses an in-memory `Map<string, Set<string>>` keyed by UTC date string:

```ts
const notifLog = new Map<string, Set<string>>(); // "2025-12-01" → Set<"userId:morning">
```

This dedup map is lost on process restart. A restart exactly at notification time could cause a duplicate send.

### Period boundaries

Period `startDate` and `endDate` store **UTC midnight values** (`DateTime` in Prisma, stored as UTC). Example: a period starting March 15 for a Moscow user (UTC+3) is stored as `2025-03-15T00:00:00.000Z` (which is 03:00 AM Moscow time).

Period rollover cron fires at **00:05 UTC** (`5 0 * * *`) and marks periods whose `endDate <= today (UTC midnight)` as `COMPLETED`, then creates new periods.

**Concrete drift per timezone:**

| User timezone | Period rollover (UTC) | User's local time | Drift from local midnight |
|--------------|----------------------|-------------------|--------------------------|
| Moscow (UTC+3) | 00:05 UTC | 03:05 AM Moscow | +3 hours |
| Yekaterinburg (UTC+5) | 00:05 UTC | 05:05 AM Yekaterinburg | +5 hours |
| Vladivostok (UTC+10) | 00:05 UTC | 10:05 AM Vladivostok | +10 hours |

Worst-case (Vladivostok, UTC+10): any expense recorded between midnight and 10:05 AM on payday day lands in the old (ending) period, not the new one.

### DailySnapshot timing

`DailySnapshot` is saved at **23:55 UTC** by the cron job:

| User timezone | Snapshot UTC | User's local time |
|--------------|-------------|------------------|
| Moscow (UTC+3) | 23:55 UTC | 02:55 AM Moscow (next day) |
| Vladivostok (UTC+10) | 23:55 UTC | 09:55 AM Vladivostok |

For Vladivostok users, the snapshot is taken at 09:55 AM local time — a mid-morning snapshot rather than end-of-day. The `overspentDays` metric in last-period reports is unreliable for UTC+7 and higher timezones.

### "Today's expenses" calculation

`GET /tg/dashboard` queries expenses since `new Date().setHours(0, 0, 0, 0)` — UTC midnight, not the user's local midnight. For a Moscow user (UTC+3), "today" in the app starts at 03:00 AM Moscow time. Expenses between midnight and 03:00 AM Moscow time appear as "yesterday."

### Expense `spentAt`

`Expense.spentAt` defaults to `now()` (UTC). There is no user-adjustable timestamp on expense creation — the record captures when the API received the request.

## Consequences

### Positive

- **Notifications respect user timezone**: A Moscow user who sets morning time to "09:00" gets notified at 09:00 Moscow time regardless of UTC offset.
- **IANA strings handle DST**: Users in DST-observing timezones (e.g., `Europe/Berlin`) get correct behavior at transitions.
- **Simple period DB schema**: UTC midnight dates are consistent and easily queried (`endDate <= today`). No per-user UTC offset math at query time.

### Negative / Trade-offs

- **Period boundaries are not at user's midnight**: For Vladivostok users (UTC+10), the period rolls over at 10:05 AM local time, not midnight. Expenses at 10:00 AM on payday day go into the old period (GAP-004).
- **"Today's expenses" uses UTC midnight**: A Moscow user's app-day starts at 03:00 AM Moscow time. Late-night expenses appear as "yesterday."
- **DailySnapshot at 23:55 UTC is wrong for eastern users**: Snapshot is taken mid-morning for UTC+7 and higher. `overspentDays` metric is unreliable.
- **Notification dedup lost on restart**: In-memory `notifLog` is cleared on API process restart. A restart at exactly 09:00 could double-send morning notifications.
- **Every-minute cron iterates all users**: With large user counts, 10 000+ `Intl.DateTimeFormat` computations + DB comparisons per minute.

## Implementation Status

Implemented with known limitations. IANA timezone storage and per-user notification timing are working correctly in production. The UTC-midnight period boundary drift (GAP-004) is a documented architectural limitation with no current fix planned.

The in-memory notification dedup, UTC-midnight "today" boundary, and DailySnapshot timing issues are all documented in ARCHITECTURE.md Section 9 (Known Architecture Limitations).

## Related

- [ARCHITECTURE.md](./ARCHITECTURE.md) — known limitations section (items 1–3)
