/**
 * Tests for calculateCanonicalPeriodBounds and dayNumberInPeriod.
 *
 * Canonical rule: period start = local midnight of previous payday in user's TZ.
 * Never anchors to "today" — always uses salary schedule boundaries.
 *
 * All UTC timestamps are explicit. Moscow = UTC+3.
 */
import { calculateCanonicalPeriodBounds, dayNumberInPeriod, daysLeftInPeriod } from '../period-utils';

const MOSCOW = 'Europe/Moscow'; // UTC+3

function utc(s: string): Date { return new Date(s); }

// ── A. Core scenario: paydays=[1,13], Moscow, March 21 ─────────────────────

describe('calculateCanonicalPeriodBounds — paydays=[1,13], Moscow', () => {
  // now = 2026-03-20T23:45:00Z = March 21 02:45 Moscow
  const nowUtc = utc('2026-03-20T23:45:00Z');

  test('A. start = March 13 00:00 Moscow = 2026-03-12T21:00:00Z', () => {
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(bounds.start.toISOString()).toBe('2026-03-12T21:00:00.000Z');
  });

  test('A. end = April 1 00:00 Moscow = 2026-03-31T21:00:00Z', () => {
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(bounds.end.toISOString()).toBe('2026-03-31T21:00:00.000Z');
  });

  test('A. daysTotal = 19', () => {
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(bounds.daysTotal).toBe(19);
  });

  test('A. isProratedStart = false (always canonical)', () => {
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(bounds.isProratedStart).toBe(false);
  });
});

// ── B. Day number and daysLeft ─────────────────────────────────────────────

describe('dayNumberInPeriod and daysLeftInPeriod — Day 9 of 19, 11 days left', () => {
  const nowUtc = utc('2026-03-20T23:45:00Z'); // March 21 02:45 Moscow
  const periodStart = utc('2026-03-12T21:00:00Z'); // March 13 00:00 Moscow
  const periodEnd   = utc('2026-03-31T21:00:00Z'); // April 1  00:00 Moscow

  test('B. dayNumber = 9', () => {
    expect(dayNumberInPeriod(periodStart, nowUtc, MOSCOW)).toBe(9);
  });

  test('B. daysLeft = 11', () => {
    expect(daysLeftInPeriod(periodEnd, nowUtc, MOSCOW)).toBe(11);
  });

  test('B. totalDays = 19', () => {
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(bounds.daysTotal).toBe(19);
  });

  test('Day 1: on period start day itself', () => {
    // now = March 13 04:00 Moscow = 2026-03-13T01:00:00Z
    const onStartDay = utc('2026-03-13T01:00:00Z');
    expect(dayNumberInPeriod(periodStart, onStartDay, MOSCOW)).toBe(1);
  });

  test('Day 19: on last day of period (March 31 Moscow)', () => {
    // The period is Mar 13 → Apr 1 (exclusive). Last day = March 31.
    // March 31 02:00 Moscow = 2026-03-30T23:00:00Z
    const lastDay = utc('2026-03-30T23:00:00Z');
    expect(dayNumberInPeriod(periodStart, lastDay, MOSCOW)).toBe(19);
  });
});

// ── C. Self-heal scenario ──────────────────────────────────────────────────

describe('calculateCanonicalPeriodBounds — self-heal: broken stored period Mar 20 → Apr 1', () => {
  // The broken stored period had start = Mar 20 (onboarding date)
  // Canonical period should be Mar 13 → Apr 1
  const brokenStoredStart = utc('2026-03-19T21:00:00Z'); // March 20 00:00 Moscow
  const nowUtc = utc('2026-03-20T23:45:00Z'); // March 21

  test('C. canonical start differs from broken stored start by > 60s', () => {
    const canonical = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    const diffMs = Math.abs(canonical.start.getTime() - brokenStoredStart.getTime());
    expect(diffMs).toBeGreaterThan(60_000);
  });

  test('C. after heal, start is March 13 Moscow', () => {
    const canonical = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(canonical.start.toISOString()).toBe('2026-03-12T21:00:00.000Z');
  });
});

// ── D. Single payday ──────────────────────────────────────────────────────

describe('calculateCanonicalPeriodBounds — single payday', () => {
  test('D. payday=15, day=20 Moscow → Mar 15 → Apr 15', () => {
    const nowUtc = utc('2026-03-20T01:00:00Z'); // March 20 04:00 Moscow
    const bounds = calculateCanonicalPeriodBounds([15], nowUtc, MOSCOW);
    // start = March 15 00:00 Moscow = 2026-03-14T21:00:00Z
    expect(bounds.start.toISOString()).toBe('2026-03-14T21:00:00.000Z');
    // end = April 15 00:00 Moscow = 2026-04-14T21:00:00Z
    expect(bounds.end.toISOString()).toBe('2026-04-14T21:00:00.000Z');
    expect(bounds.daysTotal).toBe(31);
  });

  test('D. payday=15, day=10 Moscow → Feb 15 → Mar 15', () => {
    // now = March 10 (before payday 15): previous period was Feb 15 → Mar 15
    const nowUtc = utc('2026-03-10T01:00:00Z'); // March 10 04:00 Moscow
    const bounds = calculateCanonicalPeriodBounds([15], nowUtc, MOSCOW);
    // start = Feb 15 00:00 Moscow = 2026-02-14T21:00:00Z
    expect(bounds.start.toISOString()).toBe('2026-02-14T21:00:00.000Z');
    // end = Mar 15 00:00 Moscow = 2026-03-14T21:00:00Z
    expect(bounds.end.toISOString()).toBe('2026-03-14T21:00:00.000Z');
  });

  test('D. payday=15, day=15 Moscow exactly → Mar 15 → Apr 15', () => {
    // On payday itself: today >= payday, so current period just started
    const nowUtc = utc('2026-03-15T01:00:00Z'); // March 15 04:00 Moscow
    const bounds = calculateCanonicalPeriodBounds([15], nowUtc, MOSCOW);
    expect(bounds.start.toISOString()).toBe('2026-03-14T21:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-04-14T21:00:00.000Z');
  });
});

// ── E. Two paydays edge cases ─────────────────────────────────────────────

describe('calculateCanonicalPeriodBounds — two paydays, edge cases', () => {
  test('E. paydays=[1,13], day=1 Moscow → Mar 1 → Mar 13', () => {
    const nowUtc = utc('2026-03-01T01:00:00Z'); // March 1 04:00 Moscow
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    // start = March 1 00:00 Moscow = 2026-02-28T21:00:00Z
    expect(bounds.start.toISOString()).toBe('2026-02-28T21:00:00.000Z');
    // end = March 13 00:00 Moscow = 2026-03-12T21:00:00Z
    expect(bounds.end.toISOString()).toBe('2026-03-12T21:00:00.000Z');
    expect(bounds.daysTotal).toBe(12);
  });

  test('E. paydays=[1,13], day=5 Moscow → Mar 1 → Mar 13', () => {
    const nowUtc = utc('2026-03-05T01:00:00Z'); // March 5 04:00 Moscow
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(bounds.start.toISOString()).toBe('2026-02-28T21:00:00.000Z'); // March 1 Moscow
    expect(bounds.end.toISOString()).toBe('2026-03-12T21:00:00.000Z');   // March 13 Moscow
  });

  test('E. paydays=[1,13], day=13 Moscow → Mar 13 → Apr 1', () => {
    const nowUtc = utc('2026-03-13T01:00:00Z'); // March 13 04:00 Moscow
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(bounds.start.toISOString()).toBe('2026-03-12T21:00:00.000Z'); // March 13 Moscow
    expect(bounds.end.toISOString()).toBe('2026-03-31T21:00:00.000Z');   // April 1 Moscow
    expect(bounds.daysTotal).toBe(19);
  });

  test('E. paydays=[1,13], day=31 Moscow → Mar 13 → Apr 1', () => {
    const nowUtc = utc('2026-03-31T01:00:00Z'); // March 31 04:00 Moscow
    const bounds = calculateCanonicalPeriodBounds([1, 13], nowUtc, MOSCOW);
    expect(bounds.start.toISOString()).toBe('2026-03-12T21:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-03-31T21:00:00.000Z');
  });

  test('E. year boundary: paydays=[25], day=28 December → Dec 25 → Jan 25', () => {
    const nowUtc = utc('2025-12-28T01:00:00Z'); // Dec 28 04:00 Moscow
    const bounds = calculateCanonicalPeriodBounds([25], nowUtc, MOSCOW);
    // start = Dec 25 00:00 Moscow = 2025-12-24T21:00:00Z
    expect(bounds.start.toISOString()).toBe('2025-12-24T21:00:00.000Z');
    // end = Jan 25 00:00 Moscow = 2026-01-24T21:00:00Z
    expect(bounds.end.toISOString()).toBe('2026-01-24T21:00:00.000Z');
  });
});
