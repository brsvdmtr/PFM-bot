/**
 * buildActualPayPeriods.ts
 *
 * Computes actual pay-period boundaries using the Russian work calendar.
 * Replaces calculateCanonicalPeriodBounds — uses REAL payout dates, not
 * nominal calendar days.
 *
 * E.g. nominal payday = 15, March 2026 = Sunday
 *   → actual payout = March 13 (Friday)
 *   → period starts March 13, NOT March 15
 */

import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import {
  getActualPayday,
  getLastActualPayday,
  getNextActualPayday,
} from '../../payday-calendar';
import type { ActualPeriodBounds } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a server-local Date (year/month/day from payday-calendar functions)
 * to the correct UTC instant for midnight in the user's timezone.
 *
 * payday-calendar returns dates created with new Date(y, m, d) — server-local.
 * On a UTC server these date-getters return the correct calendar date.
 * fromZonedTime then anchors that calendar date to the user's local midnight.
 */
function toUserLocalMidnightUtc(serverLocalDate: Date, tz: string): Date {
  const y = serverLocalDate.getFullYear();
  const m = serverLocalDate.getMonth();
  const d = serverLocalDate.getDate();
  return fromZonedTime(new Date(y, m, d, 0, 0, 0, 0), tz);
}

/**
 * Given a local date (server-local), find which nominal payday from `paydays`
 * maps to it via getActualPayday (with same useRuCal flag).
 *
 * Checks the same month and ±1 month because an adjusted payday can cross
 * month boundaries (e.g. nominal Mar 1 (Sun) → actual Feb 27).
 */
function findNominalPayday(
  actualDate: Date,
  paydays: number[],
  useRuCal: boolean,
): number {
  const targetY = actualDate.getFullYear();
  const targetM = actualDate.getMonth();
  const targetD = actualDate.getDate();

  for (const offset of [0, 1, -1]) {
    // Safe month arithmetic via Date constructor (handles Jan/Dec overflow)
    const probe = new Date(targetY, targetM + offset, 1);
    const probeY = probe.getFullYear();
    const probeM = probe.getMonth();

    for (const pd of paydays) {
      const candidate = getActualPayday(probeY, probeM, pd, useRuCal);
      if (
        candidate.getFullYear() === targetY &&
        candidate.getMonth()    === targetM &&
        candidate.getDate()     === targetD
      ) {
        return pd;
      }
    }
  }

  throw new Error(
    `findNominalPayday: no nominal payday maps to ` +
    `${actualDate.getFullYear()}-${actualDate.getMonth() + 1}-${actualDate.getDate()} ` +
    `(paydays=${paydays}, useRuCal=${useRuCal})`
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute actual pay-period boundaries for `nowUtc` given a salary schedule.
 *
 * Uses getLastActualPayday / getNextActualPayday from payday-calendar — these
 * already apply the Russian work-calendar shift when useRuCalendar=true.
 *
 * Returns UTC instants for local-midnight boundaries and the nominal paydays
 * that bound the period (used for income matching).
 *
 * Golden case (Dmitriy, 2026-03-21, useRuCal=true, paydays=[1,15]):
 *   start              = 2026-03-12T21:00:00Z  (March 13 00:00 Moscow)
 *   end                = 2026-03-31T21:00:00Z  (April 1  00:00 Moscow)
 *   daysTotal          = 19
 *   startNominalPayday = 15
 *   endNominalPayday   = 1
 */
export function calculateActualPeriodBounds(
  paydays: number[],
  nowUtc: Date,
  tz: string,
  useRuCalendar: boolean,
): ActualPeriodBounds {
  if (paydays.length === 0) {
    // Fallback: today → today+30 (should not happen with valid onboarding)
    const start = fromZonedTime(
      (() => {
        const z = toZonedTime(nowUtc, tz);
        return new Date(z.getFullYear(), z.getMonth(), z.getDate(), 0, 0, 0, 0);
      })(),
      tz,
    );
    const end = fromZonedTime(
      (() => {
        const z = toZonedTime(nowUtc, tz);
        return new Date(z.getFullYear(), z.getMonth(), z.getDate() + 30, 0, 0, 0, 0);
      })(),
      tz,
    );
    return {
      start,
      end,
      daysTotal: 30,
      startNominalPayday: 1,
      endNominalPayday: 1,
      actualPayoutDateIso: start.toISOString(),
    };
  }

  const sorted = [...paydays].sort((a, b) => a - b);

  // 1. Actual period start: last actual payday on or before now
  const actualStart = getLastActualPayday(sorted, nowUtc, useRuCalendar);
  if (!actualStart) {
    throw new Error(`calculateActualPeriodBounds: getLastActualPayday returned null (paydays=${sorted})`);
  }

  // 2. Actual period end: next actual payday strictly after now
  const actualEnd = getNextActualPayday(sorted, nowUtc, useRuCalendar);
  if (!actualEnd) {
    throw new Error(`calculateActualPeriodBounds: getNextActualPayday returned null (paydays=${sorted})`);
  }

  // 3. Convert to correct UTC instants for user's local midnight
  const start = toUserLocalMidnightUtc(actualStart, tz);
  const end   = toUserLocalMidnightUtc(actualEnd, tz);

  // 4. Days total
  const msPerDay = 86_400_000;
  const daysTotal = Math.round((end.getTime() - start.getTime()) / msPerDay);

  // 5. Nominal paydays that map to these actual dates
  const startNominalPayday = findNominalPayday(actualStart, sorted, useRuCalendar);
  const endNominalPayday   = findNominalPayday(actualEnd,   sorted, useRuCalendar);

  // 6. Debug trace: local date string of actual payout
  const startZoned = toZonedTime(start, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  const actualPayoutDateIso =
    `${startZoned.getFullYear()}-${pad(startZoned.getMonth() + 1)}-${pad(startZoned.getDate())}`;

  return { start, end, daysTotal, startNominalPayday, endNominalPayday, actualPayoutDateIso };
}
