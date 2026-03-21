/**
 * matchEventsToPeriod.ts
 *
 * Determines whether a timestamped event (expense or payment) belongs to
 * a pay period by its EFFECTIVE LOCAL DATE in the user's timezone.
 *
 * Rule: an event belongs to period [start, end) if
 *   toZonedTime(event.timestamp, tz) falls on a date d where
 *   start_local_date <= d < end_local_date
 *
 * This is timezone-aware and process-TZ-independent.
 */

import { toZonedTime } from 'date-fns-tz';

/**
 * Returns true if `eventUtc` falls within the period [periodStart, periodEnd)
 * when viewed in the user's local timezone.
 *
 * Both period boundaries are expected to be UTC instants representing local midnight.
 */
export function effectiveLocalDateInPeriod(
  eventUtc: Date,
  periodStart: Date,
  periodEnd: Date,
  tz: string,
): boolean {
  // Convert all three to local wall-clock date components in the user's TZ
  const ev    = toZonedTime(eventUtc,   tz);
  const start = toZonedTime(periodStart, tz);
  const end   = toZonedTime(periodEnd,   tz);

  // Compare as local calendar days (YYYY-MM-DD)
  const evDay    = localDay(ev);
  const startDay = localDay(start);
  const endDay   = localDay(end);

  return evDay >= startDay && evDay < endDay;
}

/** Comparable local day string: "YYYY-MM-DD" */
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
