/**
 * Domain Finance — Type Definitions
 *
 * All money values: KOPECKS (minor units). Display layer divides by 100.
 * Income semantics: SEMANTICS_B (per-payout). See docs/INCOME_SEMANTICS.md.
 */

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface IncomeInput {
  id: string;
  /** Kopecks received per single payout occurrence (Semantics B). */
  amount: number;
  /** Days of month this income pays out. */
  paydays: number[];
  useRussianWorkCalendar: boolean;
}

export interface ObligationInput {
  id: string;
  /** Kopecks per month (rent, subscriptions, etc.). */
  amount: number;
  dueDay?: number | null;
}

export interface DebtInput {
  id: string;
  balance: number;      // kopecks remaining
  apr: number;          // e.g. 0.189 = 18.9%
  minPayment: number;   // kopecks per month
  dueDay?: number | null;
  isFocusDebt: boolean;
  isPaidOff: boolean;
}

export interface EFInput {
  currentAmount: number;  // kopecks
  targetMonths: number;   // default 3
}

export interface DebtPaymentEventInput {
  debtId: string;
  amountMinor: number;                                       // kopecks
  kind: 'REQUIRED_MIN_PAYMENT' | 'EXTRA_PRINCIPAL_PAYMENT';
}

// ── Computed period bounds ────────────────────────────────────────────────────

export interface ActualPeriodBounds {
  /** UTC instant = user's local midnight of period start. */
  start: Date;
  /** UTC instant = user's local midnight of period end (exclusive). */
  end: Date;
  daysTotal: number;
  /**
   * The nominal calendar payday that triggered this period's start.
   * E.g. March 13 actual payout (because Mar 15 = Sunday) → startNominalPayday = 15.
   * Used for income matching: income.paydays.includes(startNominalPayday).
   */
  startNominalPayday: number;
  /** Nominal payday that will start the NEXT period. */
  endNominalPayday: number;
  /** ISO debug trace: local date of period start as user sees it. */
  actualPayoutDateIso: string;
}

// ── Per-debt period summary ───────────────────────────────────────────────────

export interface DebtPeriodSummary {
  debtId: string;
  requiredMinForPeriod: number;        // kopecks
  paidRequiredThisPeriod: number;      // kopecks
  remainingRequiredThisPeriod: number; // kopecks = max(0, required - paid)
  status: 'PAID' | 'PARTIAL' | 'UNPAID' | 'NOT_DUE';
}

// ── All inputs for a single domain computation ───────────────────────────────

export interface FinanceDomainInputs {
  now: Date;
  tz: string;
  incomes: IncomeInput[];
  obligations: ObligationInput[];
  debts: DebtInput[];
  emergencyFund: EFInput | null;
  /** Sum of all expenses in the period (kopecks). */
  totalPeriodSpent: number;
  /** Sum of today's expenses only (kopecks). */
  todayTotal: number;
  /** REQUIRED_MIN_PAYMENT events that belong to this period. */
  debtPaymentEvents: DebtPaymentEventInput[];
}

// ── Computed S2S values ───────────────────────────────────────────────────────

export interface S2SComputed {
  // Income
  totalIncome: number;
  // Deductions
  totalObligations: number;
  /** = totalDebtPaymentsRemainingForPeriod used in this snapshot. */
  totalDebtPaymentsDeducted: number;
  reserve: number;
  efContribution: number;
  avalanchePool: number;
  /** = totalIncome - obligations - debtRemaining - reserve - ef - avalanche */
  s2sPeriod: number;
  // Daily
  periodRemaining: number;  // = max(0, s2sPeriod - totalPeriodSpent)
  s2sDaily: number;         // = round(periodRemaining / daysLeft)
  s2sToday: number;         // = max(0, s2sDaily - todayTotal)
}

// ── Full dashboard output ─────────────────────────────────────────────────────

export interface DashboardView {
  // Period bounds
  periodStartIso: string;
  periodEndIso: string;
  totalDays: number;
  dayNumber: number;
  daysLeft: number;

  // Finance snapshot
  totalIncome: number;
  totalObligations: number;
  /** Debt payment deduction used in current s2sPeriod snapshot. */
  totalDebtPaymentsDeducted: number;
  /** = sum of remainingRequiredThisPeriod across all debts (display field). */
  totalDebtPaymentsRemaining: number;
  reserve: number;
  efContribution: number;
  avalanchePool: number;
  s2sPeriod: number;
  totalPeriodSpent: number;
  periodRemaining: number;
  s2sDaily: number;
  s2sToday: number;

  // Status
  s2sStatus: 'OK' | 'WARNING' | 'OVERSPENT' | 'DEFICIT';
  s2sColor: 'green' | 'orange' | 'red';

  // Per-debt summaries
  debtSummaries: DebtPeriodSummary[];

  // Debug trace (never source of truth)
  _debug: {
    actualPayoutDateIso: string;
    startNominalPayday: number;
    endNominalPayday: number;
    tz: string;
    nowIso: string;
  };
}
