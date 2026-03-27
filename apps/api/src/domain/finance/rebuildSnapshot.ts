/**
 * rebuildSnapshot.ts — Domain Finance
 *
 * THE single mutation point for the active period snapshot.
 * All paths that change financial state (debt payment, expense recorded,
 * onboarding complete, self-heal) must call rebuildActivePeriodSnapshot().
 *
 * Flow:
 *   1. Fetch all inputs from DB (fresh — never stale)
 *   2. calculateActualPeriodBounds → real payout date boundaries
 *   3. Re-match expenses by effectiveLocalDate (re-links any mismatched)
 *   4. Aggregate REQUIRED_MIN_PAYMENT events → totalDebtPaymentsRemaining
 *   5. buildDashboardView (pure) → all computed values
 *   6. Update Period record with new snapshot
 *
 * Route handlers MUST NOT do financial math — they call this and return output.
 */

import { prisma } from '@pfm/db';
import { effectiveLocalDateInPeriod } from './matchEventsToPeriod';
import { buildDashboardView } from './buildDashboardView';
import { DEFAULT_TZ } from '../../period-utils';
import type { FinanceDomainInputs } from './types';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Rebuild the active period snapshot for a user.
 *
 * Safe to call multiple times — idempotent given the same underlying data.
 * After this call, Period.s2sPeriod correctly reflects remaining debt obligations.
 *
 * @throws if no active period or no incomes (caller should guard).
 */
export async function rebuildActivePeriodSnapshot(
  userId: string,
  nowUtc?: Date,
): Promise<void> {
  const now = nowUtc ?? new Date();

  // ── 1. Fetch all inputs ───────────────────────────────────────────────────
  const [userRecord, incomes, obligations, debts, ef] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    }),
    prisma.income.findMany({ where: { userId, isActive: true } }),
    prisma.obligation.findMany({ where: { userId, isActive: true } }),
    prisma.debt.findMany({ where: { userId, isPaidOff: false } }),
    prisma.emergencyFund.findUnique({ where: { userId } }),
  ]);

  const tz = userRecord?.timezone ?? DEFAULT_TZ;

  const activePeriod = await prisma.period.findFirst({
    where: { userId, status: 'ACTIVE' },
  });

  if (!activePeriod || incomes.length === 0) return;

  // ── 2. Re-match expenses by effectiveLocalDate ────────────────────────────
  // The domain model computes bounds first, then counts expenses that fall
  // in [start, end) local time.  On first self-heal this corrects any
  // expenses that were linked to the period but actually fall outside the
  // new (wider) boundaries, and vice-versa.
  //
  // Step A: compute tentative bounds to know the window
  const useRuCalendar = incomes.some((i) => (i as any).useRussianWorkCalendar === true);
  const allPaydays = [...new Set(incomes.flatMap((i) => i.paydays as number[]))].sort(
    (a, b) => a - b,
  );
  // We need bounds to filter expenses — import here to avoid circular reference
  const { calculateActualPeriodBounds } = await import('./buildActualPayPeriods');
  const bounds = calculateActualPeriodBounds(allPaydays, now, tz, useRuCalendar);

  // Step B: find ALL user expenses and classify by effectiveLocalDate
  const allExpenses = await prisma.expense.findMany({
    where: { userId },
    select: { id: true, amount: true, spentAt: true, periodId: true },
  });

  const expensesInPeriod = allExpenses.filter((e) =>
    effectiveLocalDateInPeriod(e.spentAt, bounds.start, bounds.end, tz),
  );

  // Re-link any expenses that belong to this period but have a wrong periodId
  const wronglyLinked = expensesInPeriod.filter((e) => e.periodId !== activePeriod.id);
  if (wronglyLinked.length > 0) {
    await prisma.expense.updateMany({
      where: { id: { in: wronglyLinked.map((e) => e.id) } },
      data: { periodId: activePeriod.id },
    });
  }

  const totalPeriodSpent = expensesInPeriod.reduce((sum, e) => sum + e.amount, 0);

  // ── 3. Fetch REQUIRED_MIN_PAYMENT events for this period ──────────────────
  // Match by effectiveLocalDate (paymentDate in user's TZ within period window)
  const allDebtEvents = await prisma.debtPaymentEvent.findMany({
    where: { userId, kind: 'REQUIRED_MIN_PAYMENT', deletedAt: null },
    select: { id: true, debtId: true, amountMinor: true, kind: true, paymentDate: true },
  });

  const periodDebtEvents = allDebtEvents.filter((ev) =>
    effectiveLocalDateInPeriod(ev.paymentDate, bounds.start, bounds.end, tz),
  );

  // Re-link debt events to the correct period
  const wrongDebtEvents = periodDebtEvents.filter((ev) => (ev as any).periodId !== activePeriod.id);
  if (wrongDebtEvents.length > 0) {
    await prisma.debtPaymentEvent.updateMany({
      where: { id: { in: wrongDebtEvents.map((ev) => ev.id) } },
      data: { periodId: activePeriod.id },
    });
  }

  // ── 4. Build domain inputs ────────────────────────────────────────────────
  const inputs: FinanceDomainInputs = {
    now,
    tz,
    incomes: incomes.map((i) => ({
      id: i.id,
      amount: i.amount,
      paydays: i.paydays as number[],
      useRussianWorkCalendar: (i as any).useRussianWorkCalendar === true,
    })),
    obligations: obligations.map((o) => ({
      id: o.id,
      amount: o.amount,
      dueDay: o.dueDay ?? null,
    })),
    debts: debts.map((d) => ({
      id: d.id,
      balance: d.balance,
      apr: d.apr,
      minPayment: d.minPayment,
      dueDay: (d as any).dueDay ?? null,
      isFocusDebt: d.isFocusDebt,
      isPaidOff: d.isPaidOff,
    })),
    emergencyFund: ef
      ? { currentAmount: ef.currentAmount, targetMonths: ef.targetMonths }
      : null,
    totalPeriodSpent,
    todayTotal: 0,  // snapshot doesn't care about today's sub-total
    debtPaymentEvents: periodDebtEvents.map((ev) => ({
      debtId: ev.debtId,
      amountMinor: ev.amountMinor,
      kind: ev.kind as 'REQUIRED_MIN_PAYMENT' | 'EXTRA_PRINCIPAL_PAYMENT',
    })),
    cashOnHand: activePeriod.cashAnchorAmount ?? null,
    periodSavingsAdjustment: 0,  // snapshot rebuild uses 0; live dashboard computes from entries
    todaySavingsAdjustment: 0,
  };

  // ── 5. Compute view (pure) ────────────────────────────────────────────────
  const view = buildDashboardView(inputs);

  // ── 6. Update Period record ───────────────────────────────────────────────
  await prisma.period.update({
    where: { id: activePeriod.id },
    data: {
      startDate:         bounds.start,
      endDate:           bounds.end,
      daysTotal:         bounds.daysTotal,
      isProratedStart:   false,  // actual bounds are never prorated
      totalIncome:       view.totalIncome,
      totalObligations:  view.totalObligations,
      totalDebtPayments: view.totalDebtPaymentsDeducted,
      efContribution:    view.efContribution,
      reserve:           view.reserve,
      s2sPeriod:         view.s2sPeriod,
      s2sDaily:          view.s2sDaily,
      triggerPayday:     bounds.startNominalPayday,
    },
  });
}
