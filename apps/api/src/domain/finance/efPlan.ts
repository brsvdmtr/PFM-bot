/**
 * efPlan.ts — Emergency Fund Plan calculations
 *
 * Pure functions for computing savings scenarios, feasibility,
 * and plan progress. No DB, no side effects.
 */

export interface EFPlanInputs {
  targetAmount: number;           // minor units
  currentAmount: number;          // minor units (sum of included buckets)
  monthlyIncomeBase: number;      // minor units (net monthly income)
  monthlyRequiredExpenses: number; // minor units (sum of active obligations)
  contributionFrequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';
  targetDeadlineAt: Date | null;
  preferredPace: 'GENTLE' | 'OPTIMAL' | 'AGGRESSIVE' | null;
  now: Date;
}

export interface EFScenario {
  pace: 'GENTLE' | 'OPTIMAL' | 'AGGRESSIVE';
  contributionAmount: number;     // per frequency, minor units
  frequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';
  projectedMonthsToTarget: number | null;
  projectedTargetDate: string | null;
  loadPctOfFreeCashflow: number | null;
  status: 'RECOMMENDED' | 'AVAILABLE' | 'TOO_SLOW' | 'HARD';
}

export interface EFPlanResult {
  targetAmount: number;
  currentAmount: number;
  remainingGap: number;
  monthlyFreeCashflow: number;
  targetDeadlineAt: string | null;
  requiredContribution: {
    frequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';
    amount: number;
  } | null;
  feasibility: 'REALISTIC' | 'TIGHT' | 'UNREALISTIC' | null;
  scenarios: EFScenario[];
  message: string | null;
}

const PACE_FACTORS = {
  GENTLE: 0.25,
  OPTIMAL: 0.50,
  AGGRESSIVE: 0.75,
} as const;

const AVG_MONTH_DAYS = 30.44;

export function computeEFPlan(inputs: EFPlanInputs): EFPlanResult {
  const {
    targetAmount, currentAmount, monthlyIncomeBase,
    monthlyRequiredExpenses, contributionFrequency,
    targetDeadlineAt, now,
  } = inputs;

  const remainingGap = Math.max(0, targetAmount - currentAmount);
  const monthlyFreeCashflow = Math.max(0, monthlyIncomeBase - monthlyRequiredExpenses);

  // Already achieved
  if (remainingGap === 0) {
    return {
      targetAmount, currentAmount, remainingGap, monthlyFreeCashflow,
      targetDeadlineAt: targetDeadlineAt?.toISOString() ?? null,
      requiredContribution: null,
      feasibility: 'REALISTIC',
      scenarios: [],
      message: 'Цель достигнута!',
    };
  }

  // Compute required contribution for deadline
  let requiredContribution: EFPlanResult['requiredContribution'] = null;
  let feasibility: EFPlanResult['feasibility'] = null;

  if (targetDeadlineAt) {
    const deadlineDays = Math.max(1, Math.ceil((targetDeadlineAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const deadlineMonths = Math.max(1, Math.ceil(deadlineDays / AVG_MONTH_DAYS));
    const deadlineWeeks = Math.max(1, Math.ceil(deadlineDays / 7));
    const deadlineBiweekly = Math.max(1, Math.ceil(deadlineDays / 14));

    let reqAmount: number;
    if (contributionFrequency === 'WEEKLY') {
      reqAmount = Math.ceil(remainingGap / deadlineWeeks);
    } else if (contributionFrequency === 'BIWEEKLY') {
      reqAmount = Math.ceil(remainingGap / deadlineBiweekly);
    } else {
      reqAmount = Math.ceil(remainingGap / deadlineMonths);
    }

    requiredContribution = { frequency: contributionFrequency, amount: reqAmount };

    // Convert required to monthly equivalent for feasibility check
    const reqMonthly = contributionFrequency === 'WEEKLY'
      ? reqAmount * 4.33
      : contributionFrequency === 'BIWEEKLY'
        ? reqAmount * 2.17
        : reqAmount;

    const optimalContribution = Math.floor(monthlyFreeCashflow * PACE_FACTORS.OPTIMAL);
    const aggressiveContribution = Math.floor(monthlyFreeCashflow * PACE_FACTORS.AGGRESSIVE);

    if (monthlyFreeCashflow <= 0) {
      feasibility = 'UNREALISTIC';
    } else if (reqMonthly <= optimalContribution) {
      feasibility = 'REALISTIC';
    } else if (reqMonthly <= aggressiveContribution) {
      feasibility = 'TIGHT';
    } else {
      feasibility = 'UNREALISTIC';
    }
  }

  // Build 3 scenarios
  const scenarios: EFScenario[] = (['GENTLE', 'OPTIMAL', 'AGGRESSIVE'] as const).map((pace) => {
    const monthlyContribution = Math.floor(monthlyFreeCashflow * PACE_FACTORS[pace]);

    let contributionAmount: number;
    if (contributionFrequency === 'WEEKLY') {
      contributionAmount = Math.round(monthlyContribution / 4.33);
    } else if (contributionFrequency === 'BIWEEKLY') {
      contributionAmount = Math.round(monthlyContribution / 2.17);
    } else {
      contributionAmount = monthlyContribution;
    }

    const projectedMonths = monthlyContribution > 0
      ? Math.ceil(remainingGap / monthlyContribution)
      : null;

    let projectedTargetDate: string | null = null;
    if (projectedMonths !== null) {
      const d = new Date(now);
      d.setMonth(d.getMonth() + projectedMonths);
      projectedTargetDate = d.toISOString();
    }

    const loadPct = monthlyFreeCashflow > 0
      ? Math.round(monthlyContribution * 100 / monthlyFreeCashflow)
      : null;

    let status: EFScenario['status'];
    if (pace === 'OPTIMAL') {
      status = 'RECOMMENDED';
    } else if (pace === 'AGGRESSIVE') {
      status = monthlyContribution > 0 ? 'HARD' : 'AVAILABLE';
    } else {
      // GENTLE
      status = projectedMonths !== null && projectedMonths > 120 ? 'TOO_SLOW' : 'AVAILABLE';
    }

    return {
      pace,
      contributionAmount,
      frequency: contributionFrequency,
      projectedMonthsToTarget: projectedMonths,
      projectedTargetDate,
      loadPctOfFreeCashflow: loadPct,
      status,
    };
  });

  // Message
  let message: string | null = null;
  if (feasibility === 'UNREALISTIC' && requiredContribution) {
    message = `Чтобы достичь цели к выбранной дате, нужно откладывать ${Math.round(requiredContribution.amount / 100).toLocaleString('ru-RU')} ₽/${freqLabel(contributionFrequency)}, что превышает доступный ресурс.`;
  } else if (monthlyFreeCashflow <= 0) {
    message = 'Свободного денежного потока недостаточно для накоплений.';
  }

  return {
    targetAmount, currentAmount, remainingGap, monthlyFreeCashflow,
    targetDeadlineAt: targetDeadlineAt?.toISOString() ?? null,
    requiredContribution, feasibility, scenarios, message,
  };
}

function freqLabel(f: string): string {
  return f === 'WEEKLY' ? 'нед.' : f === 'BIWEEKLY' ? '2 нед.' : 'мес.';
}

/**
 * Compute target amount based on mode.
 */
export function computeTargetAmount(
  targetMode: 'BY_SALARY' | 'BY_EXPENSES' | 'MANUAL',
  baseMonthlyAmount: number | null,
  targetMonths: number | null,
  manualTargetAmount: number | null,
  monthlyRequiredExpenses: number,
): number {
  if (targetMode === 'MANUAL' && manualTargetAmount != null) {
    return Math.max(0, manualTargetAmount);
  }
  if (targetMode === 'BY_EXPENSES') {
    return Math.max(0, monthlyRequiredExpenses * (targetMonths ?? 3));
  }
  // BY_SALARY (default)
  return Math.max(0, (baseMonthlyAmount ?? 0) * (targetMonths ?? 3));
}
