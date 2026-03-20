/**
 * Russian Payroll Calendar
 *
 * Handles payday adjustment for Russian work calendar (5/2, Mon-Fri).
 * When a canonical payday falls on a weekend or public holiday,
 * the actual payment date shifts to the PREVIOUS business day.
 *
 * Coverage: 2025–2027 (extend as needed).
 * Source: Official Russian Government work schedule decrees.
 */

// ── RU Public Holidays ──────────────────────────────────────────────────────
// Format: YYYY-MM-DD. Includes declared non-working days and bridge days.
// Does NOT include standard weekends (handled separately).
const RU_HOLIDAY_DATES = new Set<string>([
  // 2025
  '2025-01-01', '2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08',
  '2025-02-24',
  '2025-03-10',
  '2025-05-01', '2025-05-02',
  '2025-05-08', '2025-05-09',
  '2025-06-12', '2025-06-13',
  '2025-11-03', '2025-11-04',
  '2025-12-31',
  // 2026
  '2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-02-23',
  '2026-03-09',
  '2026-05-01',
  '2026-05-04', '2026-05-11',
  '2026-06-12',
  '2026-11-04',
  // 2027
  '2027-01-01', '2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08',
  '2027-02-22', '2027-02-23',
  '2027-03-08',
  '2027-05-03', '2027-05-10',
  '2027-06-14',
  '2027-11-04', '2027-11-05',
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isWeekend(d: Date): boolean {
  const dow = d.getDay(); // 0=Sun, 6=Sat
  return dow === 0 || dow === 6;
}

export function isRuHoliday(d: Date): boolean {
  return RU_HOLIDAY_DATES.has(dateKey(d));
}

export function isRuNonWorkDay(d: Date): boolean {
  return isWeekend(d) || isRuHoliday(d);
}

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Get actual payout date for a canonical payday day-of-month.
 *
 * If useRuCalendar=true and the canonical date falls on a weekend/holiday,
 * shifts backward to the previous business day.
 *
 * Example: canonical day=15, March 2026 → 15 Mar is Sunday → actual = 13 Mar.
 */
export function getActualPayday(
  year: number,
  month: number,  // 0-indexed (JS convention)
  day: number,
  useRuCalendar: boolean,
): Date {
  // Clamp day to last day of month (handles e.g. day=31 in February)
  const maxDay = new Date(year, month + 1, 0).getDate();
  const clamped = Math.min(day, maxDay);
  const date = new Date(year, month, clamped);

  if (!useRuCalendar) return date;

  const adjusted = new Date(date);
  let safety = 0;
  while (isRuNonWorkDay(adjusted) && safety < 14) {
    adjusted.setDate(adjusted.getDate() - 1);
    safety++;
  }
  return adjusted;
}

/**
 * Get the last actual payday on or before `fromDate`.
 * Searches up to 3 months back.
 *
 * Returns null if no paydays are configured.
 */
export function getLastActualPayday(
  paydays: number[],
  fromDate: Date,
  useRuCalendar: boolean,
): Date | null {
  if (paydays.length === 0) return null;
  const sorted = [...paydays].sort((a, b) => a - b);

  const today = new Date(fromDate);
  today.setHours(0, 0, 0, 0);

  let best: Date | null = null;

  for (let offset = 0; offset <= 3; offset++) {
    const baseDate = new Date(today);
    baseDate.setMonth(baseDate.getMonth() - offset);

    for (const pd of sorted) {
      const actual = getActualPayday(baseDate.getFullYear(), baseDate.getMonth(), pd, useRuCalendar);
      actual.setHours(0, 0, 0, 0);
      if (actual <= today) {
        if (!best || actual > best) best = actual;
      }
    }
    // Once we found something in a past month, stop searching further back
    if (best && offset > 0) break;
  }

  return best;
}

/**
 * Get the next actual payday strictly after `fromDate`.
 * Searches up to 3 months forward.
 *
 * Returns null if no paydays are configured.
 */
export function getNextActualPayday(
  paydays: number[],
  fromDate: Date,
  useRuCalendar: boolean,
): Date | null {
  if (paydays.length === 0) return null;
  const sorted = [...paydays].sort((a, b) => a - b);

  const today = new Date(fromDate);
  today.setHours(0, 0, 0, 0);

  let best: Date | null = null;

  for (let offset = 0; offset <= 3; offset++) {
    const baseDate = new Date(today);
    baseDate.setMonth(baseDate.getMonth() + offset);

    for (const pd of sorted) {
      const actual = getActualPayday(baseDate.getFullYear(), baseDate.getMonth(), pd, useRuCalendar);
      actual.setHours(0, 0, 0, 0);
      // Strictly after today (today's payday already received)
      if (actual > today) {
        if (!best || actual < best) best = actual;
      }
    }
    if (best && offset > 0) break;
  }

  return best;
}

/**
 * Compute the next income amount for the specified next payday.
 * Uses triggerPayday logic to avoid double-counting.
 *
 * @param incomes - active income records
 * @param nextPayday - the next actual payday date
 */
export function getNextIncomeAmount(
  incomes: Array<{ amount: number; paydays: number[] }>,
  nextPayday: Date,
): number {
  const nextDay = nextPayday.getDate();
  const allPaydays = [...new Set(incomes.flatMap((i) => i.paydays))].sort((a, b) => a - b);

  return incomes.reduce((sum, inc) => {
    // Include if income's payday matches the next canonical day,
    // or if nextDay isn't in any known payday (fallback: include all)
    const hasMatch = inc.paydays.includes(nextDay);
    const dayInKnownPaydays = allPaydays.includes(nextDay);
    if (!hasMatch && dayInKnownPaydays) return sum; // different income's payday
    const payCount = Math.max(1, inc.paydays.length);
    return sum + Math.round(inc.amount / payCount);
  }, 0);
}
