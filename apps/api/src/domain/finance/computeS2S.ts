/**
 * computeS2S.ts — Domain Finance
 *
 * Pure S2S computation. No DB, no side effects.
 *
 * Key changes from legacy engine.ts:
 *   1. Income matched by startNominalPayday — no endDay/endDayIdx inference.
 *   2. totalDebtPaymentsRemainingForPeriod passed in directly — not computed
 *      from full min payments. This makes s2sPeriod reflect what's STILL OWED,
 *      so when debts are paid, s2sPeriod rises on next snapshot rebuild.
 *   3. daysLeft / dayNumber use timezone-aware helpers from period-utils.
 *   4. No isProratedStart — actual bounds are always used as-is.
 */

import { daysLeftInPeriod, dayNumberInPeriod } from '../../period-utils';
import type { IncomeInput, ObligationInput, DebtInput, EFInput, S2SComputed } from './types';

export interface ComputeS2SInput {
  // Period
  periodStart: Date;      // UTC instant = local midnight
  periodEnd: Date;        // UTC instant = local midnight
  daysTotal: number;      // from ActualPeriodBounds
  now: Date;              // current UTC instant
  tz: string;

  // Income matching
  startNominalPayday: number;

  // Income / obligations / debts / EF
  incomes: IncomeInput[];
  obligations: ObligationInput[];
  debts: DebtInput[];
  emergencyFund: EFInput | null;

  /**
   * Sum of REQUIRED_MIN_PAYMENT debt obligations that are STILL UNPAID
   * for this period. Computed by rebuildSnapshot before calling computeS2S.
   *
   * When = 0 (all debts paid), the freed budget flows into s2sPeriod.
   */
  totalDebtPaymentsRemainingForPeriod: number;

  // Expenses
  totalPeriodSpent: number;  // kopecks
  todayTotal: number;        // kopecks
}

export function computeS2S(input: ComputeS2SInput): S2SComputed {
  const {
    periodStart, periodEnd, now, tz,
    startNominalPayday,
    incomes, obligations, debts, emergencyFund,
    totalDebtPaymentsRemainingForPeriod,
    totalPeriodSpent, todayTotal,
  } = input;

  // ── Time (timezone-aware) ─────────────────────────────────────────────────
  const daysLeft = daysLeftInPeriod(periodEnd, now, tz);

  // ── Income for this period ────────────────────────────────────────────────
  // Match by startNominalPayday (Semantics B: amount = per-payout, no division).
  const totalIncome = incomes.reduce((sum, inc) => {
    if (!inc.paydays.includes(startNominalPayday)) return sum;
    return sum + inc.amount;
  }, 0);

  // ── Obligations ───────────────────────────────────────────────────────────
  // Monthly total; not prorated (actual period bounds are always canonical).
  const totalObligations = obligations.reduce((sum, o) => sum + o.amount, 0);

  // ── Debt deduction (remaining only) ──────────────────────────────────────
  // Use the REMAINING unpaid amount — not the full period total.
  // This is the architectural fix: after paying debts, s2sPeriod goes up.
  const totalDebtPaymentsDeducted = totalDebtPaymentsRemainingForPeriod;

  // ── After fixed ──────────────────────────────────────────────────────────
  const afterFixed = totalIncome - totalObligations - totalDebtPaymentsDeducted;

  // ── Reserve (10% buffer, reduced to 5% if margin is tight) ───────────────
  let reserve = afterFixed > 0 ? Math.round(afterFixed * 0.10) : 0;
  if (afterFixed - reserve < 0 && afterFixed > 0) {
    reserve = Math.round(afterFixed * 0.05);
    if (afterFixed - reserve < 0) reserve = 0;
  }

  const freePool = Math.max(0, afterFixed - reserve);

  // ── Emergency Fund contribution ───────────────────────────────────────────
  const ef = emergencyFund ?? { currentAmount: 0, targetMonths: 3 };
  const monthlyObligations = totalObligations; // obligations are already monthly
  const efTarget  = monthlyObligations * ef.targetMonths;
  const efDeficit = Math.max(0, efTarget - ef.currentAmount);

  let efContribution = 0;
  if (efDeficit > 0 && freePool > 0) {
    const monthlyEFGoal = Math.round(efDeficit / 12);
    efContribution = Math.min(monthlyEFGoal, Math.round(freePool * 0.20));
    efContribution = Math.min(efContribution, efDeficit);
  }

  // ── Avalanche pool (focus debt extra paydown) ─────────────────────────────
  const activeDebts = debts.filter((d) => !d.isPaidOff && d.balance > 0);
  const focusDebt   = activeDebts.find((d) => d.isFocusDebt) ?? null;

  let avalanchePool = 0;
  if (focusDebt) {
    const investPool = Math.max(0, freePool - efContribution);
    if (efDeficit <= 0) {
      // EF funded — invest aggressively
      avalanchePool = focusDebt.apr >= 0.18
        ? Math.round(investPool * 0.50)
        : Math.round(investPool * 0.25);
    } else if (focusDebt.apr >= 0.18) {
      // High-APR: even with EF deficit, allocate 30%
      avalanchePool = Math.round(investPool * 0.30);
    }
    avalanchePool = Math.min(avalanchePool, focusDebt.balance);
  }

  // ── S2S period budget ─────────────────────────────────────────────────────
  const residual  = totalIncome - totalObligations - totalDebtPaymentsDeducted
                  - reserve - efContribution - avalanchePool;
  const s2sPeriod = Math.max(0, residual);

  // ── Daily / today ─────────────────────────────────────────────────────────
  const periodRemaining = Math.max(0, s2sPeriod - totalPeriodSpent);
  const s2sDaily        = Math.max(0, Math.round(periodRemaining / daysLeft));
  const s2sToday        = Math.max(0, s2sDaily - todayTotal);

  return {
    totalIncome,
    totalObligations,
    totalDebtPaymentsDeducted,
    reserve,
    efContribution,
    avalanchePool,
    s2sPeriod,
    periodRemaining,
    s2sDaily,
    s2sToday,
  };
}
