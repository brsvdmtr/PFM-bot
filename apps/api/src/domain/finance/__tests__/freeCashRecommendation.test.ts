/**
 * freeCashRecommendation.test.ts
 *
 * Golden tests for the Free Cash Recommendation domain function.
 *
 * Rules:
 *   1. Decision tree assertions use independent inline logic — no imports from
 *      the domain engine other than the function under test.
 *   2. Effect assertions use small, human-verifiable inputs (plain numbers, no
 *      fixtures) so every expected value can be traced by hand.
 *   3. 11 scenarios cover the full decision tree, overrides, edge cases, and
 *      the belowThreshold short-circuit.
 *
 * All money values: KOPECKS. Display ÷ 100 = roubles.
 */

import {
  recommendFreeCash,
  computeFreeCashEffect,
  DEFAULT_CONFIG,
  type FreeCashDebtInput,
  type FreeCashInput,
} from '../freeCashRecommendation';

// ════════════════════════════════════════════════════════════════════════════
// FIXTURE BUILDERS
// ════════════════════════════════════════════════════════════════════════════

const RUB = 100; // multiplier: 1 rouble = 100 kopecks
const KRUB = 100_000; // 1 000 roubles

function debt(overrides: Partial<FreeCashDebtInput> & { id: string }): FreeCashDebtInput {
  return {
    title: 'Test Debt',
    balance: 100 * KRUB,
    apr: 0.20,
    minPayment: 5 * KRUB,
    isFocusDebt: false,
    isPaidOff: false,
    ...overrides,
  };
}

function input(overrides: Partial<FreeCashInput>): FreeCashInput {
  return {
    amountMinor: 20 * KRUB,       // 20 000 ₽
    efCurrentMinor: 0,
    efTargetMinor: 300 * KRUB,    // 300 000 ₽
    monthlyEssentialsMinor: 50 * KRUB, // 50 000 ₽/month
    debts: [],
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

describe('recommendFreeCash — decision tree', () => {
  // ── 1. No debts → EMERGENCY_FUND (NO_DEBT) ──
  test('no debts → EMERGENCY_FUND, reason NO_DEBT', () => {
    const r = recommendFreeCash(input({
      amountMinor: 50 * KRUB,
      efCurrentMinor: 100 * KRUB, // well above protective
      debts: [],
    }));

    expect(r.mode).toBe('EMERGENCY_FUND');
    expect(r.defaultMode).toBe('EMERGENCY_FUND');
    expect(r.reasonCode).toBe('NO_DEBT');
    expect(r.belowThreshold).toBe(false);
    expect(r.primaryEffect.toEmergencyFundMinor).toBe(50 * KRUB);
    expect(r.primaryEffect.toDebtMinor).toBe(0);

    // No debts → alternatives list is empty (SPLIT and DEBT_PREPAY are impossible)
    expect(r.alternatives).toHaveLength(0);

    // EF coverage math: before = 100/50 = 2 months, after = 150/50 = 3 months
    expect(r.primaryEffect.efMonthsBefore).toBeCloseTo(2);
    expect(r.primaryEffect.efMonthsAfter).toBeCloseTo(3);
  });

  // ── 2. EF protective (< 1 month essentials) → EMERGENCY_FUND ──
  test('EF below protective threshold → EMERGENCY_FUND, reason EF_PROTECTIVE', () => {
    // EF = 30k, essentials = 50k → coverage = 0.6 months < 1 month threshold
    // Debt has HIGH APR (25%) but protective wins.
    const r = recommendFreeCash(input({
      amountMinor: 20 * KRUB,
      efCurrentMinor: 30 * KRUB,
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [debt({ id: 'd1', apr: 0.25, balance: 200 * KRUB, minPayment: 10 * KRUB })],
    }));

    expect(r.mode).toBe('EMERGENCY_FUND');
    expect(r.reasonCode).toBe('EF_PROTECTIVE');
    expect(r.primaryEffect.toEmergencyFundMinor).toBe(20 * KRUB);
    expect(r.primaryEffect.toDebtMinor).toBe(0);

    // Alternatives should include DEBT_PREPAY and SPLIT (debts exist)
    expect(r.alternatives).toHaveLength(2);
    expect(r.alternatives.map(a => a.mode).sort()).toEqual(['DEBT_PREPAY', 'SPLIT']);
  });

  // ── 3. EF fully funded → DEBT_PREPAY ──
  test('EF at/above target → DEBT_PREPAY, reason EF_FULLY_FUNDED', () => {
    // EF = 300k = target. Debt APR 12% (< high threshold), but EF maxed so all → debt.
    const r = recommendFreeCash(input({
      amountMinor: 50 * KRUB,
      efCurrentMinor: 300 * KRUB,
      efTargetMinor: 300 * KRUB,
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [debt({ id: 'd1', apr: 0.12, balance: 200 * KRUB, minPayment: 10 * KRUB })],
    }));

    expect(r.mode).toBe('DEBT_PREPAY');
    expect(r.reasonCode).toBe('EF_FULLY_FUNDED');
    expect(r.primaryEffect.toEmergencyFundMinor).toBe(0);
    expect(r.primaryEffect.toDebtMinor).toBe(50 * KRUB);
    expect(r.primaryEffect.focusDebtBalanceBefore).toBe(200 * KRUB);
    expect(r.primaryEffect.focusDebtBalanceAfter).toBe(150 * KRUB);
  });

  // ── 4. High APR debt + EF not maxed but above protective → DEBT_PREPAY ──
  test('high APR debt wins over EF topup → DEBT_PREPAY, reason HIGH_APR_DEBT', () => {
    const r = recommendFreeCash(input({
      amountMinor: 30 * KRUB,
      efCurrentMinor: 80 * KRUB,    // 1.6 months (> protective)
      efTargetMinor: 300 * KRUB,    // EF not maxed
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [debt({ id: 'd1', apr: 0.20, balance: 200 * KRUB, minPayment: 10 * KRUB })],
    }));

    expect(r.mode).toBe('DEBT_PREPAY');
    expect(r.reasonCode).toBe('HIGH_APR_DEBT');
    expect(r.primaryEffect.toDebtMinor).toBe(30 * KRUB);
    expect(r.primaryEffect.focusDebtBalanceAfter).toBe(170 * KRUB);
  });

  // ── 5. Moderate everything → SPLIT ──
  test('moderate EF + moderate APR debt → SPLIT, reason BALANCED_SPLIT', () => {
    // EF 80k / essentials 50k = 1.6 months (> protective, not maxed)
    // Debt APR 0.15 (< 0.18 threshold)
    const r = recommendFreeCash(input({
      amountMinor: 20 * KRUB,
      efCurrentMinor: 80 * KRUB,
      efTargetMinor: 300 * KRUB,
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [debt({ id: 'd1', apr: 0.15, balance: 200 * KRUB, minPayment: 10 * KRUB })],
    }));

    expect(r.mode).toBe('SPLIT');
    expect(r.reasonCode).toBe('BALANCED_SPLIT');
    // Default split 50/50 → 10k EF, 10k debt
    expect(r.primaryEffect.toEmergencyFundMinor).toBe(10 * KRUB);
    expect(r.primaryEffect.toDebtMinor).toBe(10 * KRUB);
    expect(r.splitEfShare).toBe(0.5);
  });

  // ── 6. Focus debt picked by highest APR, tiebreak smallest balance ──
  test('focus debt picks highest APR, then smallest balance', () => {
    const r = recommendFreeCash(input({
      amountMinor: 50 * KRUB,
      efCurrentMinor: 500 * KRUB,
      efTargetMinor: 300 * KRUB, // EF maxed → DEBT_PREPAY
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [
        debt({ id: 'big_low', apr: 0.15, balance: 500 * KRUB, minPayment: 20 * KRUB }),
        debt({ id: 'big_high', apr: 0.22, balance: 400 * KRUB, minPayment: 15 * KRUB }),
        debt({ id: 'small_high', apr: 0.22, balance: 100 * KRUB, minPayment: 5 * KRUB }),
      ],
    }));

    expect(r.mode).toBe('DEBT_PREPAY');
    // Highest APR = 0.22 (two candidates), smallest balance = 100k → 'small_high'
    expect(r.primaryEffect.focusDebtId).toBe('small_high');
  });

  // ── 7. Amount below minSignificantMinor → belowThreshold, no flow ──
  test('amount below min significant threshold → belowThreshold=true', () => {
    const r = recommendFreeCash(input({
      amountMinor: 50_000, // 500 ₽ < 1000 ₽ threshold
      efCurrentMinor: 50 * KRUB,
      debts: [debt({ id: 'd1', apr: 0.25, balance: 200 * KRUB, minPayment: 10 * KRUB })],
    }));

    expect(r.belowThreshold).toBe(true);
    expect(r.reasonCode).toBe('NO_SIGNIFICANT_AMOUNT');
    expect(r.alternatives).toHaveLength(0);
  });

  // ── 8. Amount > focus debt balance → debt clamped, leftover vanishes ──
  test('debt prepay amount exceeds balance → clamped, leftover vanishes', () => {
    const r = recommendFreeCash(input({
      amountMinor: 300 * KRUB,      // 300k
      efCurrentMinor: 300 * KRUB,
      efTargetMinor: 300 * KRUB,    // EF maxed → DEBT_PREPAY
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [debt({ id: 'd1', apr: 0.20, balance: 100 * KRUB, minPayment: 5 * KRUB })],
    }));

    expect(r.mode).toBe('DEBT_PREPAY');
    // Debt side clamped to balance (100k), leftover (200k) vanishes per Q2
    expect(r.primaryEffect.toDebtMinor).toBe(100 * KRUB);
    expect(r.primaryEffect.toEmergencyFundMinor).toBe(0);
    expect(r.primaryEffect.focusDebtBalanceAfter).toBe(0);
    // Full payoff → accelerated months = 0
    expect(r.primaryEffect.acceleratedPayoffMonths).toBe(0);
  });

  // ── 9. monthlyEssentials = 0 → efMonths null, protective rule skipped ──
  test('monthlyEssentials = 0 → skip protective branch, EF months = null', () => {
    const r = recommendFreeCash(input({
      amountMinor: 20 * KRUB,
      efCurrentMinor: 0,
      efTargetMinor: 0,
      monthlyEssentialsMinor: 0,
      debts: [debt({ id: 'd1', apr: 0.15, balance: 200 * KRUB, minPayment: 10 * KRUB })],
    }));

    // No essentials → protective rule doesn't fire
    // EF target = 0 → "fully funded" check is skipped (requires efTargetMinor > 0)
    // APR 0.15 < 0.18 → not high APR
    // → Fall through to SPLIT
    expect(r.mode).toBe('SPLIT');
    expect(r.primaryEffect.efMonthsBefore).toBeNull();
    expect(r.primaryEffect.efMonthsAfter).toBeNull();
  });

  // ── 10. Override mode: force EMERGENCY_FUND when default was DEBT_PREPAY ──
  test('override.mode=EMERGENCY_FUND flips preview; defaultMode/reason preserved', () => {
    const inp = input({
      amountMinor: 30 * KRUB,
      efCurrentMinor: 80 * KRUB,
      efTargetMinor: 300 * KRUB,
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [debt({ id: 'd1', apr: 0.25, balance: 200 * KRUB, minPayment: 10 * KRUB })],
    });

    const r = recommendFreeCash(inp, { mode: 'EMERGENCY_FUND' });

    // Default is DEBT_PREPAY (high APR), but user forced EF.
    expect(r.defaultMode).toBe('DEBT_PREPAY');
    expect(r.reasonCode).toBe('HIGH_APR_DEBT');
    expect(r.mode).toBe('EMERGENCY_FUND');
    expect(r.primaryEffect.toEmergencyFundMinor).toBe(30 * KRUB);
    expect(r.primaryEffect.toDebtMinor).toBe(0);
  });

  // ── 11. Override splitEfShare: custom ratio ──
  test('override.splitEfShare=0.25 → 25% EF, 75% debt in SPLIT mode', () => {
    const inp = input({
      amountMinor: 20 * KRUB,
      efCurrentMinor: 80 * KRUB,
      efTargetMinor: 300 * KRUB,
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [debt({ id: 'd1', apr: 0.15, balance: 200 * KRUB, minPayment: 10 * KRUB })],
    });

    const r = recommendFreeCash(inp, { splitEfShare: 0.25 });

    expect(r.mode).toBe('SPLIT');
    // 25% of 20k = 5k EF, 75% = 15k debt
    expect(r.primaryEffect.toEmergencyFundMinor).toBe(5 * KRUB);
    expect(r.primaryEffect.toDebtMinor).toBe(15 * KRUB);
    expect(r.splitEfShare).toBe(0.25);
  });

  // ── 12. Force SPLIT when no debts → silently fall back to EMERGENCY_FUND ──
  test('force mode=SPLIT with no debts → silently falls back to EMERGENCY_FUND', () => {
    const r = recommendFreeCash(
      input({
        amountMinor: 20 * KRUB,
        efCurrentMinor: 100 * KRUB,
        debts: [],
      }),
      { mode: 'SPLIT' },
    );

    expect(r.mode).toBe('EMERGENCY_FUND');
    expect(r.defaultMode).toBe('EMERGENCY_FUND');
    expect(r.reasonCode).toBe('NO_DEBT');
    expect(r.primaryEffect.toEmergencyFundMinor).toBe(20 * KRUB);
  });

  // ── 13. Paid-off debts ignored ──
  test('paid-off and zero-balance debts are ignored', () => {
    const r = recommendFreeCash(input({
      amountMinor: 20 * KRUB,
      efCurrentMinor: 100 * KRUB,
      efTargetMinor: 300 * KRUB,
      monthlyEssentialsMinor: 50 * KRUB,
      debts: [
        debt({ id: 'd1', apr: 0.30, balance: 0, minPayment: 10 * KRUB, isPaidOff: true }),
        debt({ id: 'd2', apr: 0.30, balance: 100 * KRUB, minPayment: 5 * KRUB, isPaidOff: true }),
      ],
    }));

    // Both debts inactive → treated as "no debts" → EMERGENCY_FUND, NO_DEBT
    expect(r.mode).toBe('EMERGENCY_FUND');
    expect(r.reasonCode).toBe('NO_DEBT');
    expect(r.alternatives).toHaveLength(0);
  });
});

describe('computeFreeCashEffect — payoff math', () => {
  // ── Independent payoff calculation ──
  // balance 100k, APR 12% → monthlyRate = 0.01
  // monthlyPayment 10k
  // simulation: month 1: interest = round(100k × 0.01) = 1000, bal = 100k + 1k - 10k = 91k
  //             ... until balance <= 0
  // This is the same algorithm as simulatePayoff — we just spot-check via the function.

  test('months saved is positive when prepay > 0 and baseline is OK', () => {
    const effect = computeFreeCashEffect(
      {
        amountMinor: 50 * KRUB,
        efCurrentMinor: 0,
        efTargetMinor: 0,
        monthlyEssentialsMinor: 0,
        debts: [debt({ id: 'd1', apr: 0.12, balance: 200 * KRUB, minPayment: 10 * KRUB })],
      },
      'DEBT_PREPAY',
      0.5,
    );

    expect(effect.payoffStatus).toBe('OK');
    expect(effect.toDebtMinor).toBe(50 * KRUB);
    expect(effect.focusDebtBalanceAfter).toBe(150 * KRUB);
    expect(effect.baselinePayoffMonths).not.toBeNull();
    expect(effect.acceleratedPayoffMonths).not.toBeNull();
    // Reducing balance by 25% → accelerated must finish earlier
    expect(effect.acceleratedPayoffMonths!).toBeLessThan(effect.baselinePayoffMonths!);
    expect(effect.monthsSaved!).toBeGreaterThan(0);
    expect(effect.interestSavedMinor!).toBeGreaterThan(0);
  });

  test('zero minPayment → payoffStatus NO_MIN_PAYMENT, savings null', () => {
    const effect = computeFreeCashEffect(
      {
        amountMinor: 50 * KRUB,
        efCurrentMinor: 0,
        efTargetMinor: 0,
        monthlyEssentialsMinor: 0,
        debts: [debt({ id: 'd1', apr: 0.20, balance: 200 * KRUB, minPayment: 0 })],
      },
      'DEBT_PREPAY',
      0.5,
    );

    expect(effect.payoffStatus).toBe('NO_MIN_PAYMENT');
    expect(effect.monthsSaved).toBeNull();
    expect(effect.interestSavedMinor).toBeNull();
    // But balance-before/after still populated (non-savings math)
    expect(effect.focusDebtBalanceBefore).toBe(200 * KRUB);
    expect(effect.focusDebtBalanceAfter).toBe(150 * KRUB);
  });

  test('prepay equals balance → accelerated months = 0', () => {
    const effect = computeFreeCashEffect(
      {
        amountMinor: 100 * KRUB,
        efCurrentMinor: 0,
        efTargetMinor: 0,
        monthlyEssentialsMinor: 0,
        debts: [debt({ id: 'd1', apr: 0.20, balance: 100 * KRUB, minPayment: 5 * KRUB })],
      },
      'DEBT_PREPAY',
      0.5,
    );

    expect(effect.focusDebtBalanceAfter).toBe(0);
    expect(effect.acceleratedPayoffMonths).toBe(0);
    expect(effect.monthsSaved!).toBe(effect.baselinePayoffMonths!);
  });
});

describe('DEFAULT_CONFIG', () => {
  test('default config has expected values (guard against accidental changes)', () => {
    expect(DEFAULT_CONFIG.protectiveThresholdMonths).toBe(1);
    expect(DEFAULT_CONFIG.highAprThreshold).toBe(0.18);
    expect(DEFAULT_CONFIG.splitEfShare).toBe(0.5);
    expect(DEFAULT_CONFIG.minSignificantMinor).toBe(100_000); // 1000 ₽
  });
});

// Suppress lint on unused helper
void RUB;
