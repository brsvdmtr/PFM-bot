import {
  getActualPayday,
  getNextActualPayday,
  getLastActualPayday,
  getNextIncomeAmount,
} from '../payday-calendar';

// ── Helpers ──────────────────────────────────────────────────────────────────

function d(year: number, month: number, day: number): Date {
  // month is 0-indexed (JS convention)
  return new Date(year, month, day, 0, 0, 0, 0);
}

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── getActualPayday ───────────────────────────────────────────────────────────

describe('getActualPayday — no calendar (useRuCalendar=false)', () => {
  it('returns the exact date when day is a weekday', () => {
    // April 15, 2026 is Wednesday
    const result = getActualPayday(2026, 3, 15, false);
    expect(isoDate(result)).toBe('2026-04-15');
  });

  it('returns the exact date even when it falls on a weekend', () => {
    // March 15, 2026 is Sunday — without calendar, returns as-is
    const result = getActualPayday(2026, 2, 15, false);
    expect(isoDate(result)).toBe('2026-03-15');
  });

  it('returns the exact date for any month/year combination', () => {
    const result = getActualPayday(2025, 5, 10, false); // June 10, 2025
    expect(isoDate(result)).toBe('2025-06-10');
  });

  it('clamps day to last day of month (e.g. day=31 in February)', () => {
    // Feb 2026 has 28 days, so day=31 clamps to 28
    const result = getActualPayday(2026, 1, 31, false);
    expect(isoDate(result)).toBe('2026-02-28');
  });
});

describe('getActualPayday — with RU calendar (useRuCalendar=true)', () => {
  it('KEY: day=15, month=2 (March), year=2026 — Sunday → shifts to Friday March 13', () => {
    // March 15, 2026 is Sunday → walk back to Saturday (skip) → Friday March 13
    const result = getActualPayday(2026, 2, 15, true);
    expect(isoDate(result)).toBe('2026-03-13');
  });

  it('day=1, month=3 (April), year=2026 — Wednesday (workday) → stays April 1', () => {
    const result = getActualPayday(2026, 3, 1, true);
    expect(isoDate(result)).toBe('2026-04-01');
  });

  it('day=1, month=0 (January), year=2026 — holiday → shifts back past Dec 31 2025 (also holiday) to Dec 30 2025', () => {
    // Jan 1 2026 is in RU holiday list
    // Dec 31 2025 is also in RU holiday list
    // Dec 30 2025 is Tuesday → first valid business day
    const result = getActualPayday(2026, 0, 1, true);
    expect(isoDate(result)).toBe('2025-12-30');
  });

  it('normal weekday is unaffected', () => {
    // April 15, 2026 is Wednesday — not a holiday
    const result = getActualPayday(2026, 3, 15, true);
    expect(isoDate(result)).toBe('2026-04-15');
  });

  it('day=9, month=2 (March), year=2026 — 2026-03-09 is in RU holiday list → shifts back', () => {
    // March 9, 2026 is in RU_HOLIDAY_DATES; March 8 is Sunday → March 7 (Saturday) → March 6 (Friday)
    const result = getActualPayday(2026, 2, 9, true);
    // March 8 = Sunday, March 7 = Saturday, March 6 = Friday, not a holiday
    expect(isoDate(result)).toBe('2026-03-06');
  });
});

// ── getNextActualPayday ───────────────────────────────────────────────────────

describe('getNextActualPayday — no calendar', () => {
  it('paydays=[1,15], fromDate=March 20 2026 → next is April 1, 2026', () => {
    const result = getNextActualPayday([1, 15], d(2026, 2, 20), false);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-04-01');
  });

  it('paydays=[15], fromDate=March 14 2026 → next is March 15, 2026', () => {
    const result = getNextActualPayday([15], d(2026, 2, 14), false);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-03-15');
  });

  it('paydays=[15], fromDate=March 15 2026 → next is April 15, 2026 (today excluded, strictly after)', () => {
    const result = getNextActualPayday([15], d(2026, 2, 15), false);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-04-15');
  });

  it('returns null for empty paydays array', () => {
    const result = getNextActualPayday([], d(2026, 2, 20), false);
    expect(result).toBeNull();
  });
});

describe('getNextActualPayday — with RU calendar', () => {
  it('paydays=[15], fromDate=March 14 2026 → March 15 adjusted to March 13, which is before fromDate → next is April 15', () => {
    // March 15 is Sunday → actual = March 13 (Fri). March 13 is NOT > March 14.
    // So next actual payday is April 15, 2026 (Wednesday, no adjustment needed).
    const result = getNextActualPayday([15], d(2026, 2, 14), true);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-04-15');
  });

  it('paydays=[1,15], fromDate=March 20 2026 → April 1 is Wednesday → stays April 1', () => {
    const result = getNextActualPayday([1, 15], d(2026, 2, 20), true);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-04-01');
  });

  it('paydays=[15], fromDate=March 12 2026 → March 15 adjusted to March 13, which is > March 12 → returns March 13', () => {
    const result = getNextActualPayday([15], d(2026, 2, 12), true);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-03-13');
  });
});

// ── getLastActualPayday ───────────────────────────────────────────────────────

describe('getLastActualPayday — no calendar', () => {
  it('paydays=[1,15], fromDate=March 20 2026 → last is March 15, 2026', () => {
    const result = getLastActualPayday([1, 15], d(2026, 2, 20), false);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-03-15');
  });

  it('paydays=[15], fromDate=March 16 2026 → last is March 15, 2026', () => {
    const result = getLastActualPayday([15], d(2026, 2, 16), false);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-03-15');
  });

  it('paydays=[15], fromDate=March 15 2026 → last is March 15 itself (on day counts as received)', () => {
    const result = getLastActualPayday([15], d(2026, 2, 15), false);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-03-15');
  });

  it('paydays=[15], fromDate=March 1 2026 → last is February 15, 2026', () => {
    const result = getLastActualPayday([15], d(2026, 2, 1), false);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-02-15');
  });

  it('returns null for empty paydays array', () => {
    const result = getLastActualPayday([], d(2026, 2, 20), false);
    expect(result).toBeNull();
  });
});

describe('getLastActualPayday — with RU calendar', () => {
  it('paydays=[1,15], fromDate=March 14 2026 → March 15 adjusted to March 13 (< March 14) → returns March 13', () => {
    // March 15 (Sun) → adjusted to March 13 (Fri). March 13 <= March 14 → qualifies.
    // March 1 (Sun) → adjusted to Feb 27 (Fri). Feb 27 < March 13 → March 13 wins.
    const result = getLastActualPayday([1, 15], d(2026, 2, 14), true);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2026-03-13');
  });

  it('paydays=[1], fromDate=January 5 2026 → January 1 is holiday, adjusted to Dec 30 2025', () => {
    // Jan 1 2026 holiday, Dec 31 2025 holiday, Dec 30 2025 is Tuesday → actual = Dec 30
    const result = getLastActualPayday([1], d(2026, 0, 5), true);
    expect(result).not.toBeNull();
    expect(isoDate(result!)).toBe('2025-12-30');
  });
});

// ── getNextIncomeAmount ───────────────────────────────────────────────────────

describe('getNextIncomeAmount', () => {
  it('single income with one payday → returns full amount', () => {
    const incomes = [{ amount: 50000000, paydays: [15] }];
    const nextPayday = d(2026, 3, 15); // April 15
    expect(getNextIncomeAmount(incomes, nextPayday)).toBe(50000000);
  });

  it('two incomes on different paydays → on April 1 returns only the first income', () => {
    const incomes = [
      { amount: 25000000, paydays: [1] },
      { amount: 25000000, paydays: [15] },
    ];
    const nextPayday = d(2026, 3, 1); // April 1 — matches payday [1]
    expect(getNextIncomeAmount(incomes, nextPayday)).toBe(25000000);
  });

  it('single income with two paydays → returns half (split per payCount)', () => {
    const incomes = [{ amount: 60000000, paydays: [1, 15] }];
    const nextPayday = d(2026, 3, 1); // April 1 matches [1]
    // payCount = 2 → 60000000 / 2 = 30000000
    expect(getNextIncomeAmount(incomes, nextPayday)).toBe(30000000);
  });

  it('single income with two paydays — the other payday — also returns half', () => {
    const incomes = [{ amount: 60000000, paydays: [1, 15] }];
    const nextPayday = d(2026, 3, 15); // April 15 matches [15]
    expect(getNextIncomeAmount(incomes, nextPayday)).toBe(30000000);
  });

  it('empty incomes → returns 0', () => {
    expect(getNextIncomeAmount([], d(2026, 3, 15))).toBe(0);
  });

  it('nextPayday day not in any payday list → fallback includes all incomes at full split', () => {
    // nextDay=20 is not in any known payday set → dayInKnownPaydays=false for all
    // so all incomes contribute (hasMatch=false but dayInKnownPaydays=false → included)
    const incomes = [
      { amount: 30000000, paydays: [1] },
      { amount: 30000000, paydays: [15] },
    ];
    const nextPayday = d(2026, 3, 20); // April 20 — not in any payday
    expect(getNextIncomeAmount(incomes, nextPayday)).toBe(60000000);
  });

  it('multiple incomes sharing same payday → all included', () => {
    const incomes = [
      { amount: 20000000, paydays: [15] },
      { amount: 30000000, paydays: [15] },
    ];
    const nextPayday = d(2026, 3, 15);
    expect(getNextIncomeAmount(incomes, nextPayday)).toBe(50000000);
  });
});
