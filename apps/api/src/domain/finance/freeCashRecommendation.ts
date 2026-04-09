/**
 * freeCashRecommendation.ts — Free Cash Allocation Recommendation
 *
 * Pure function: given a user's current EF state + debts + a windfall amount,
 * recommends how to split it between Emergency Fund and debt prepayment.
 *
 * Decision tree (ordered, first-match wins):
 *   1. amount < minSignificantMinor            → NO_SIGNIFICANT_AMOUNT (skip flow)
 *   2. no active debts                         → EMERGENCY_FUND (NO_DEBT)
 *   3. EF < protectiveThresholdMonths          → EMERGENCY_FUND (EF_PROTECTIVE)
 *   4. EF fully funded (>= target)             → DEBT_PREPAY (EF_FULLY_FUNDED)
 *   5. has debt with APR >= highAprThreshold   → DEBT_PREPAY (HIGH_APR_DEBT)
 *   6. otherwise (moderate EF + moderate APR)  → SPLIT (BALANCED_SPLIT)
 *
 * All money values: KOPECKS (minor units).
 * No DB, no side effects, no i18n — UI layer handles strings.
 *
 * See docs/FREE_CASH_RECOMMENDATION.md (TODO) for the full rationale.
 */

import { simulatePayoff } from '../../avalanche';

// ── Config ───────────────────────────────────────────────────────────────────

export interface FreeCashConfig {
  /** EF < N × monthlyEssentials → protect EF baseline (prefer EF-only). */
  protectiveThresholdMonths: number;
  /** APR >= N → "high APR" debt; free cash should kill it before topping up EF. */
  highAprThreshold: number;
  /** SPLIT mode default: share going to EF (0..1). Remainder → debt. */
  splitEfShare: number;
  /** Amounts below this threshold skip the whole recommendation flow. */
  minSignificantMinor: number;
}

export const DEFAULT_CONFIG: FreeCashConfig = {
  protectiveThresholdMonths: 1,
  highAprThreshold: 0.18,
  splitEfShare: 0.5,
  minSignificantMinor: 100_000, // 1000 ₽
};

// ── Types ────────────────────────────────────────────────────────────────────

export type FreeCashMode = 'EMERGENCY_FUND' | 'DEBT_PREPAY' | 'SPLIT';

export type FreeCashReasonCode =
  | 'NO_SIGNIFICANT_AMOUNT'  // amount too small to recommend anything
  | 'NO_DEBT'                // no debts → EF is the only useful home
  | 'EF_PROTECTIVE'          // EF below protective threshold → protect it first
  | 'EF_FULLY_FUNDED'        // EF at/above target → extra goes to debt
  | 'HIGH_APR_DEBT'          // has a debt with APR >= threshold → kill it
  | 'BALANCED_SPLIT';        // moderate EF + moderate APR → split

export interface FreeCashDebtInput {
  id: string;
  title: string;
  balance: number;       // kopecks
  apr: number;           // e.g. 0.189
  minPayment: number;    // kopecks/month (0 if not set)
  isFocusDebt: boolean;
  isPaidOff: boolean;
}

export interface FreeCashInput {
  /** Windfall amount (kopecks) the user wants to allocate. */
  amountMinor: number;
  /** Current EF balance (kopecks). */
  efCurrentMinor: number;
  /** EF target (kopecks). 0 = no target set. */
  efTargetMinor: number;
  /** Monthly obligations baseline (kopecks). Used for EF coverage math. */
  monthlyEssentialsMinor: number;
  /** All user debts. Inactive/paid-off debts are filtered internally. */
  debts: FreeCashDebtInput[];
}

export interface FreeCashEffect {
  /** Distribution of this amount across targets. */
  toEmergencyFundMinor: number;
  toDebtMinor: number;
  /** EF coverage in essentials-months, before and after. null if essentials = 0. */
  efMonthsBefore: number | null;
  efMonthsAfter: number | null;
  /** Focus debt projection. All null if no focus debt. */
  focusDebtId: string | null;
  focusDebtTitle: string | null;
  focusDebtBalanceBefore: number | null;
  focusDebtBalanceAfter: number | null;
  /** Months to pay off focus debt with just minPayment (no windfall). */
  baselinePayoffMonths: number | null;
  /** Months to pay off focus debt AFTER applying `toDebtMinor` as a lump sum. */
  acceleratedPayoffMonths: number | null;
  monthsSaved: number | null;
  interestSavedMinor: number | null;
  /**
   * Status hint about the debt payoff simulation. Non-OK means UI should
   * hide "months/interest saved" labels because the comparison isn't meaningful.
   */
  payoffStatus: 'OK' | 'NO_MIN_PAYMENT' | 'PAYMENT_TOO_SMALL' | 'UNDEFINED_HORIZON' | 'PAID_OFF' | 'NO_DEBT';
}

export interface FreeCashAlternative {
  mode: FreeCashMode;
  effect: FreeCashEffect;
}

export interface FreeCashRecommendation {
  /** The mode being previewed (default from decision tree OR from override). */
  mode: FreeCashMode;
  /** The mode the decision tree would have picked without overrides. */
  defaultMode: FreeCashMode;
  /** Why the default was picked — stable enum, UI maps to i18n copy. */
  reasonCode: FreeCashReasonCode;
  /** Effect for `mode` (the one being previewed). */
  primaryEffect: FreeCashEffect;
  /** Other available modes the user can switch to. */
  alternatives: FreeCashAlternative[];
  /** Current split (0..1). Matches config.splitEfShare unless overridden. */
  splitEfShare: number;
  /** True if amount < config.minSignificantMinor. UI skips the whole flow. */
  belowThreshold: boolean;
}

export interface RecommendOverride {
  /** Force a specific mode (e.g. user flipped to SPLIT manually). */
  mode?: FreeCashMode;
  /** Override split share for SPLIT mode (0..1). */
  splitEfShare?: number;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function pickFocusDebt(debts: FreeCashDebtInput[]): FreeCashDebtInput | null {
  const active = debts.filter((d) => !d.isPaidOff && d.balance > 0);
  if (active.length === 0) return null;

  // Same ordering as avalanche.ts: highest APR first, then smallest balance.
  const sorted = [...active].sort((a, b) => {
    if (b.apr !== a.apr) return b.apr - a.apr;
    return a.balance - b.balance;
  });
  return sorted[0];
}

function efMonthsCoverage(balanceMinor: number, monthlyEssentialsMinor: number): number | null {
  if (monthlyEssentialsMinor <= 0) return null;
  return balanceMinor / monthlyEssentialsMinor;
}

/** Compute the distribution (toEf, toDebt) for a given mode + split. */
function distribute(
  amountMinor: number,
  mode: FreeCashMode,
  splitEfShare: number,
  maxDebtPrepay: number,
): { toEf: number; toDebt: number } {
  if (mode === 'EMERGENCY_FUND') {
    return { toEf: amountMinor, toDebt: 0 };
  }
  if (mode === 'DEBT_PREPAY') {
    // Cap debt prepay at focus debt balance. Leftover does nothing (per decision Q2).
    return { toEf: 0, toDebt: Math.min(amountMinor, maxDebtPrepay) };
  }
  // SPLIT — EF gets its share, debt side is capped at focus balance.
  const clampedShare = Math.max(0, Math.min(1, splitEfShare));
  const rawToEf = Math.round(amountMinor * clampedShare);
  const rawToDebt = amountMinor - rawToEf;
  const toDebt = Math.min(rawToDebt, maxDebtPrepay);
  // EF side: keep rawToEf even if debt side was clamped (the leftover just vanishes per Q2).
  return { toEf: rawToEf, toDebt };
}

/** Pure effect computation for a given (mode, split). No side effects. */
export function computeFreeCashEffect(
  input: FreeCashInput,
  mode: FreeCashMode,
  splitEfShare: number,
): FreeCashEffect {
  const { amountMinor, efCurrentMinor, monthlyEssentialsMinor, debts } = input;
  const focus = pickFocusDebt(debts);
  const maxDebtPrepay = focus ? focus.balance : 0;
  const { toEf, toDebt } = distribute(amountMinor, mode, splitEfShare, maxDebtPrepay);

  const efBefore = efMonthsCoverage(efCurrentMinor, monthlyEssentialsMinor);
  const efAfter = efMonthsCoverage(efCurrentMinor + toEf, monthlyEssentialsMinor);

  // No focus debt → only EF effect matters.
  if (!focus) {
    return {
      toEmergencyFundMinor: toEf,
      toDebtMinor: toDebt,
      efMonthsBefore: efBefore,
      efMonthsAfter: efAfter,
      focusDebtId: null,
      focusDebtTitle: null,
      focusDebtBalanceBefore: null,
      focusDebtBalanceAfter: null,
      baselinePayoffMonths: null,
      acceleratedPayoffMonths: null,
      monthsSaved: null,
      interestSavedMinor: null,
      payoffStatus: 'NO_DEBT',
    };
  }

  // Baseline: current balance, only minPayment (no lump sum).
  const baseline = simulatePayoff(focus.balance, focus.apr, focus.minPayment);
  const reducedBalance = Math.max(0, focus.balance - toDebt);
  const accelerated = reducedBalance === 0
    ? { months: 0, totalInterest: 0, status: 'OK' as const }
    : simulatePayoff(reducedBalance, focus.apr, focus.minPayment);

  // Months / interest saved are meaningful only when both simulations are OK.
  const bothOk = baseline.status === 'OK' && accelerated.status === 'OK';
  const monthsSaved = bothOk && baseline.months !== null && accelerated.months !== null
    ? Math.max(0, baseline.months - accelerated.months)
    : null;
  const interestSaved = bothOk && baseline.totalInterest !== null && accelerated.totalInterest !== null
    ? Math.max(0, baseline.totalInterest - accelerated.totalInterest)
    : null;

  // Prefer baseline status — that's what the user sees as the "from" side.
  // If baseline is OK but accelerated wasn't computed (should not happen) we
  // still surface OK so the UI shows the before/after balances.
  const payoffStatus = baseline.status;

  return {
    toEmergencyFundMinor: toEf,
    toDebtMinor: toDebt,
    efMonthsBefore: efBefore,
    efMonthsAfter: efAfter,
    focusDebtId: focus.id,
    focusDebtTitle: focus.title,
    focusDebtBalanceBefore: focus.balance,
    focusDebtBalanceAfter: reducedBalance,
    baselinePayoffMonths: baseline.months,
    acceleratedPayoffMonths: accelerated.months,
    monthsSaved,
    interestSavedMinor: interestSaved,
    payoffStatus,
  };
}

/** Pure mode picker — runs the decision tree. */
function recommendMode(
  input: FreeCashInput,
  config: FreeCashConfig,
): { mode: FreeCashMode; reasonCode: FreeCashReasonCode } {
  const { amountMinor, efCurrentMinor, efTargetMinor, monthlyEssentialsMinor, debts } = input;

  if (amountMinor < config.minSignificantMinor) {
    return { mode: 'EMERGENCY_FUND', reasonCode: 'NO_SIGNIFICANT_AMOUNT' };
  }

  const activeDebts = debts.filter((d) => !d.isPaidOff && d.balance > 0);
  if (activeDebts.length === 0) {
    return { mode: 'EMERGENCY_FUND', reasonCode: 'NO_DEBT' };
  }

  const efMonths = efMonthsCoverage(efCurrentMinor, monthlyEssentialsMinor);
  // EF is "protective-low" only when we can measure coverage and it's below threshold.
  // If monthlyEssentials is 0 we can't say anything → skip this branch.
  if (efMonths !== null && efMonths < config.protectiveThresholdMonths) {
    return { mode: 'EMERGENCY_FUND', reasonCode: 'EF_PROTECTIVE' };
  }

  const efFullyFunded = efTargetMinor > 0 && efCurrentMinor >= efTargetMinor;
  if (efFullyFunded) {
    return { mode: 'DEBT_PREPAY', reasonCode: 'EF_FULLY_FUNDED' };
  }

  const focus = pickFocusDebt(activeDebts);
  const hasHighApr = focus !== null && focus.apr >= config.highAprThreshold;
  if (hasHighApr) {
    return { mode: 'DEBT_PREPAY', reasonCode: 'HIGH_APR_DEBT' };
  }

  return { mode: 'SPLIT', reasonCode: 'BALANCED_SPLIT' };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Full recommendation: default mode, reason, primary effect, alternatives.
 *
 * Override usage:
 *   - Leave override empty → use decision tree + default split.
 *   - Provide `mode` → compute effect for that mode instead of the default.
 *     `defaultMode` + `reasonCode` still reflect the tree's original pick.
 *   - Provide `splitEfShare` → use that share instead of `config.splitEfShare`.
 *
 * Alternatives always show the other usable modes (not impossible ones) with
 * their effects — UI uses them to power instant mode-switch previews.
 */
export function recommendFreeCash(
  input: FreeCashInput,
  override: RecommendOverride = {},
  config: FreeCashConfig = DEFAULT_CONFIG,
): FreeCashRecommendation {
  const { amountMinor, debts } = input;
  const activeDebts = debts.filter((d) => !d.isPaidOff && d.balance > 0);

  // Short-circuit: below threshold → single trivial effect, no alternatives.
  if (amountMinor < config.minSignificantMinor) {
    const effect = computeFreeCashEffect(input, 'EMERGENCY_FUND', config.splitEfShare);
    return {
      mode: 'EMERGENCY_FUND',
      defaultMode: 'EMERGENCY_FUND',
      reasonCode: 'NO_SIGNIFICANT_AMOUNT',
      primaryEffect: effect,
      alternatives: [],
      splitEfShare: config.splitEfShare,
      belowThreshold: true,
    };
  }

  const { mode: defaultMode, reasonCode } = recommendMode(input, config);

  // Sanitize split share: must be 0..1.
  const rawShare = override.splitEfShare ?? config.splitEfShare;
  const splitEfShare = Math.max(0, Math.min(1, rawShare));

  // Sanitize override mode: if user forces DEBT_PREPAY / SPLIT but has no debts,
  // silently fall back to EMERGENCY_FUND. Otherwise honour the override.
  let mode = override.mode ?? defaultMode;
  if ((mode === 'DEBT_PREPAY' || mode === 'SPLIT') && activeDebts.length === 0) {
    mode = 'EMERGENCY_FUND';
  }

  const primaryEffect = computeFreeCashEffect(input, mode, splitEfShare);

  // Build alternatives — other usable modes only.
  const allModes: FreeCashMode[] = ['EMERGENCY_FUND', 'DEBT_PREPAY', 'SPLIT'];
  const alternatives: FreeCashAlternative[] = [];
  for (const altMode of allModes) {
    if (altMode === mode) continue;
    if ((altMode === 'DEBT_PREPAY' || altMode === 'SPLIT') && activeDebts.length === 0) continue;
    alternatives.push({
      mode: altMode,
      effect: computeFreeCashEffect(input, altMode, splitEfShare),
    });
  }

  return {
    mode,
    defaultMode,
    reasonCode,
    primaryEffect,
    alternatives,
    splitEfShare,
    belowThreshold: false,
  };
}
