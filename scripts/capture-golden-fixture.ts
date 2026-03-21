/**
 * capture-golden-fixture.ts
 *
 * ONE-TIME script. Run against production DB to capture Dmitriy's exact
 * financial state on 2026-03-21.
 *
 * Output: paste the printed block into:
 *   apps/api/src/domain/finance/__fixtures__/golden_user_dima_march_2026.ts
 *
 * Usage (on server):
 *   cd /srv/pfm
 *   docker compose exec api npx tsx src/scripts/capture-golden-fixture.ts
 *
 * After capture: MANUALLY VERIFY all values, then commit the fixture.
 * Do NOT re-run this script in CI or tests.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const USER_TG_ID = '327159577';

async function main() {
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(USER_TG_ID) },
    include: {
      incomes:       { where: { isActive: true } },
      obligations:   { where: { isActive: true } },
      debts:         { where: { isPaidOff: false } },
      emergencyFund: true,
    },
  });

  if (!user) throw new Error(`User tgId=${USER_TG_ID} not found`);

  const activePeriod = await prisma.period.findFirst({
    where: { userId: user.id, status: 'ACTIVE' },
  });

  if (!activePeriod) throw new Error('No active period');

  // All expenses in the active period
  const periodExpenses = await prisma.expense.findMany({
    where: { periodId: activePeriod.id },
    select: { id: true, amount: true, spentAt: true, note: true },
    orderBy: { spentAt: 'asc' },
  });

  const totalPeriodSpent = periodExpenses.reduce((s, e) => s + e.amount, 0);

  // Today's expenses (UTC, server-side only for capture)
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayExpenses = periodExpenses.filter(e => e.spentAt >= todayStart);
  const todayTotal = todayExpenses.reduce((s, e) => s + e.amount, 0);

  // Debt payment events for this period
  const debtEvents = await prisma.debtPaymentEvent.findMany({
    where: { periodId: activePeriod.id, kind: 'REQUIRED_MIN_PAYMENT', deletedAt: null },
    select: { debtId: true, amountMinor: true, kind: true },
  });

  // Print fixture
  console.log('// ─────────────────────────────────────────────────────────');
  console.log('// CAPTURED: ' + new Date().toISOString());
  console.log('// User:', user.firstName, '| tgId:', USER_TG_ID);
  console.log('// Manually verify before committing.');
  console.log('// ─────────────────────────────────────────────────────────');
  console.log('');
  console.log(`export const GOLDEN_TZ = '${user.timezone ?? 'Europe/Moscow'}';`);
  console.log(`export const GOLDEN_NOW = new Date('2026-03-21T09:00:00+03:00');`);
  console.log('');
  console.log('export const GOLDEN_INCOME = [');
  for (const i of user.incomes) {
    console.log(`  { id: '${i.id}', amount: ${i.amount}, paydays: ${JSON.stringify(i.paydays)}, useRussianWorkCalendar: ${(i as any).useRussianWorkCalendar ?? false} },`);
  }
  console.log('];');
  console.log('');
  console.log('export const GOLDEN_OBLIGATIONS = [');
  for (const o of user.obligations) {
    console.log(`  { id: '${o.id}', amount: ${o.amount}, dueDay: ${o.dueDay ?? null} },`);
  }
  console.log('];');
  console.log('');
  console.log('export const GOLDEN_DEBTS = [');
  for (const d of user.debts) {
    console.log(`  { id: '${d.id}', balance: ${d.balance}, apr: ${d.apr}, minPayment: ${d.minPayment}, dueDay: ${(d as any).dueDay ?? null}, isFocusDebt: ${d.isFocusDebt}, isPaidOff: ${d.isPaidOff} },`);
  }
  console.log('];');
  console.log('');
  if (user.emergencyFund) {
    console.log(`export const GOLDEN_EF = { currentAmount: ${user.emergencyFund.currentAmount}, targetMonths: ${user.emergencyFund.targetMonths} };`);
  } else {
    console.log(`export const GOLDEN_EF = null;`);
  }
  console.log('');
  console.log(`// Period expenses (all):  count=${periodExpenses.length}, total=${totalPeriodSpent}`);
  console.log(`// Today's expenses total: ${todayTotal}`);
  console.log('');
  console.log('// SCENARIO_A: all required debts paid, todayTotal = 0, totalPeriodSpent = <verify>');
  console.log(`export const SCENARIO_A_TOTAL_PERIOD_SPENT = ${totalPeriodSpent};`);
  console.log(`export const SCENARIO_A_TODAY_TOTAL = 0;`);
  console.log('export const SCENARIO_A_DEBT_EVENTS = [');
  for (const ev of debtEvents) {
    console.log(`  { debtId: '${ev.debtId}', amountMinor: ${ev.amountMinor}, kind: '${ev.kind}' as const },`);
  }
  console.log('];');
  console.log('');
  console.log('// SCENARIO_B: all debts paid, todayTotal = 6729 (kopecks)');
  console.log(`export const SCENARIO_B_TOTAL_PERIOD_SPENT = ${totalPeriodSpent + 6729};`);
  console.log(`export const SCENARIO_B_TODAY_TOTAL = 6729;`);
  console.log('export const SCENARIO_B_DEBT_EVENTS = SCENARIO_A_DEBT_EVENTS;');

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
