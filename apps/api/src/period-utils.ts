/**
 * period-utils.ts
 * Timezone-aware utilities for period boundary and debt-due-date calculations.
 *
 * All user-facing day/date arithmetic must go through these helpers so that
 * "today" and "days left" match the user's wall-clock experience, not UTC.
 */

import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { addMonths } from 'date-fns';

// Default timezone when none is stored on the user record
export const DEFAULT_TZ = 'Europe/Moscow';

// ── Core helpers ────────────────────────────────────────────────────────────

/**
 * Returns the user's local representation of a UTC date.
 * The returned Date's .getFullYear()/.getMonth()/.getDate() etc.
 * reflect local wall-clock values.
 *
 * This is the standard date-fns-tz "zoned date" pattern.
 */
export function toLocalDate(utcDate: Date, tz: string): Date {
  return toZonedTime(utcDate, tz);
}

/**
 * Convert UTC instant to the user's local wall-clock Date.
 * The returned Date's .getDate()/.getHours() etc. reflect target-TZ values
 * in whatever the process timezone is (date-fns-tz "zoned date" trick).
 * Use only for extracting year/month/day components, NOT for UTC comparisons.
 */
export function startOfLocalDay(utcDate: Date, tz: string): Date {
  // Step 1: get the local date components (year/month/day) in the target TZ
  const zoned = toZonedTime(utcDate, tz);
  // Step 2: build a "local midnight" Date whose local getters equal those components
  const localMidnight = new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), 0, 0, 0, 0);
  // Step 3: fromZonedTime interprets localMidnight's local getters as target-TZ time
  //         and returns the correct UTC instant (process-TZ-independent)
  return fromZonedTime(localMidnight, tz);
}

/**
 * Calendar-day count from today to periodEnd in the user's timezone.
 *
 * Both endpoints are converted to UTC instants for local midnight, then the
 * raw millisecond difference is divided by 24 h (Math.round handles DST ±1h).
 *
 * Returns at least 1 (never zero-divide on s2sDaily).
 *
 * Test case:
 *   now = 2026-03-21 01:39 UTC (= 2026-03-21 04:39 Moscow)
 *   periodEnd stored as 2026-03-31T21:00:00Z (= 2026-04-01 00:00 Moscow)
 *   → todayMidnight Moscow = 2026-03-20T21:00Z
 *   → endMidnight Moscow   = 2026-03-31T21:00Z
 *   → diff = 11 ✓
 */
export function daysLeftInPeriod(periodEndUtc: Date, nowUtc: Date, tz: string): number {
  const endMidnight   = startOfLocalDay(periodEndUtc, tz);
  const todayMidnight = startOfLocalDay(nowUtc, tz);
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.round((endMidnight.getTime() - todayMidnight.getTime()) / msPerDay);
  return Math.max(1, diff);
}

/**
 * Start of the user's current local day, expressed as a correct UTC instant.
 * Use as lower bound for "today's expenses" DB queries.
 */
export function getTodayLocalStart(tz: string): Date {
  return startOfLocalDay(new Date(), tz);
}

/**
 * Start of the user's next local day, expressed as a correct UTC instant.
 * Use as exclusive upper bound for "today's expenses" DB queries.
 */
export function getNextLocalDayStart(tz: string): Date {
  const zoned = toZonedTime(new Date(), tz);
  // Tomorrow midnight in the target timezone (new Date(y, m, d+1) handles month overflow)
  const tomorrowMidnight = new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate() + 1, 0, 0, 0, 0);
  return fromZonedTime(tomorrowMidnight, tz);
}

// ── Debt due-date logic ─────────────────────────────────────────────────────

/**
 * Determine whether a debt's minimum payment is required in a specific pay period.
 *
 * A debt's due occurrence is required in a period if its dueDay falls on a
 * calendar date in [periodStart, periodEnd) when viewed in the user's timezone.
 *
 * Why this matters:
 *   - Two paydays [1, 15] create alternating ~15-day sub-periods.
 *   - A debt with dueDay=20 should only appear in ONE of those sub-periods
 *     (the one containing March 20), not in both.
 *
 * @param debt.dueDay  Day-of-month when the payment is charged (1–31).
 *                     If null/undefined → returns minPayment (conservative fallback
 *                     — debt owner should be prompted to set a dueDay).
 * @param debt.minPayment  Minimum required payment amount.
 * @param period.startDate  Period start (UTC stored, interpreted as local midnight).
 * @param period.endDate    Period end exclusive (UTC stored, interpreted as local midnight).
 * @param tz  IANA timezone string.
 *
 * @returns Amount required this period: minPayment if dueDay is in period, else 0.
 *          Returns minPayment when dueDay is null (no due-date info = conservative).
 */
export function getDebtRequiredAmountForPeriod(
  debt: { dueDay?: number | null; minPayment: number },
  period: { startDate: Date; endDate: Date },
  tz: string,
): number {
  if (debt.dueDay == null) {
    // No due-date: exclude from automatic reservation — user should set dueDay
    return 0;
  }

  const startLocal = startOfLocalDay(period.startDate, tz);
  const endLocal   = startOfLocalDay(period.endDate, tz);

  // Walk through months overlapping [startLocal, endLocal) and check if the
  // dueDay falls within the interval.  A period typically spans 1 calendar month
  // but may span 2 (e.g., a 30-day period starting mid-month).
  //
  // We iterate month by month starting from the month of periodStart.
  // For each month we construct the candidate due date and check if it's in range.

  let required = 0;

  // Start from the first of the month containing periodStart
  const firstMonth = new Date(startLocal.getFullYear(), startLocal.getMonth(), 1);
  // Iterate until we've passed periodEnd
  let cursor = firstMonth;

  for (let i = 0; i < 36; i++) { // cap at 36 months to prevent infinite loop
    const year  = cursor.getFullYear();
    const month = cursor.getMonth(); // 0-indexed

    // Clamp dueDay to the last day of the month (e.g., dueDay=31 in February → 28/29)
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const clampedDay = Math.min(debt.dueDay, lastDayOfMonth);
    // Build the candidate date as a UTC instant representing midnight of that local date in tz
    const candidateLocal = new Date(year, month, clampedDay, 0, 0, 0, 0);
    const candidate = fromZonedTime(candidateLocal, tz);

    // Stop if candidate is past periodEnd (no more relevant months)
    if (candidate >= endLocal) break;

    // Check if candidate is within [startLocal, endLocal)
    if (candidate >= startLocal && candidate < endLocal) {
      required += debt.minPayment;
    }

    // Advance to next month
    cursor = addMonths(cursor, 1);
  }

  return required;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DebtPeriodSummary {
  debtId: string;
  minPayment: number;
  dueDay?: number | null;
  requiredMinForPeriod: number;    // getDebtRequiredAmountForPeriod result
  paidRequiredThisPeriod: number;  // sum of REQUIRED_MIN_PAYMENT events this period
  remainingRequiredThisPeriod: number; // max(0, required - paid)
  status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'NOT_DUE';
}

/**
 * Compute the period payment summary for a set of debts given their payment events.
 */
export function computeDebtPeriodSummaries(
  debts: Array<{ id: string; minPayment: number; dueDay?: number | null }>,
  paidByDebt: Map<string, number>,
  period: { startDate: Date; endDate: Date },
  tz: string,
): DebtPeriodSummary[] {
  return debts.map((d) => {
    const requiredMinForPeriod = getDebtRequiredAmountForPeriod(
      { dueDay: d.dueDay, minPayment: d.minPayment },
      period,
      tz,
    );
    const paidRequiredThisPeriod = paidByDebt.get(d.id) ?? 0;
    const remainingRequiredThisPeriod = Math.max(0, requiredMinForPeriod - paidRequiredThisPeriod);

    let status: DebtPeriodSummary['status'];
    if (requiredMinForPeriod === 0) {
      status = 'NOT_DUE';
    } else if (remainingRequiredThisPeriod === 0) {
      status = 'PAID';
    } else if (paidRequiredThisPeriod > 0) {
      status = 'PARTIAL';
    } else {
      status = 'UNPAID';
    }

    return {
      debtId: d.id,
      minPayment: d.minPayment,
      dueDay: d.dueDay,
      requiredMinForPeriod,
      paidRequiredThisPeriod,
      remainingRequiredThisPeriod,
      status,
    };
  });
}
