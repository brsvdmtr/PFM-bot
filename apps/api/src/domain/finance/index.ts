/**
 * domain/finance — Public API
 *
 * Entry point for tests (runFinanceDomain) and for route handlers (buildDashboardView, rebuildActivePeriodSnapshot).
 *
 * Tests import runFinanceDomain directly — no DB, pure computation.
 * Route handlers import buildDashboardView + rebuildActivePeriodSnapshot.
 */

export { buildDashboardView } from './buildDashboardView';
export { rebuildActivePeriodSnapshot } from './rebuildSnapshot';
export { calculateActualPeriodBounds } from './buildActualPayPeriods';
export { effectiveLocalDateInPeriod } from './matchEventsToPeriod';
export { computeS2S } from './computeS2S';
export type {
  FinanceDomainInputs,
  DashboardView,
  ActualPeriodBounds,
  DebtPeriodSummary,
  S2SComputed,
  IncomeInput,
  ObligationInput,
  DebtInput,
  EFInput,
  DebtPaymentEventInput,
} from './types';

/**
 * Pure entry point for golden tests and unit tests.
 * Takes all inputs, returns DashboardView. No DB, no side effects.
 *
 * Alias for buildDashboardView — exists so tests have a clear "black box" boundary.
 */
export { buildDashboardView as runFinanceDomain } from './buildDashboardView';
