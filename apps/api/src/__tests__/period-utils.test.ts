/**
 * Tests for period-utils.ts — timezone-aware period boundary helpers.
 *
 * All test cases use explicit UTC timestamps to avoid ambiguity.
 * Moscow = UTC+3, so local midnight Moscow = 21:00 UTC previous day.
 */
import {
  daysLeftInPeriod,
  getTodayLocalStart,
  getNextLocalDayStart,
  startOfLocalDay,
  toLocalDate,
  getDebtRequiredAmountForPeriod,
  computeDebtPeriodSummaries,
} from '../period-utils';

const MOSCOW = 'Europe/Moscow'; // UTC+3
const NYC    = 'America/New_York'; // UTC-5 (winter)

// ── Helper: build a Date from UTC string ─────────────────────────────────
function utc(s: string): Date { return new Date(s); }

// Moscow midnight on 2026-03-21 = 2026-03-20T21:00:00Z
const MOSCOW_MIDNIGHT_MAR21 = utc('2026-03-20T21:00:00Z');
// Moscow midnight on 2026-04-01 = 2026-03-31T21:00:00Z
const MOSCOW_MIDNIGHT_APR01 = utc('2026-03-31T21:00:00Z');

// ── A. daysLeftInPeriod — canonical test case ────────────────────────────

describe('daysLeftInPeriod', () => {
  test('A. Moscow: 2026-03-21 04:39 local, period ends 2026-04-01 → daysLeft = 11', () => {
    // now = 2026-03-21 01:39 UTC = 04:39 Moscow
    const now = utc('2026-03-21T01:39:00Z');
    // periodEnd stored as UTC for local midnight 2026-04-01 Moscow = 2026-03-31T21:00:00Z
    const periodEnd = MOSCOW_MIDNIGHT_APR01;
    expect(daysLeftInPeriod(periodEnd, now, MOSCOW)).toBe(11);
  });

  test('UTC+3 user at 23:30 UTC (= 02:30+3 next day) — local day is tomorrow already', () => {
    // 2026-03-24T23:30:00Z = 2026-03-25T02:30:00 Moscow → local day is March 25
    const now = utc('2026-03-24T23:30:00Z');
    // period ends March 25 local midnight Moscow = 2026-03-24T21:00:00Z
    const periodEnd = utc('2026-03-24T21:00:00Z');
    // local today = March 25, local periodEnd = March 25 → daysLeft = 0 → clamped to 1
    expect(daysLeftInPeriod(periodEnd, now, MOSCOW)).toBe(1);
  });

  test('NYC (EDT=UTC-4) at 03:00 UTC (= 23:00 prev day local) — still on March 24 local', () => {
    // March 2026: NYC is EDT (UTC-4). 2026-03-25T03:00:00Z = 2026-03-24T23:00 EDT
    const now = utc('2026-03-25T03:00:00Z');
    // period ends March 25 local midnight EDT = 2026-03-25T04:00:00Z
    const periodEnd = utc('2026-03-25T04:00:00Z');
    // local today = March 24, local periodEnd = March 25 → daysLeft = 1
    expect(daysLeftInPeriod(periodEnd, now, NYC)).toBe(1);
  });

  test('NYC (EDT=UTC-4) at 03:00 UTC when period ends March 26 local — daysLeft = 2', () => {
    const now = utc('2026-03-25T03:00:00Z'); // March 24 23:00 EDT local
    // period ends March 26 local midnight EDT = 2026-03-26T04:00:00Z
    const periodEnd = utc('2026-03-26T04:00:00Z');
    // local today March 24, end March 26 → 2 days
    expect(daysLeftInPeriod(periodEnd, now, NYC)).toBe(2);
  });

  test('Same day as period end — daysLeft = 1 (minimum)', () => {
    const now = utc('2026-04-01T01:00:00Z');
    const periodEnd = MOSCOW_MIDNIGHT_APR01; // = 2026-03-31T21:00:00Z
    // local = April 1, periodEnd local = April 1 → daysLeft 0 clamped to 1
    expect(daysLeftInPeriod(periodEnd, now, MOSCOW)).toBe(1);
  });

  test('10 days to period end', () => {
    const now = utc('2026-03-22T01:00:00Z'); // March 22 local Moscow
    const periodEnd = MOSCOW_MIDNIGHT_APR01; // April 1 local Moscow
    // April 1 - March 22 = 10
    expect(daysLeftInPeriod(periodEnd, now, MOSCOW)).toBe(10);
  });
});

// ── B. getTodayLocalStart / getNextLocalDayStart ─────────────────────────

describe('getTodayLocalStart', () => {
  test('returns a Date whose UTC value equals local midnight', () => {
    // We can't control "now" in a unit test, so we verify the returned value
    // is within the last 24h and is a multiple of 24h relative to the TZ offset.
    const result = getTodayLocalStart(MOSCOW);
    const now = new Date();

    // Should be <= now
    expect(result.getTime()).toBeLessThanOrEqual(now.getTime());

    // Should be within the last 24h
    expect(now.getTime() - result.getTime()).toBeLessThan(24 * 60 * 60 * 1000);

    // The getNextLocalDayStart should be exactly 24h later
    const nextDay = getNextLocalDayStart(MOSCOW);
    expect(nextDay.getTime() - result.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('startOfLocalDay', () => {
  test('Moscow UTC+3: start of 2026-03-21 local = 2026-03-20T21:00:00Z', () => {
    const utcDate = utc('2026-03-21T04:39:00Z'); // 07:39 Moscow
    const result = startOfLocalDay(utcDate, MOSCOW);
    // The zoned date object's internal UTC should represent local midnight
    expect(result.getTime()).toBe(MOSCOW_MIDNIGHT_MAR21.getTime());
  });

  test('NYC in March (EDT=UTC-4): start of 2026-03-24 local for 2026-03-24T22:00:00Z', () => {
    // March 24 2026 is after DST (US DST starts 2nd Sunday of March = March 8 2026)
    // so NYC is UTC-4 (EDT), not UTC-5 (EST)
    const utcDate = utc('2026-03-24T22:00:00Z'); // 18:00 EDT, still March 24 local
    const result = startOfLocalDay(utcDate, NYC);
    // local midnight March 24 EDT = 2026-03-24T04:00:00Z (UTC-4)
    expect(result.getTime()).toBe(utc('2026-03-24T04:00:00Z').getTime());
  });
});

// ── C. getDebtRequiredAmountForPeriod ────────────────────────────────────

describe('getDebtRequiredAmountForPeriod', () => {
  const minPayment = 59_230;
  // Period: 2026-03-13 → 2026-04-01 Moscow
  const periodMar13toApr1 = {
    startDate: utc('2026-03-12T21:00:00Z'), // March 13 00:00 Moscow
    endDate:   utc('2026-03-31T21:00:00Z'), // April 1  00:00 Moscow
  };
  // Period: 2026-04-01 → 2026-04-13 Moscow
  const periodApr1toApr13 = {
    startDate: utc('2026-03-31T21:00:00Z'), // April 1  00:00 Moscow
    endDate:   utc('2026-04-12T21:00:00Z'), // April 13 00:00 Moscow
  };

  test('B. dueDay=20 falls in Mar13→Apr1 period', () => {
    const debt = { dueDay: 20, minPayment };
    expect(getDebtRequiredAmountForPeriod(debt, periodMar13toApr1, MOSCOW)).toBe(minPayment);
  });

  test('B. dueDay=20 does NOT fall in Apr1→Apr13 period', () => {
    const debt = { dueDay: 20, minPayment };
    expect(getDebtRequiredAmountForPeriod(debt, periodApr1toApr13, MOSCOW)).toBe(0);
  });

  test('dueDay=1 falls in Apr1→Apr13 period (April 1 is periodStart — inclusive)', () => {
    const debt = { dueDay: 1, minPayment };
    expect(getDebtRequiredAmountForPeriod(debt, periodApr1toApr13, MOSCOW)).toBe(minPayment);
  });

  test('dueDay=13 is at period end — exclusive — does NOT fall in Apr1→Apr13', () => {
    const debt = { dueDay: 13, minPayment };
    expect(getDebtRequiredAmountForPeriod(debt, periodApr1toApr13, MOSCOW)).toBe(0);
  });

  test('dueDay=15 falls in Mar13→Apr1 (March 15 is in range)', () => {
    const debt = { dueDay: 15, minPayment };
    expect(getDebtRequiredAmountForPeriod(debt, periodMar13toApr1, MOSCOW)).toBe(minPayment);
  });

  test('dueDay=12 does NOT fall in Mar13→Apr1 (March 12 < periodStart)', () => {
    const debt = { dueDay: 12, minPayment };
    expect(getDebtRequiredAmountForPeriod(debt, periodMar13toApr1, MOSCOW)).toBe(0);
  });

  test('dueDay=null → returns 0 (debt should be prompted for dueDay)', () => {
    const debt = { dueDay: null, minPayment };
    expect(getDebtRequiredAmountForPeriod(debt, periodMar13toApr1, MOSCOW)).toBe(0);
  });

  test('dueDay=undefined → returns 0', () => {
    const debt = { dueDay: undefined, minPayment };
    expect(getDebtRequiredAmountForPeriod(debt, periodMar13toApr1, MOSCOW)).toBe(0);
  });

  test('Long 2-month period — dueDay=10 appears twice → 2×minPayment', () => {
    // Period Feb 1 → Apr 1
    const longPeriod = {
      startDate: utc('2026-01-31T21:00:00Z'), // Feb 1 Moscow
      endDate:   utc('2026-03-31T21:00:00Z'), // Apr 1 Moscow
    };
    const debt = { dueDay: 10, minPayment };
    // Feb 10 and Mar 10 both fall in [Feb 1, Apr 1)
    expect(getDebtRequiredAmountForPeriod(debt, longPeriod, MOSCOW)).toBe(2 * minPayment);
  });

  test('dueDay=31 in February — clamped to Feb 28, still in period', () => {
    const period = {
      startDate: utc('2026-02-27T21:00:00Z'), // Feb 28 Moscow
      endDate:   utc('2026-03-12T21:00:00Z'), // Mar 13 Moscow
    };
    const debt = { dueDay: 31, minPayment };
    // dueDay=31 clamped to 28 in Feb 2026 → Feb 28 is in [Feb 28, Mar 13)
    expect(getDebtRequiredAmountForPeriod(debt, period, MOSCOW)).toBe(minPayment);
  });
});

// ── C. Paid required payment removes reserve ─────────────────────────────

describe('computeDebtPeriodSummaries', () => {
  const period = {
    startDate: utc('2026-03-12T21:00:00Z'),
    endDate:   utc('2026-03-31T21:00:00Z'),
  };

  const debt = { id: 'd1', minPayment: 59_230, dueDay: 20 };

  test('C. No payment events → remainingRequired = minPayment, status = UNPAID', () => {
    const paidByDebt = new Map<string, number>();
    const summaries = computeDebtPeriodSummaries([debt], paidByDebt, period, MOSCOW);
    expect(summaries[0].requiredMinForPeriod).toBe(59_230);
    expect(summaries[0].paidRequiredThisPeriod).toBe(0);
    expect(summaries[0].remainingRequiredThisPeriod).toBe(59_230);
    expect(summaries[0].status).toBe('UNPAID');
  });

  test('C. Full payment → remainingRequired = 0, status = PAID', () => {
    const paidByDebt = new Map([['d1', 59_230]]);
    const summaries = computeDebtPeriodSummaries([debt], paidByDebt, period, MOSCOW);
    expect(summaries[0].remainingRequiredThisPeriod).toBe(0);
    expect(summaries[0].status).toBe('PAID');
  });

  test('Partial payment → remainingRequired is reduced, status = PARTIAL', () => {
    const paidByDebt = new Map([['d1', 30_000]]);
    const summaries = computeDebtPeriodSummaries([debt], paidByDebt, period, MOSCOW);
    expect(summaries[0].remainingRequiredThisPeriod).toBe(29_230);
    expect(summaries[0].status).toBe('PARTIAL');
  });

  test('Overpayment → remainingRequired clamped to 0', () => {
    const paidByDebt = new Map([['d1', 100_000]]);
    const summaries = computeDebtPeriodSummaries([debt], paidByDebt, period, MOSCOW);
    expect(summaries[0].remainingRequiredThisPeriod).toBe(0);
    expect(summaries[0].status).toBe('PAID');
  });

  test('D. Extra principal payment does NOT affect required reservation (paidByDebt is REQUIRED only)', () => {
    // paidByDebt only contains REQUIRED_MIN_PAYMENT amounts
    // extra payments are not included → remaining stays at full
    const paidByDebt = new Map<string, number>(); // no required payments
    const summaries = computeDebtPeriodSummaries([debt], paidByDebt, period, MOSCOW);
    expect(summaries[0].remainingRequiredThisPeriod).toBe(59_230);
  });

  test('Debt not due this period (dueDay=12, period starts Mar 13) → status = NOT_DUE', () => {
    const debtNotDue = { id: 'd2', minPayment: 22_810, dueDay: 12 };
    const paidByDebt = new Map<string, number>();
    const summaries = computeDebtPeriodSummaries([debtNotDue], paidByDebt, period, MOSCOW);
    expect(summaries[0].requiredMinForPeriod).toBe(0);
    expect(summaries[0].status).toBe('NOT_DUE');
  });

  test('Debt with dueDay=null → NOT_DUE (no due date set)', () => {
    const debtNoDueDay = { id: 'd3', minPayment: 15_000, dueDay: null };
    const paidByDebt = new Map<string, number>();
    const summaries = computeDebtPeriodSummaries([debtNoDueDay], paidByDebt, period, MOSCOW);
    expect(summaries[0].requiredMinForPeriod).toBe(0);
    expect(summaries[0].status).toBe('NOT_DUE');
  });

  test('E. totalDebtPaymentsRemaining decreases after payment', () => {
    const debts = [
      { id: 'd1', minPayment: 59_230, dueDay: 20 },
      { id: 'd2', minPayment: 22_810, dueDay: 25 },
    ];
    // Before payment
    const noPay = computeDebtPeriodSummaries(debts, new Map(), period, MOSCOW);
    const totalBefore = noPay.reduce((s, d) => s + d.remainingRequiredThisPeriod, 0);
    expect(totalBefore).toBe(59_230 + 22_810); // 82_040

    // After d1 fully paid
    const withPay = computeDebtPeriodSummaries(debts, new Map([['d1', 59_230]]), period, MOSCOW);
    const totalAfter = withPay.reduce((s, d) => s + d.remainingRequiredThisPeriod, 0);
    expect(totalAfter).toBe(22_810);
    expect(totalAfter).toBeLessThan(totalBefore);
  });
});

// ── toLocalDate ──────────────────────────────────────────────────────────

describe('toLocalDate', () => {
  test('Moscow +3: UTC midnight → local 03:00', () => {
    const utcMidnight = utc('2026-03-21T00:00:00Z');
    const local = toLocalDate(utcMidnight, MOSCOW);
    // In Moscow, UTC 00:00 is 03:00 local
    expect(local.getHours()).toBe(3);
    expect(local.getDate()).toBe(21);
  });

  test('Moscow +3: UTC 21:00 → local 00:00 next day', () => {
    const utcEvening = utc('2026-03-20T21:00:00Z');
    const local = toLocalDate(utcEvening, MOSCOW);
    expect(local.getHours()).toBe(0);
    expect(local.getDate()).toBe(21);
    expect(local.getMonth()).toBe(2); // March (0-indexed)
  });
});
