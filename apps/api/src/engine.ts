/**
 * S2S (Safe to Spend) Calculation Engine
 *
 * Pure functions — no side effects, no DB access.
 * All money values in minor units (kopecks/cents).
 */

// ── Types ──────────────────────────────────────────────

export interface IncomeInput {
  amount: number;       // minor units per period
  paydays: number[];    // days of month [15] or [5, 20]
}

export interface ObligationInput {
  amount: number;       // minor units per month
}

export interface DebtInput {
  id: string;
  balance: number;      // minor units remaining
  apr: number;          // annual rate, e.g. 0.189 = 18.9%
  minPayment: number;   // minor units per month
  isFocusDebt: boolean;
}

export interface EFInput {
  currentAmount: number;  // minor units
  targetMonths: number;   // default 3
}

export interface S2SInput {
  incomes: IncomeInput[];
  obligations: ObligationInput[];
  debts: DebtInput[];
  emergencyFund: EFInput;
  periodStartDate: Date;
  periodEndDate: Date;
  today: Date;
  totalExpensesInPeriod: number;   // minor units, all expenses so far
  todayExpenses: number;           // minor units, expenses today only
  isProratedStart: boolean;
  fullPeriodDays: number;          // days in a full (non-prorated) period
}

export interface S2SResult {
  // Period-level
  totalIncome: number;
  totalObligations: number;
  totalDebtPayments: number;     // min payments sum
  avalanchePool: number;         // extra towards focus debt
  efContribution: number;        // towards emergency fund
  reserve: number;               // buffer
  residual: number;              // income minus all deductions
  s2sPeriod: number;             // total safe to spend for period

  // Daily
  daysTotal: number;
  daysLeft: number;              // including today
  daysElapsed: number;
  s2sDaily: number;              // per-day limit (adjusted for carry-over)
  s2sToday: number;              // remaining today after expenses

  // Status
  status: 'OK' | 'WARNING' | 'OVERSPENT' | 'DEFICIT';
  s2sColor: 'green' | 'orange' | 'red';

  // Breakdown for display
  periodSpent: number;           // total expenses in period so far
  periodRemaining: number;       // s2sPeriod - periodSpent
}

// ── Helpers ────────────────────────────────────────────

/** Days between two dates (ceil, >= 1) */
export function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** Start of day (midnight) in local time */
export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// ── Core S2S Calculation ───────────────────────────────

export function calculateS2S(input: S2SInput): S2SResult {
  const {
    incomes,
    obligations,
    debts,
    emergencyFund,
    periodStartDate,
    periodEndDate,
    today,
    totalExpensesInPeriod,
    todayExpenses,
    isProratedStart,
    fullPeriodDays,
  } = input;

  // ── Time ──
  const daysTotal = daysBetween(periodStartDate, periodEndDate);
  const daysElapsed = daysBetween(periodStartDate, today);
  const daysLeft = Math.max(1, daysTotal - daysElapsed + 1); // including today

  // ── Income for period ──
  // Determine "trigger payday" = the payday that started this period.
  // E.g. paydays=[1,15], period ends Apr 1  → trigger=15 (received Mar 15).
  //      paydays=[1,15], period ends Apr 15 → trigger=1  (received Apr 1).
  // Only count incomes whose payday matches the trigger, so two separate
  // income entries (250k on 1st, 250k on 15th) each contribute only once
  // per their respective period — not both every period.
  const allPaydays = [...new Set(incomes.flatMap((inc) => inc.paydays))].sort((a, b) => a - b);
  const endDay = periodEndDate.getDate();
  const endDayIdx = allPaydays.indexOf(endDay);
  const triggerPayday = endDayIdx > 0
    ? allPaydays[endDayIdx - 1]
    : allPaydays[allPaydays.length - 1];

  const totalIncome = incomes.reduce((sum, inc) => {
    // If endDay doesn't match any known payday (e.g. after payday change), include all
    const hasTrigger = endDayIdx !== -1 ? inc.paydays.includes(triggerPayday) : true;
    if (!hasTrigger) return sum;
    // Single-record multi-payday income (e.g. one record with paydays=[1,15]):
    // divide monthly amount by payday count — each period gets one installment
    const payCount = Math.max(1, inc.paydays.length);
    return sum + Math.round(inc.amount / payCount);
  }, 0);

  // ── Obligations for period ──
  let totalObligations = obligations.reduce((sum, o) => sum + o.amount, 0);
  if (isProratedStart && fullPeriodDays > 0) {
    totalObligations = Math.round(totalObligations * (daysTotal / fullPeriodDays));
  }

  // ── Debt minimum payments ──
  const activeDebts = debts.filter((d) => d.balance > 0);
  let totalDebtPayments = activeDebts.reduce((sum, d) => sum + d.minPayment, 0);
  if (isProratedStart && fullPeriodDays > 0) {
    totalDebtPayments = Math.round(totalDebtPayments * (daysTotal / fullPeriodDays));
  }

  // ── Emergency Fund contribution ──
  const monthlyObligations = obligations.reduce((sum, o) => sum + o.amount, 0);
  const efTarget = monthlyObligations * emergencyFund.targetMonths;
  const efDeficit = Math.max(0, efTarget - emergencyFund.currentAmount);

  // ── Residual before EF and avalanche ──
  const afterFixed = totalIncome - totalObligations - totalDebtPayments;

  // ── Reserve (10% buffer, reduce if too tight) ──
  let reserveRate = 0.10;
  let reserve = Math.round(afterFixed * reserveRate);
  if (reserve < 0) reserve = 0;

  const afterReserve = afterFixed - reserve;

  // If reserve makes daily < 0, reduce
  if (afterReserve < 0 && afterFixed > 0) {
    reserveRate = 0.05;
    reserve = Math.round(afterFixed * reserveRate);
    if (afterFixed - reserve < 0) {
      reserve = 0;
    }
  }

  // ── EF contribution ──
  let efContribution = 0;
  const freePool = Math.max(0, afterFixed - reserve);

  if (efDeficit > 0 && freePool > 0) {
    // Contribute a portion towards EF — aim for 3-month target within ~12 months
    const monthlyEFGoal = Math.round(efDeficit / 12);
    let periodEFGoal = monthlyEFGoal;
    if (isProratedStart && fullPeriodDays > 0) {
      periodEFGoal = Math.round(monthlyEFGoal * (daysTotal / fullPeriodDays));
    }
    efContribution = Math.min(periodEFGoal, Math.round(freePool * 0.20)); // max 20% of free pool
    efContribution = Math.min(efContribution, efDeficit); // don't overshoot
  }

  // ── Avalanche pool ──
  let avalanchePool = 0;
  const focusDebt = activeDebts.find((d) => d.isFocusDebt);

  if (focusDebt && efDeficit <= 0) {
    // EF is funded — invest pool goes to avalanche
    const investPool = Math.max(0, freePool - efContribution);
    // High APR debts burn — allocate aggressively
    if (focusDebt.apr >= 0.18) {
      avalanchePool = Math.round(investPool * 0.50); // 50% of invest pool
    } else {
      avalanchePool = Math.round(investPool * 0.25); // 25% for lower APR
    }
    avalanchePool = Math.min(avalanchePool, focusDebt.balance); // don't overshoot balance
  } else if (focusDebt && focusDebt.apr >= 0.18) {
    // Even if EF not funded, high-APR debts take priority
    const investPool = Math.max(0, freePool - efContribution);
    avalanchePool = Math.round(investPool * 0.30);
    avalanchePool = Math.min(avalanchePool, focusDebt.balance);
  }

  // ── S2S calculation ──
  const residual = totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool;
  const s2sPeriod = Math.max(0, residual);

  // ── Daily with carry-over ──
  const periodRemaining = s2sPeriod - totalExpensesInPeriod;
  const s2sDaily = Math.max(0, Math.round(periodRemaining / daysLeft));
  const s2sToday = Math.max(0, s2sDaily - todayExpenses);

  // ── Status ──
  let status: S2SResult['status'] = 'OK';
  if (residual < 0) {
    status = 'DEFICIT';
  } else if (todayExpenses > s2sDaily) {
    status = 'OVERSPENT';
  } else if (s2sToday <= s2sDaily * 0.3) {
    status = 'WARNING';
  }

  // ── Color ──
  let s2sColor: S2SResult['s2sColor'] = 'green';
  if (status === 'DEFICIT' || status === 'OVERSPENT') {
    s2sColor = 'red';
  } else if (s2sDaily > 0 && s2sToday / s2sDaily <= 0.3) {
    s2sColor = 'red';
  } else if (s2sDaily > 0 && s2sToday / s2sDaily <= 0.7) {
    s2sColor = 'orange';
  }

  return {
    totalIncome,
    totalObligations,
    totalDebtPayments,
    avalanchePool,
    efContribution,
    reserve,
    residual,
    s2sPeriod,
    daysTotal,
    daysLeft,
    daysElapsed,
    s2sDaily,
    s2sToday,
    status,
    s2sColor,
    periodSpent: totalExpensesInPeriod,
    periodRemaining: Math.max(0, periodRemaining),
  };
}

// ── Period Boundaries ──────────────────────────────────

export interface PeriodBounds {
  start: Date;
  end: Date;
  daysTotal: number;
  fullPeriodDays: number;
  isProratedStart: boolean;
}

/**
 * Calculate period boundaries based on paydays.
 * Paydays define when income arrives (e.g. [15] or [5, 20]).
 */
export function calculatePeriodBounds(paydays: number[], fromDate: Date): PeriodBounds {
  const sorted = [...paydays].sort((a, b) => a - b);
  const day = fromDate.getDate();
  const month = fromDate.getMonth();
  const year = fromDate.getFullYear();

  if (sorted.length === 1) {
    const payday = sorted[0];
    let periodStart: Date;
    let periodEnd: Date;

    if (day >= payday) {
      // Current period started this month
      periodStart = new Date(year, month, payday);
      periodEnd = new Date(year, month + 1, payday);
    } else {
      // Current period started last month
      periodStart = new Date(year, month - 1, payday);
      periodEnd = new Date(year, month, payday);
    }

    const fullPeriodDays = daysBetween(periodStart, periodEnd);
    const isProrated = day !== payday;
    const actualStart = isProrated ? startOfDay(fromDate) : periodStart;

    return {
      start: actualStart,
      end: periodEnd,
      daysTotal: daysBetween(actualStart, periodEnd),
      fullPeriodDays,
      isProratedStart: isProrated,
    };
  }

  if (sorted.length === 2) {
    const [a, b] = sorted;
    let periodStart: Date;
    let periodEnd: Date;

    if (day >= b) {
      periodStart = new Date(year, month, b);
      periodEnd = new Date(year, month + 1, a);
    } else if (day >= a) {
      periodStart = new Date(year, month, a);
      periodEnd = new Date(year, month, b);
    } else {
      periodStart = new Date(year, month - 1, b);
      periodEnd = new Date(year, month, a);
    }

    const fullPeriodDays = daysBetween(periodStart, periodEnd);
    const isProrated = startOfDay(fromDate).getTime() !== periodStart.getTime();
    const actualStart = isProrated ? startOfDay(fromDate) : periodStart;

    return {
      start: actualStart,
      end: periodEnd,
      daysTotal: daysBetween(actualStart, periodEnd),
      fullPeriodDays,
      isProratedStart: isProrated,
    };
  }

  // Fallback: monthly from today
  const periodStart = startOfDay(fromDate);
  const periodEnd = new Date(year, month + 1, day);
  return {
    start: periodStart,
    end: periodEnd,
    daysTotal: daysBetween(periodStart, periodEnd),
    fullPeriodDays: daysBetween(periodStart, periodEnd),
    isProratedStart: false,
  };
}
