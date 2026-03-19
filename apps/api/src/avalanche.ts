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
