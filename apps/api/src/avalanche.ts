/**
 * Avalanche Debt Repayment Strategy
 *
 * Rules:
 * 1. Focus on debt with highest APR
 * 2. On equal APR, pick smaller balance
 * 3. Free pool goes to focus debt as extra payment
 * 4. When focus debt paid off, move to next
 */

export interface AvalancheDebt {
  id: string;
  title: string;
  balance: number;     // minor units
  apr: number;         // e.g. 0.189
  minPayment: number;  // minor units/month
  type: string;
}

export interface AvalanchePlanItem {
  debtId: string;
  title: string;
  balance: number;
  apr: number;
  minPayment: number;
  isFocus: boolean;
  order: number;                  // 1 = first to pay off
  estimatedMonths: number;        // rough estimate
  totalInterest: number;          // estimated total interest
}

export interface AvalanchePlan {
  items: AvalanchePlanItem[];
  totalDebt: number;
  totalMinPayments: number;
  estimatedDebtFreeMonths: number;
  estimatedTotalInterest: number;
}

/**
 * Determine which debt should be the focus (avalanche target).
 * Returns debt ID or null if no debts.
 */
export function determineFocusDebt(debts: AvalancheDebt[]): string | null {
  const active = debts.filter((d) => d.balance > 0);
  if (active.length === 0) return null;

  // Sort: highest APR first, then smallest balance
  const sorted = [...active].sort((a, b) => {
    if (b.apr !== a.apr) return b.apr - a.apr;
    return a.balance - b.balance;
  });

  return sorted[0].id;
}

// ── Strategy Engine ──────────────────────────────────────────────────────────

export type PayoffStatus =
  | 'OK'
  | 'NO_MIN_PAYMENT'
  | 'PAYMENT_TOO_SMALL'
  | 'UNDEFINED_HORIZON'
  | 'PAID_OFF';

export interface AccelerateScenario {
  extraPerMonth: number;         // minor units
  estimatedMonths: number | null;
  monthsSavedVsBaseline: number | null;
  totalInterest: number | null;
  interestSavedVsBaseline: number | null;
  status: 'OK' | 'NOT_APPLICABLE' | 'UNDEFINED_HORIZON';
}

export interface DebtStrategyItem {
  debtId: string;
  title: string;
  balance: number;
  apr: number;
  minPayment: number;
  isFocus: boolean;
  payoffStatus: PayoffStatus;
  display: {
    primaryAction: string;
    secondaryAction: string | null;
    forecastLabel: string | null;
    warningLabel: string | null;
  };
  baseline: {
    estimatedMonths: number | null;
    totalInterest: number | null;
    monthlyPaymentUsed: number | null;
    extraPaymentUsed: number | null;
  };
  accelerateScenarios: AccelerateScenario[];
}

export interface DebtStrategy {
  currency: string;
  focusDebtId: string | null;
  generatedAt: string;
  items: DebtStrategyItem[];
  summary: {
    totalDebt: number;
    totalMinPayments: number;
    estimatedDebtFreeMonths: number | null;
    estimatedTotalInterest: number | null;
  };
}

function simulatePayoff(
  balance: number,
  apr: number,
  monthlyPayment: number,
): { months: number | null; totalInterest: number | null; status: PayoffStatus } {
  if (balance <= 0) return { months: 0, totalInterest: 0, status: 'OK' };
  if (monthlyPayment <= 0) return { months: null, totalInterest: null, status: 'NO_MIN_PAYMENT' };

  if (apr === 0) {
    const months = Math.ceil(balance / monthlyPayment);
    if (months > 360) return { months: null, totalInterest: 0, status: 'UNDEFINED_HORIZON' };
    return { months, totalInterest: 0, status: 'OK' };
  }

  const monthlyRate = apr / 12;
  const firstMonthInterest = Math.round(balance * monthlyRate);
  if (monthlyPayment <= firstMonthInterest) {
    return { months: null, totalInterest: null, status: 'PAYMENT_TOO_SMALL' };
  }

  let bal = balance;
  let months = 0;
  let totalInterest = 0;

  while (bal > 0 && months < 600) {
    const monthInterest = Math.round(bal * monthlyRate);
    totalInterest += monthInterest;
    bal = bal + monthInterest - monthlyPayment;
    months++;
    if (bal <= 0) break;
  }

  if (months >= 600 && bal > 0) {
    return { months: null, totalInterest: null, status: 'UNDEFINED_HORIZON' };
  }

  return { months, totalInterest, status: 'OK' };
}

// Acceleration scenarios: +5 000 ₽ and +10 000 ₽ per month (in kopecks)
const ACCELERATE_EXTRAS = [500_000, 1_000_000];

export function buildDebtStrategy(
  debts: Array<{
    id: string;
    title: string;
    balance: number;
    apr: number;
    minPayment: number;
    isFocusDebt: boolean;
    isPaidOff: boolean;
  }>,
  avalanchePoolMinor: number,
  daysTotal: number,
  currency: string,
): DebtStrategy {
  const active = debts.filter((d) => !d.isPaidOff && d.balance > 0);
  const generatedAt = new Date().toISOString();

  if (active.length === 0) {
    return {
      currency,
      focusDebtId: null,
      generatedAt,
      items: [],
      summary: { totalDebt: 0, totalMinPayments: 0, estimatedDebtFreeMonths: null, estimatedTotalInterest: null },
    };
  }

  // Canonical sort: highest APR, then smallest balance
  const sorted = [...active].sort((a, b) => {
    if (b.apr !== a.apr) return b.apr - a.apr;
    return a.balance - b.balance;
  });

  const focusDebt = sorted[0];

  // Exact monthly extra from current period avalanchePool
  const exactMonthlyExtra = daysTotal > 0
    ? Math.round(avalanchePoolMinor / Math.max(1, daysTotal / 30))
    : 0;

  const items: DebtStrategyItem[] = sorted.map((debt) => {
    const isFocus = debt.id === focusDebt.id;
    const extraPayment = isFocus ? exactMonthlyExtra : 0;
    const baselinePayment = debt.minPayment + extraPayment;

    const { months, totalInterest, status } = simulatePayoff(debt.balance, debt.apr, baselinePayment);

    let forecastLabel: string | null = null;
    let warningLabel: string | null = null;

    if (status === 'OK' && months !== null) {
      forecastLabel = `~${months} мес. до закрытия`;
    } else if (status === 'NO_MIN_PAYMENT') {
      warningLabel = 'Укажи ежемесячный платёж';
    } else if (status === 'PAYMENT_TOO_SMALL') {
      warningLabel = 'Платёж слишком мал: долг не уменьшается';
    } else if (status === 'UNDEFINED_HORIZON') {
      warningLabel = 'Срок не определён при текущем платеже';
    }

    const accelerateScenarios: AccelerateScenario[] = isFocus
      ? ACCELERATE_EXTRAS.map((scenarioExtra) => {
          const { months: sMonths, totalInterest: sInterest, status: sStatus } = simulatePayoff(
            debt.balance,
            debt.apr,
            baselinePayment + scenarioExtra,
          );
          return {
            extraPerMonth: scenarioExtra,
            estimatedMonths: sMonths,
            monthsSavedVsBaseline: status === 'OK' && months !== null && sStatus === 'OK' && sMonths !== null ? months - sMonths : null,
            totalInterest: sInterest,
            interestSavedVsBaseline: totalInterest !== null && sInterest !== null ? totalInterest - sInterest : null,
            status: sStatus === 'OK' ? 'OK' : sStatus === 'UNDEFINED_HORIZON' ? 'UNDEFINED_HORIZON' : 'NOT_APPLICABLE',
          } as AccelerateScenario;
        })
      : [];

    const extraLabel = isFocus && extraPayment > 0
      ? `Уже резервируется на ускорение: ~${Math.round(extraPayment / 100).toLocaleString('ru-RU')} ₽/мес`
      : null;

    return {
      debtId: debt.id,
      title: debt.title,
      balance: debt.balance,
      apr: debt.apr,
      minPayment: debt.minPayment,
      isFocus,
      payoffStatus: status,
      display: {
        primaryAction: isFocus ? 'Все свободные деньги сверх минимума — сюда' : 'Сейчас не приоритет',
        secondaryAction: extraLabel,
        forecastLabel,
        warningLabel,
      },
      baseline: {
        estimatedMonths: months,
        totalInterest,
        monthlyPaymentUsed: baselinePayment,
        extraPaymentUsed: isFocus ? extraPayment : null,
      },
      accelerateScenarios,
    };
  });

  // Sequential avalanche summary
  let estimatedDebtFreeMonths: number | null = 0;
  let estimatedTotalInterest: number | null = 0;
  let rollingExtra = exactMonthlyExtra;

  for (let i = 0; i < sorted.length; i++) {
    const debt = sorted[i];
    const payment = debt.minPayment + rollingExtra;
    const { months, totalInterest: interest, status } = simulatePayoff(debt.balance, debt.apr, payment);

    if (status !== 'OK' || months === null) {
      estimatedDebtFreeMonths = null;
      estimatedTotalInterest = null;
      break;
    }

    estimatedDebtFreeMonths = (estimatedDebtFreeMonths ?? 0) + months;
    estimatedTotalInterest = (estimatedTotalInterest ?? 0) + (interest ?? 0);
    rollingExtra += debt.minPayment;
  }

  return {
    currency,
    focusDebtId: focusDebt.id,
    generatedAt,
    items,
    summary: {
      totalDebt: active.reduce((s, d) => s + d.balance, 0),
      totalMinPayments: active.reduce((s, d) => s + d.minPayment, 0),
      estimatedDebtFreeMonths,
      estimatedTotalInterest,
    },
  };
}

// ── Avalanche Plan (legacy approximate) ──────────────────────────────────────

/**
 * Build full avalanche repayment plan.
 * Shows order of payoff with estimated months and interest.
 *
 * @param debts - active debts
 * @param monthlyExtra - how much extra per month can go to focus debt
 */
export function buildAvalanchePlan(
  debts: AvalancheDebt[],
  monthlyExtra: number
): AvalanchePlan {
  const active = debts.filter((d) => d.balance > 0);

  if (active.length === 0) {
    return {
      items: [],
      totalDebt: 0,
      totalMinPayments: 0,
      estimatedDebtFreeMonths: 0,
      estimatedTotalInterest: 0,
    };
  }

  // Sort: highest APR first, then smallest balance
  const sorted = [...active].sort((a, b) => {
    if (b.apr !== a.apr) return b.apr - a.apr;
    return a.balance - b.balance;
  });

  const items: AvalanchePlanItem[] = [];
  let rollingExtra = monthlyExtra;
  let totalMonths = 0;
  let totalInterest = 0;

  for (let i = 0; i < sorted.length; i++) {
    const debt = sorted[i];
    const monthlyRate = debt.apr / 12;
    const payment = debt.minPayment + (i === 0 ? rollingExtra : 0);

    let balance = debt.balance;
    let months = 0;
    let interest = 0;

    if (payment <= 0) {
      // Can't pay — infinite
      months = 999;
    } else {
      // Simulate payoff
      while (balance > 0 && months < 600) {
        const monthInterest = Math.round(balance * monthlyRate);
        interest += monthInterest;
        balance = balance + monthInterest - payment;
        months++;

        if (balance <= 0) break;
      }
    }

    items.push({
      debtId: debt.id,
      title: debt.title,
      balance: debt.balance,
      apr: debt.apr,
      minPayment: debt.minPayment,
      isFocus: i === 0,
      order: i + 1,
      estimatedMonths: months,
      totalInterest: interest,
    });

    // After this debt is paid off, its min payment frees up for the next
    if (i === 0) {
      rollingExtra = rollingExtra + debt.minPayment;
    } else {
      rollingExtra = rollingExtra + debt.minPayment;
    }

    totalInterest += interest;
    totalMonths = Math.max(totalMonths, months); // parallel estimate — simplified
  }

  // Sequential total: sum of months (simplified — actual is less due to snowball effect)
  const sequentialMonths = items.reduce((sum, item) => sum + item.estimatedMonths, 0);

  return {
    items,
    totalDebt: active.reduce((sum, d) => sum + d.balance, 0),
    totalMinPayments: active.reduce((sum, d) => sum + d.minPayment, 0),
    estimatedDebtFreeMonths: sequentialMonths,
    estimatedTotalInterest: totalInterest,
  };
}
