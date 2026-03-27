/**
 * buildDashboardView.ts — Domain Finance
 *
 * Pure function: FinanceDomainInputs → DashboardView.
 * No DB, no side effects. Orchestrates all domain computations.
 *
 * This is the single source of truth for the financial model.
 * Route handlers call this (via rebuildSnapshot) and return the result.
 */

import { dayNumberInPeriod, daysLeftInPeriod, computeDebtPeriodSummaries } from '../../period-utils';
import { calculateActualPeriodBounds } from './buildActualPayPeriods';
import { computeS2S } from './computeS2S';
import type {
  FinanceDomainInputs,
  DashboardView,
  DebtPeriodSummary,
} from './types';

export function buildDashboardView(inputs: FinanceDomainInputs): DashboardView {
  const {
    now, tz,
    incomes, obligations, debts, emergencyFund,
    totalPeriodSpent, todayTotal,
    debtPaymentEvents,
  } = inputs;

  // ── 1. Actual period bounds ───────────────────────────────────────────────
  const useRuCalendar = incomes.some((i) => i.useRussianWorkCalendar);
  const allPaydays = [...new Set(incomes.flatMap((i) => i.paydays))].sort((a, b) => a - b);

  const bounds = calculateActualPeriodBounds(allPaydays, now, tz, useRuCalendar);
  const { start, end, daysTotal, startNominalPayday, endNominalPayday, actualPayoutDateIso } = bounds;

  // ── 2. Day number (1-based) ───────────────────────────────────────────────
  const dayNumber = dayNumberInPeriod(start, now, tz);

  // ── 3. Debt period summaries ──────────────────────────────────────────────
  // Aggregate paid amounts by debtId from REQUIRED_MIN_PAYMENT events
  const paidByDebt = new Map<string, number>();
  for (const ev of debtPaymentEvents) {
    if (ev.kind === 'REQUIRED_MIN_PAYMENT') {
      paidByDebt.set(ev.debtId, (paidByDebt.get(ev.debtId) ?? 0) + ev.amountMinor);
    }
  }

  const debtSummaries: DebtPeriodSummary[] = computeDebtPeriodSummaries(
    debts
      .filter((d) => !d.isPaidOff)
      .map((d) => ({ id: d.id, minPayment: d.minPayment, dueDay: d.dueDay })),
    paidByDebt,
    { startDate: start, endDate: end },
    tz,
  );

  // ── 4. Total debt payments remaining for this period ─────────────────────
  // This is the KEY architectural fix: we deduct only what's STILL OWED.
  // Snapshot rebuild is triggered on every debt payment event, so this
  // value stays current, and s2sPeriod reflects freed budget immediately.
  const totalDebtPaymentsRemaining = debtSummaries.reduce(
    (sum, d) => sum + d.remainingRequiredThisPeriod,
    0,
  );

  // ── 5. Compute S2S ───────────────────────────────────────────────────────
  const s2s = computeS2S({
    periodStart: start,
    periodEnd: end,
    daysTotal,
    now,
    tz,
    startNominalPayday,
    incomes,
    obligations,
    debts,
    emergencyFund,
    totalDebtPaymentsRemainingForPeriod: totalDebtPaymentsRemaining,
    totalPeriodSpent,
    todayTotal,
  });

  // ── 6. Savings budget adjustments ─────────────────────────────────────────
  // Deposits from available budget → consume budget (positive adjustment).
  // Withdrawals to available budget → release budget (negative adjustment).
  const periodSavingsAdj = inputs.periodSavingsAdjustment ?? 0;
  const todaySavingsAdj = inputs.todaySavingsAdjustment ?? 0;

  const effectivePeriodSpent = totalPeriodSpent + periodSavingsAdj;
  const effectiveTodaySpent = todayTotal + todaySavingsAdj;

  const daysLeft = daysLeftInPeriod(end, now, tz);

  let periodRemaining = Math.max(0, s2s.s2sPeriod - effectivePeriodSpent);
  let s2sDaily = daysLeft > 0 ? Math.max(0, Math.round(periodRemaining / daysLeft)) : 0;
  let s2sToday = Math.max(0, s2sDaily - effectiveTodaySpent);

  // ── 7. Cash anchor reality cap ──────────────────────────────────────────
  const cashOnHand = inputs.cashOnHand;
  if (cashOnHand != null && cashOnHand >= 0 && cashOnHand < periodRemaining) {
    periodRemaining = cashOnHand;
    s2sDaily = daysLeft > 0 ? Math.max(0, Math.round(periodRemaining / daysLeft)) : 0;
    s2sToday = Math.max(0, s2sDaily - effectiveTodaySpent);
  }

  // ── 7. Status / color ─────────────────────────────────────────────────────
  let s2sStatus: DashboardView['s2sStatus'] = 'OK';
  if (s2s.s2sPeriod <= 0) {
    s2sStatus = 'DEFICIT';
  } else if (effectiveTodaySpent > s2sDaily) {
    s2sStatus = 'OVERSPENT';
  } else if (s2sDaily > 0 && s2sToday / s2sDaily <= 0.30) {
    s2sStatus = 'WARNING';
  }

  const s2sColor: DashboardView['s2sColor'] =
    s2sStatus === 'DEFICIT' || s2sStatus === 'OVERSPENT' ? 'red'
    : s2sStatus === 'WARNING' ? 'orange'
    : 'green';

  // ── 7. Period ISO strings ─────────────────────────────────────────────────
  const periodStartIso = start.toISOString();
  const periodEndIso   = end.toISOString();

  return {
    periodStartIso,
    periodEndIso,
    totalDays: daysTotal,
    dayNumber,
    daysLeft,

    totalIncome:               s2s.totalIncome,
    totalObligations:          s2s.totalObligations,
    totalDebtPaymentsDeducted: s2s.totalDebtPaymentsDeducted,
    totalDebtPaymentsRemaining,
    reserve:                   s2s.reserve,
    efContribution:            s2s.efContribution,
    avalanchePool:             s2s.avalanchePool,
    s2sPeriod:                 s2s.s2sPeriod,
    totalPeriodSpent,
    periodSavingsAdjustment: periodSavingsAdj,
    effectivePeriodSpent,
    periodRemaining,
    s2sDaily,
    s2sToday,

    s2sStatus,
    s2sColor,

    debtSummaries,

    _debug: {
      actualPayoutDateIso,
      startNominalPayday,
      endNominalPayday,
      tz,
      nowIso: now.toISOString(),
    },
  };
}
