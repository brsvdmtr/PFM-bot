import {
  isDueDayInWindow,
  computeReservedUpcoming,
  computeLiveWindow,
  type ObligationForWindow,
  type DebtForWindow,
  type LiveWindowInput,
} from '../engine';

// ── Helpers ──────────────────────────────────────────────────────────────────

function d(year: number, month: number, day: number): Date {
  // month is 0-indexed
  return new Date(year, month, day, 0, 0, 0, 0);
}

// ── isDueDayInWindow ──────────────────────────────────────────────────────────

describe('isDueDayInWindow', () => {
  // Window: [March 20, April 1) — today=March 20, nextIncome=April 1 2026

  const today = d(2026, 2, 20);       // March 20
  const nextIncome = d(2026, 3, 1);   // April 1

  it('dueDay=27 (March 27) is within [March 20, April 1) → true', () => {
    expect(isDueDayInWindow(27, today, nextIncome)).toBe(true);
  });

  it('dueDay=20 (March 20 = today) is the inclusive start → true', () => {
    expect(isDueDayInWindow(20, today, nextIncome)).toBe(true);
  });

  it('dueDay=31 (March 31) is within [March 20, April 1) → true', () => {
    expect(isDueDayInWindow(31, today, nextIncome)).toBe(true);
  });

  it('dueDay=17 (March 17) has already passed before today → false', () => {
    expect(isDueDayInWindow(17, today, nextIncome)).toBe(false);
  });

  it('dueDay=1 (April 1 = nextIncomeDate boundary) is excluded → false', () => {
    // The interval is half-open [today, nextIncomeDate). April 1 is the boundary.
    expect(isDueDayInWindow(1, today, nextIncome)).toBe(false);
  });

  it('dueDay=3 (April 3) is after nextIncomeDate → false', () => {
    expect(isDueDayInWindow(3, today, nextIncome)).toBe(false);
  });

  it('same-day window (today === nextIncome) → nothing is in range → false', () => {
    const sameDay = d(2026, 2, 20);
    expect(isDueDayInWindow(20, sameDay, sameDay)).toBe(false);
  });

  it('handles month boundary crossing: window crosses month end', () => {
    // today=March 28, nextIncome=April 5 → dueDay=2 (April 2) should be true
    const t2 = d(2026, 2, 28);
    const n2 = d(2026, 3, 5);
    expect(isDueDayInWindow(2, t2, n2)).toBe(true);
  });

  it('handles month boundary crossing: dueDay=27 before today in next month — false', () => {
    // today=March 28, nextIncome=April 5 → dueDay=27 (March 27 has passed, April 27 is after window)
    const t2 = d(2026, 2, 28);
    const n2 = d(2026, 3, 5);
    expect(isDueDayInWindow(27, t2, n2)).toBe(false);
  });
});

// ── computeReservedUpcoming ──────────────────────────────────────────────────

describe('computeReservedUpcoming', () => {
  const today = d(2026, 2, 20);       // March 20
  const nextIncome = d(2026, 3, 1);   // April 1

  it('includes obligation with dueDay=27 (in window)', () => {
    const obligations: ObligationForWindow[] = [{ amount: 5000000, dueDay: 27 }];
    const result = computeReservedUpcoming(obligations, [], today, nextIncome);
    expect(result.reservedUpcomingObligations).toBe(5000000);
    expect(result.reservedUpcoming).toBe(5000000);
  });

  it('excludes obligation with dueDay=17 (already past)', () => {
    const obligations: ObligationForWindow[] = [{ amount: 5000000, dueDay: 17 }];
    const result = computeReservedUpcoming(obligations, [], today, nextIncome);
    expect(result.reservedUpcomingObligations).toBe(0);
    expect(result.reservedUpcoming).toBe(0);
  });

  it('excludes obligation with no dueDay (cannot determine window position)', () => {
    const obligations: ObligationForWindow[] = [{ amount: 8000000, dueDay: null }];
    const result = computeReservedUpcoming(obligations, [], today, nextIncome);
    expect(result.reservedUpcomingObligations).toBe(0);
  });

  it('excludes obligation with undefined dueDay', () => {
    const obligations: ObligationForWindow[] = [{ amount: 7000000 }];
    const result = computeReservedUpcoming(obligations, [], today, nextIncome);
    expect(result.reservedUpcomingObligations).toBe(0);
  });

  it('excludes debt with dueDay=1 (April 1 = boundary, excluded)', () => {
    const debts: DebtForWindow[] = [{ minPayment: 3000000, dueDay: 1 }];
    const result = computeReservedUpcoming([], debts, today, nextIncome);
    expect(result.reservedUpcomingDebtPayments).toBe(0);
    expect(result.reservedUpcoming).toBe(0);
  });

  it('excludes debt with no dueDay', () => {
    const debts: DebtForWindow[] = [{ minPayment: 4000000, dueDay: null }];
    const result = computeReservedUpcoming([], debts, today, nextIncome);
    expect(result.reservedUpcomingDebtPayments).toBe(0);
  });

  it('sums obligations and debts correctly in reservedUpcoming', () => {
    const obligations: ObligationForWindow[] = [
      { amount: 5000000, dueDay: 27 },  // included
      { amount: 2000000, dueDay: 17 },  // excluded (past)
      { amount: 3000000 },              // excluded (no dueDay)
    ];
    const debts: DebtForWindow[] = [
      { minPayment: 1000000, dueDay: 25 }, // included
      { minPayment: 2000000, dueDay: 1 },  // excluded (boundary)
    ];
    const result = computeReservedUpcoming(obligations, debts, today, nextIncome);
    expect(result.reservedUpcomingObligations).toBe(5000000);  // only dueDay=27 in window
    expect(result.reservedUpcomingDebtPayments).toBe(1000000);
    expect(result.reservedUpcoming).toBe(6000000);
  });

  it('empty inputs → all zeros', () => {
    const result = computeReservedUpcoming([], [], today, nextIncome);
    expect(result.reservedUpcomingObligations).toBe(0);
    expect(result.reservedUpcomingDebtPayments).toBe(0);
    expect(result.reservedUpcoming).toBe(0);
  });
});

// ── computeLiveWindow ─────────────────────────────────────────────────────────

describe('computeLiveWindow — normal OK case', () => {
  it('computes freeCashPool, s2sDaily, s2sToday correctly', () => {
    // cashAnchor=500k, reserved=50k, expenses=30k, daysToNextIncome=12, todayExpenses=0
    const input: LiveWindowInput = {
      cashAnchorAmount:          50000000,  // 500 000 ₽
      reservedUpcoming:           5000000,  //  50 000 ₽
      expensesSinceAnchor:        3000000,  //  30 000 ₽
      todayExpensesSinceAnchor:         0,
      nextIncomeDate: d(2026, 3, 1),        // April 1 (12 days from March 20)
      today:          d(2026, 2, 20),       // March 20
    };
    const result = computeLiveWindow(input);

    // freeCashPool = 50000000 - 5000000 - 3000000 = 42000000
    expect(result.freeCashPool).toBe(42000000);
    // daysToNextIncome = ceil((Apr1 - Mar20) / 86400000) = 12
    expect(result.daysToNextIncome).toBe(12);
    // s2sDaily = floor(42000000 / 12) = 3500000
    expect(result.s2sDaily).toBe(3500000);
    // s2sToday = max(0, 3500000 - 0) = 3500000
    expect(result.s2sToday).toBe(3500000);
    expect(result.status).toBe('OK');
    expect(result.s2sColor).toBe('green');
  });

  it('subtracts todayExpenses from s2sToday', () => {
    const input: LiveWindowInput = {
      cashAnchorAmount:  50000000,
      reservedUpcoming:   5000000,
      expensesSinceAnchor: 3000000,
      todayExpensesSinceAnchor: 1000000,  // spent 10k today
      nextIncomeDate: d(2026, 3, 1),
      today:          d(2026, 2, 20),
    };
    const result = computeLiveWindow(input);
    // s2sToday = max(0, 3500000 - 1000000) = 2500000
    expect(result.s2sToday).toBe(2500000);
    expect(result.status).toBe('OK');
  });
});

describe('computeLiveWindow — DEFICIT status', () => {
  it('freeCashPool=0 when reserved+expenses exceed anchor → DEFICIT, red', () => {
    const input: LiveWindowInput = {
      cashAnchorAmount:   1000000,  //  10 000 ₽
      reservedUpcoming:   2000000,  //  20 000 ₽  (exceeds anchor)
      expensesSinceAnchor:      0,
      todayExpensesSinceAnchor: 0,
      nextIncomeDate: d(2026, 3, 1),
      today:          d(2026, 2, 20),
    };
    const result = computeLiveWindow(input);
    expect(result.freeCashPool).toBe(0);
    expect(result.s2sDaily).toBe(0);
    expect(result.s2sToday).toBe(0);
    expect(result.status).toBe('DEFICIT');
    expect(result.s2sColor).toBe('red');
  });

  it('expenses alone exceed anchor → DEFICIT', () => {
    const input: LiveWindowInput = {
      cashAnchorAmount:    500000,
      reservedUpcoming:         0,
      expensesSinceAnchor: 600000,  // more than anchor
      todayExpensesSinceAnchor: 0,
      nextIncomeDate: d(2026, 3, 1),
      today:          d(2026, 2, 20),
    };
    const result = computeLiveWindow(input);
    expect(result.freeCashPool).toBe(0);
    expect(result.status).toBe('DEFICIT');
  });
});

describe('computeLiveWindow — OVERSPENT status', () => {
  it('todayExpenses > s2sDaily → OVERSPENT, red', () => {
    const input: LiveWindowInput = {
      cashAnchorAmount:        50000000,
      reservedUpcoming:               0,
      expensesSinceAnchor:            0,
      todayExpensesSinceAnchor: 5000000,  // 50k today > s2sDaily=3500000 (with 12 days)
      nextIncomeDate: d(2026, 3, 1),
      today:          d(2026, 2, 20),
    };
    const result = computeLiveWindow(input);
    // s2sDaily = floor(50000000 / 12) = 4166666
    expect(input.todayExpensesSinceAnchor).toBeGreaterThan(0);
    expect(result.s2sToday).toBe(0);  // max(0, ...) clips to 0
    expect(result.status).toBe('OVERSPENT');
    expect(result.s2sColor).toBe('red');
  });
});

describe('computeLiveWindow — WARNING status', () => {
  it('s2sToday/s2sDaily <= 0.3 → WARNING, red color', () => {
    // s2sDaily = floor(42000000/12) = 3500000
    // Spend 75% of daily → todayExpenses = 2625000 → s2sToday = 875000
    // 875000 / 3500000 = 0.25 <= 0.3 → WARNING
    const input: LiveWindowInput = {
      cashAnchorAmount:         50000000,
      reservedUpcoming:          5000000,
      expensesSinceAnchor:       3000000,
      todayExpensesSinceAnchor:  2625000,
      nextIncomeDate: d(2026, 3, 1),
      today:          d(2026, 2, 20),
    };
    const result = computeLiveWindow(input);
    expect(result.s2sDaily).toBe(3500000);
    expect(result.s2sToday).toBe(875000);
    const ratio = result.s2sToday / result.s2sDaily;
    expect(ratio).toBeLessThanOrEqual(0.3);
    expect(result.status).toBe('WARNING');
    expect(result.s2sColor).toBe('red');
  });

  it('s2sToday/s2sDaily in (0.3, 0.7] → s2sColor=orange, status=OK', () => {
    // todayExpenses = 1050000 → s2sToday = 3500000 - 1050000 = 2450000
    // 2450000 / 3500000 = 0.7 → border case (<=0.7 orange)
    const input: LiveWindowInput = {
      cashAnchorAmount:         50000000,
      reservedUpcoming:          5000000,
      expensesSinceAnchor:       3000000,
      todayExpensesSinceAnchor:  1050000,
      nextIncomeDate: d(2026, 3, 1),
      today:          d(2026, 2, 20),
    };
    const result = computeLiveWindow(input);
    expect(result.s2sColor).toBe('orange');
    expect(result.status).toBe('OK');
  });
});

describe('computeLiveWindow — daysToNextIncome edge cases', () => {
  it('nextIncomeDate same as today → daysToNextIncome floors to 1 (min 1)', () => {
    const input: LiveWindowInput = {
      cashAnchorAmount:         12000000,
      reservedUpcoming:               0,
      expensesSinceAnchor:            0,
      todayExpensesSinceAnchor:       0,
      nextIncomeDate: d(2026, 2, 20),  // same as today
      today:          d(2026, 2, 20),
    };
    const result = computeLiveWindow(input);
    expect(result.daysToNextIncome).toBe(1);
    expect(result.s2sDaily).toBe(12000000);
  });
});
