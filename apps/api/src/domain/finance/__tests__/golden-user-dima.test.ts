/**
 * golden-user-dima.test.ts
 *
 * Release gate: exact output verification for Dmitriy's golden case.
 *
 * RULES (enforced by code structure):
 *   1. Expected values are computed by INDEPENDENT inline arithmetic —
 *      no imports from the domain engine under test.
 *   2. Fixture is a statically committed file — no prod DB access.
 *   3. If ANY assertion fails, merge/release is BLOCKED.
 *
 * All amounts: KOPECKS. Display ÷ 100 = roubles.
 */

import { runFinanceDomain } from '../index';
import type { FinanceDomainInputs, DebtPaymentEventInput } from '../types';
import {
  GOLDEN_TZ,
  GOLDEN_NOW,
  GOLDEN_INCOME,
  GOLDEN_OBLIGATIONS,
  GOLDEN_DEBTS,
  GOLDEN_EF,
  SCENARIO_A,
  SCENARIO_B,
} from '../__fixtures__/golden_user_dima_march_2026';

// ════════════════════════════════════════════════════════════════════════════
// INDEPENDENT EXPECTED VALUES
// Computed by inline arithmetic only. Zero imports from domain engine.
// Every formula can be verified with pencil and paper.
// ════════════════════════════════════════════════════════════════════════════

// ── Period bounds ─────────────────────────────────────────────────────────
// March 15 2026 = Sunday, useRuCal=true → getActualPayday shifts back to Fri March 13
// April 1 2026  = Wednesday, no adjustment
// UTC instants for local midnight (Moscow = UTC+3):
//   March 13 00:00 Moscow = 2026-03-12T21:00:00Z
//   April 1  00:00 Moscow = 2026-03-31T21:00:00Z
const EXP_PERIOD_START_UTC_ISO = '2026-03-12T21:00:00.000Z';
const EXP_PERIOD_END_UTC_ISO   = '2026-03-31T21:00:00.000Z';
const EXP_TOTAL_DAYS           = 19;  // (Apr1 - Mar13) = 19 calendar days
const EXP_DAY_NUMBER           = 9;   // Mar21 - Mar13 = 8 elapsed → day 9
const EXP_DAYS_LEFT            = 11;  // Apr1 midnight - Mar21 midnight = 11 days

// ── Income ────────────────────────────────────────────────────────────────
// startNominalPayday=15; income.paydays=[1,15].includes(15)=true
// Semantics B: contribution = amount (no division)
const EXP_TOTAL_INCOME = 25_000_000; // kopecks = 250,000 ₽

// ── Obligations ───────────────────────────────────────────────────────────
const EXP_TOTAL_OBLIGATIONS = 1_200_000 + 100_000 + 1_000_000; // = 2,300,000

// ── Debt required in period [Mar 13, Apr 1) Moscow ───────────────────────
// dueDay=15 (Mar 15 in [13,31]) → required
// dueDay=21 (Mar 21 in [13,31]) → required
// dueDay=16 (Mar 16 in [13,31]) → required
// dueDay=1  (Mar 1 < Mar 13; Apr 1 = exclusive end) → NOT DUE, required=0
const EXP_DEBT1_REQUIRED = 2_281_000;
const EXP_DEBT2_REQUIRED = 5_923_000;
const EXP_DEBT3_REQUIRED = 2_850_900;
const EXP_DEBT4_REQUIRED = 0;  // NOT_DUE

// ── Scenario A: all debts paid → totalDebtPaymentsRemaining = 0 ──────────
const EXP_TOTAL_DEBT_REMAINING_A = 0;

// ── afterFixed (Scenario A) ───────────────────────────────────────────────
const _afterFixed_A = EXP_TOTAL_INCOME - EXP_TOTAL_OBLIGATIONS - EXP_TOTAL_DEBT_REMAINING_A;
// = 25,000,000 - 2,300,000 - 0 = 22,700,000

// ── Reserve ───────────────────────────────────────────────────────────────
const EXP_RESERVE = ((): number => {
  let r = _afterFixed_A > 0 ? Math.round(_afterFixed_A * 0.10) : 0;
  if (_afterFixed_A - r < 0 && _afterFixed_A > 0) {
    r = Math.round(_afterFixed_A * 0.05);
    if (_afterFixed_A - r < 0) r = 0;
  }
  return r;
})(); // = 2,270,000

const _freePool = Math.max(0, _afterFixed_A - EXP_RESERVE); // = 20,430,000

// ── EF contribution ───────────────────────────────────────────────────────
const _efTarget       = EXP_TOTAL_OBLIGATIONS * GOLDEN_EF.targetMonths; // = 6,900,000
const _efDeficit      = Math.max(0, _efTarget - GOLDEN_EF.currentAmount); // = 6,900,000
const _monthlyEFGoal  = Math.round(_efDeficit / 12);                      // = 575,000
const EXP_EF_CONTRIBUTION = Math.min(
  Math.min(_monthlyEFGoal, Math.round(_freePool * 0.20)),
  _efDeficit,
); // = min(575,000, 4,086,000, 6,900,000) = 575,000

// ── Avalanche ─────────────────────────────────────────────────────────────
// focusDebt = d1 (isFocusDebt=true, apr=0.369 ≥ 0.18)
// efDeficit > 0 AND high APR → 30% rule
const FOCUS_DEBT_BALANCE = 60_193_200;
const _investPool = Math.max(0, _freePool - EXP_EF_CONTRIBUTION); // = 19,855,000
const EXP_AVALANCHE = Math.min(
  Math.round(_investPool * 0.30),
  FOCUS_DEBT_BALANCE,
); // = min(5,956,500, 60,193,200) = 5,956,500

// ── s2sPeriod (same for both scenarios — debt deduction = 0 in both) ──────
const EXP_S2S_PERIOD = Math.max(
  0,
  EXP_TOTAL_INCOME - EXP_TOTAL_OBLIGATIONS - EXP_TOTAL_DEBT_REMAINING_A
  - EXP_RESERVE - EXP_EF_CONTRIBUTION - EXP_AVALANCHE,
); // = 25,000,000 - 2,300,000 - 0 - 2,270,000 - 575,000 - 5,956,500 = 13,898,500

// ── Scenario A outputs ────────────────────────────────────────────────────
const EXP_A_PERIOD_REMAINING = Math.max(0, EXP_S2S_PERIOD - SCENARIO_A.totalPeriodSpent);
// = max(0, 13,898,500 - 105,000) = 13,793,500
const EXP_A_S2S_DAILY = Math.round(EXP_A_PERIOD_REMAINING / EXP_DAYS_LEFT);
// = round(13,793,500 / 11) = 1,253,955
const EXP_A_S2S_TODAY = Math.max(0, EXP_A_S2S_DAILY - SCENARIO_A.todayTotal);
// = 1,253,955

// ── Scenario B outputs ────────────────────────────────────────────────────
const EXP_B_PERIOD_REMAINING = Math.max(0, EXP_S2S_PERIOD - SCENARIO_B.totalPeriodSpent);
// = max(0, 13,898,500 - 111,729) = 13,786,771
const EXP_B_S2S_DAILY = Math.round(EXP_B_PERIOD_REMAINING / EXP_DAYS_LEFT);
// = round(13,786,771 / 11) = 1,253,343
const EXP_B_S2S_TODAY = Math.max(0, EXP_B_S2S_DAILY - SCENARIO_B.todayTotal);
// = 1,253,343 - 6,729 = 1,246,614

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function makeInputs(scenario: {
  totalPeriodSpent: number;
  todayTotal: number;
  debtPaymentEvents: DebtPaymentEventInput[];
}): FinanceDomainInputs {
  return {
    now:               GOLDEN_NOW,
    tz:                GOLDEN_TZ,
    incomes:           GOLDEN_INCOME,
    obligations:       GOLDEN_OBLIGATIONS,
    debts:             GOLDEN_DEBTS,
    emergencyFund:     GOLDEN_EF,
    totalPeriodSpent:  scenario.totalPeriodSpent,
    todayTotal:        scenario.todayTotal,
    debtPaymentEvents: [...scenario.debtPaymentEvents],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO A — all required debts paid, todayTotal = 0
// ════════════════════════════════════════════════════════════════════════════

describe('golden_user_dima_march_2026 — Scenario A (all debts paid, today=0)', () => {
  let result: ReturnType<typeof runFinanceDomain>;

  beforeAll(() => {
    result = runFinanceDomain(makeInputs(SCENARIO_A));
  });

  // ── HARD STOP: period boundaries ─────────────────────────────────────────
  it('periodStart UTC = 2026-03-12T21:00:00.000Z  (= Mar 13 00:00 Moscow)', () => {
    expect(result.periodStartIso).toBe(EXP_PERIOD_START_UTC_ISO);
  });
  it('periodEnd UTC = 2026-03-31T21:00:00.000Z  (= Apr 1 00:00 Moscow)', () => {
    expect(result.periodEndIso).toBe(EXP_PERIOD_END_UTC_ISO);
  });
  it('totalDays = 19', () => expect(result.totalDays).toBe(EXP_TOTAL_DAYS));
  it('dayNumber = 9',  () => expect(result.dayNumber).toBe(EXP_DAY_NUMBER));
  it('daysLeft = 11',  () => expect(result.daysLeft).toBe(EXP_DAYS_LEFT));

  // ── Finance snapshot (exact) ──────────────────────────────────────────────
  it('totalIncome = 25,000,000 kopecks', () =>
    expect(result.totalIncome).toBe(EXP_TOTAL_INCOME));
  it('totalObligations = 2,300,000 kopecks', () =>
    expect(result.totalObligations).toBe(EXP_TOTAL_OBLIGATIONS));
  it('reserve = 2,270,000 kopecks', () =>
    expect(result.reserve).toBe(EXP_RESERVE));
  it('efContribution = 575,000 kopecks', () =>
    expect(result.efContribution).toBe(EXP_EF_CONTRIBUTION));
  it('avalanchePool = 5,956,500 kopecks', () =>
    expect(result.avalanchePool).toBe(EXP_AVALANCHE));
  it('s2sPeriod = 13,898,500 kopecks', () =>
    expect(result.s2sPeriod).toBe(EXP_S2S_PERIOD));
  it('totalDebtPaymentsRemaining = 0 (all required debts paid)', () =>
    expect(result.totalDebtPaymentsRemaining).toBe(EXP_TOTAL_DEBT_REMAINING_A));
  it('totalPeriodSpent = 105,000 kopecks', () =>
    expect(result.totalPeriodSpent).toBe(SCENARIO_A.totalPeriodSpent));
  it('periodRemaining = 13,793,500 kopecks', () =>
    expect(result.periodRemaining).toBe(EXP_A_PERIOD_REMAINING));
  it('s2sDaily = 1,253,955 kopecks', () =>
    expect(result.s2sDaily).toBe(EXP_A_S2S_DAILY));
  it('s2sToday = 1,253,955 kopecks  (todayTotal=0)', () =>
    expect(result.s2sToday).toBe(EXP_A_S2S_TODAY));

  // ── Debt summaries ────────────────────────────────────────────────────────
  it('debt d1 (dueDay=15): required=2,281,000, paid=2,281,000, remaining=0, PAID', () => {
    const s = result.debtSummaries.find(d => d.debtId === 'cmmzfy6fd0001sq01a5u2zu7r')!;
    expect(s.requiredMinForPeriod).toBe(EXP_DEBT1_REQUIRED);
    expect(s.paidRequiredThisPeriod).toBe(2_281_000);
    expect(s.remainingRequiredThisPeriod).toBe(0);
    expect(s.status).toBe('PAID');
  });
  it('debt d2 (dueDay=21): required=5,923,000, PAID', () => {
    const s = result.debtSummaries.find(d => d.debtId === 'cmmzfzhq50003sq01h2fw4pul')!;
    expect(s.requiredMinForPeriod).toBe(EXP_DEBT2_REQUIRED);
    expect(s.remainingRequiredThisPeriod).toBe(0);
    expect(s.status).toBe('PAID');
  });
  it('debt d3 (dueDay=16): required=2,850,900, PAID', () => {
    const s = result.debtSummaries.find(d => d.debtId === 'cmmzg16hh0005sq01n8ogx6gw')!;
    expect(s.requiredMinForPeriod).toBe(EXP_DEBT3_REQUIRED);
    expect(s.remainingRequiredThisPeriod).toBe(0);
    expect(s.status).toBe('PAID');
  });
  it('debt d4 (dueDay=1): NOT_DUE in [Mar 13, Apr 1) — required=0', () => {
    const s = result.debtSummaries.find(d => d.debtId === 'cmmzg23dt0007sq016oim67w0')!;
    expect(s.requiredMinForPeriod).toBe(EXP_DEBT4_REQUIRED);
    expect(s.remainingRequiredThisPeriod).toBe(0);
    expect(s.status).toBe('NOT_DUE');
  });

  // ── Mathematical consistency (independent of exact values) ────────────────
  it('periodRemaining = max(0, s2sPeriod - totalPeriodSpent)', () =>
    expect(result.periodRemaining).toBe(Math.max(0, result.s2sPeriod - SCENARIO_A.totalPeriodSpent)));
  it('s2sDaily = round(periodRemaining / daysLeft)', () =>
    expect(result.s2sDaily).toBe(Math.round(result.periodRemaining / result.daysLeft)));
  it('s2sToday = max(0, s2sDaily - todayTotal=0)', () =>
    expect(result.s2sToday).toBe(Math.max(0, result.s2sDaily - 0)));
});

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO B — all required debts paid, todayTotal = 6,729
// ════════════════════════════════════════════════════════════════════════════

describe('golden_user_dima_march_2026 — Scenario B (all debts paid, today=6729)', () => {
  let result: ReturnType<typeof runFinanceDomain>;

  beforeAll(() => {
    result = runFinanceDomain(makeInputs(SCENARIO_B));
  });

  // Period bounds (same as Scenario A)
  it('periodStart UTC = 2026-03-12T21:00:00.000Z', () =>
    expect(result.periodStartIso).toBe(EXP_PERIOD_START_UTC_ISO));
  it('totalDays = 19', () => expect(result.totalDays).toBe(EXP_TOTAL_DAYS));
  it('dayNumber = 9',  () => expect(result.dayNumber).toBe(EXP_DAY_NUMBER));
  it('daysLeft = 11',  () => expect(result.daysLeft).toBe(EXP_DAYS_LEFT));

  // Finance
  it('s2sPeriod same as Scenario A = 13,898,500', () =>
    expect(result.s2sPeriod).toBe(EXP_S2S_PERIOD));
  it('totalDebtPaymentsRemaining = 0', () =>
    expect(result.totalDebtPaymentsRemaining).toBe(0));
  it('totalPeriodSpent = 111,729', () =>
    expect(result.totalPeriodSpent).toBe(SCENARIO_B.totalPeriodSpent));
  it('periodRemaining = 13,786,771 kopecks', () =>
    expect(result.periodRemaining).toBe(EXP_B_PERIOD_REMAINING));
  it('s2sDaily = 1,253,343 kopecks', () =>
    expect(result.s2sDaily).toBe(EXP_B_S2S_DAILY));
  it('s2sToday = 1,246,614 kopecks  (s2sDaily - 6729)', () =>
    expect(result.s2sToday).toBe(EXP_B_S2S_TODAY));

  // Consistency
  it('periodRemaining = max(0, s2sPeriod - 111,729)', () =>
    expect(result.periodRemaining).toBe(Math.max(0, result.s2sPeriod - SCENARIO_B.totalPeriodSpent)));
  it('s2sToday = max(0, s2sDaily - 6729)', () =>
    expect(result.s2sToday).toBe(Math.max(0, result.s2sDaily - SCENARIO_B.todayTotal)));
});
