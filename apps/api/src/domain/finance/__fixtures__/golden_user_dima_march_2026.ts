/**
 * golden_user_dima_march_2026.ts
 *
 * Statically committed golden fixture for Dmitriy's account, March 2026.
 * Captured from production DB on 2026-03-21. Manually verified.
 *
 * DO NOT regenerate at runtime. All test commands (pnpm test:golden,
 * pnpm verify:finance, CI) run on THIS file only — no prod DB access.
 *
 * To update: re-run scripts/capture-golden-fixture.ts, manually verify
 * all values, and update this file + the expected values in the test.
 * Requires team sign-off.
 *
 * Income semantics: SEMANTICS_B (per-payout). See docs/INCOME_SEMANTICS.md.
 * All amounts: KOPECKS (minor units). Display layer divides by 100.
 */

import type {
  IncomeInput,
  ObligationInput,
  DebtInput,
  EFInput,
  DebtPaymentEventInput,
} from '../types';

// ── User context ──────────────────────────────────────────────────────────────

export const GOLDEN_TZ   = 'Europe/Moscow';
/** Fixed "now" for deterministic test output. 09:00 Moscow = 06:00 UTC. */
export const GOLDEN_NOW  = new Date('2026-03-21T06:00:00.000Z');

// ── Income (post-migration: amount = per-payout, Semantics B) ─────────────────

export const GOLDEN_INCOME: IncomeInput[] = [
  {
    id:                     'cmmzgm719000dsq01ylaljmvm',
    amount:                 25_000_000,   // kopecks = 250,000 ₽ per payout
    paydays:                [1, 15],
    useRussianWorkCalendar: true,         // fixed from false on 2026-03-21
  },
];

// ── Obligations (monthly, kopecks) ────────────────────────────────────────────

export const GOLDEN_OBLIGATIONS: ObligationInput[] = [
  { id: 'cmmxxwmzk0005td01gdv8zmow', amount: 1_200_000, dueDay: null },
  { id: 'cmmxyekj10011td01pnwtsh9v', amount:   100_000, dueDay:    1 },
  { id: 'cmmxyexfd0013td018o72m0tg', amount: 1_000_000, dueDay:   15 },
];
// totalObligations = 2,300,000 kopecks = 23,000 ₽/month

// ── Debts (kopecks) ───────────────────────────────────────────────────────────

export const GOLDEN_DEBTS: DebtInput[] = [
  {
    id:          'cmmzfy6fd0001sq01a5u2zu7r',
    balance:     60_193_200,  // kopecks = 601,932 ₽
    apr:         0.369,
    minPayment:  2_281_000,   // kopecks = 22,810 ₽/month
    dueDay:      15,
    isFocusDebt: true,
    isPaidOff:   false,
  },
  {
    id:          'cmmzfzhq50003sq01h2fw4pul',
    balance:     177_980_900, // kopecks = 1,779,809 ₽
    apr:         0.289,
    minPayment:  5_923_000,   // kopecks = 59,230 ₽/month
    dueDay:      21,
    isFocusDebt: false,
    isPaidOff:   false,
  },
  {
    id:          'cmmzg16hh0005sq01n8ogx6gw',
    balance:     88_439_700,  // kopecks = 884,397 ₽
    apr:         0.247,
    minPayment:  2_850_900,   // kopecks = 28,509 ₽/month
    dueDay:      16,
    isFocusDebt: false,
    isPaidOff:   false,
  },
  {
    id:          'cmmzg23dt0007sq016oim67w0',
    balance:     34_700_000,  // kopecks = 347,000 ₽
    apr:         0,
    minPayment:  1_000_000,   // kopecks = 10,000 ₽/month
    dueDay:      1,           // NOT DUE in [Mar 13, Apr 1) — Mar 1 before start, Apr 1 = exclusive end
    isFocusDebt: false,
    isPaidOff:   false,
  },
];

// ── Emergency fund ────────────────────────────────────────────────────────────

export const GOLDEN_EF: EFInput = {
  currentAmount: 0,  // kopecks — empty
  targetMonths:  3,
};

// ── Debt payment events (current period, all 4 required debts paid) ───────────
//
// Note: debt d4 (dueDay=1) is NOT DUE in [Mar 13, Apr 1).
// Its payment event exists but does not affect totalDebtPaymentsRemaining
// (required=0 → remaining=max(0,0-paid)=0, status=NOT_DUE).

export const GOLDEN_DEBT_EVENTS_ALL_PAID: DebtPaymentEventInput[] = [
  { debtId: 'cmmzfy6fd0001sq01a5u2zu7r', amountMinor: 2_281_000, kind: 'REQUIRED_MIN_PAYMENT' },
  { debtId: 'cmmzfzhq50003sq01h2fw4pul', amountMinor: 5_923_000, kind: 'REQUIRED_MIN_PAYMENT' },
  { debtId: 'cmmzg16hh0005sq01n8ogx6gw', amountMinor: 2_850_900, kind: 'REQUIRED_MIN_PAYMENT' },
  { debtId: 'cmmzg23dt0007sq016oim67w0', amountMinor: 1_000_000, kind: 'REQUIRED_MIN_PAYMENT' },
];

export const GOLDEN_DEBT_EVENTS_NONE_PAID: DebtPaymentEventInput[] = [];

// ── Scenarios ─────────────────────────────────────────────────────────────────
//
// Captured period expenses: 3 expenses, total = 105,000 kopecks = 1,050 ₽
// (made during the period, all within [Mar 13, Apr 1) local Moscow time)

/**
 * Scenario A: All required debts paid. No expenses today. 3 historical.
 * totalPeriodSpent = 105,000 (historical only). todayTotal = 0.
 */
export const SCENARIO_A = {
  totalPeriodSpent: 105_000,  // kopecks: 3 captured expenses
  todayTotal:       0,
  debtPaymentEvents: GOLDEN_DEBT_EVENTS_ALL_PAID,
} as const;

/**
 * Scenario B: All required debts paid. One expense today (6,729 kopecks).
 * historicalPeriodSpent = 105,000. todayTotal = 6,729.
 * totalPeriodSpent = 105,000 + 6,729 = 111,729.
 */
export const SCENARIO_B = {
  totalPeriodSpent: 111_729,  // kopecks: historical (105,000) + today (6,729)
  todayTotal:       6_729,
  debtPaymentEvents: GOLDEN_DEBT_EVENTS_ALL_PAID,
} as const;
