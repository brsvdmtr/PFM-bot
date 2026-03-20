import cron from 'node-cron';
import { prisma } from '@pfm/db';
import { calculateS2S, calculatePeriodBounds } from './engine';
import {
  sendMorningNotification,
  sendEveningNotification,
  sendPaymentAlert,
  sendNewPeriodNotification,
} from './notify';

// ── Helpers ─────────────────────────────────────────────

/** Returns current HH:MM in the given IANA timezone */
function currentTimeInTZ(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(new Date())
      .replace(/^24:/, '00:'); // Some envs return "24:xx" for midnight
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  }
}

/** Returns today's date string YYYY-MM-DD (UTC) for dedup key */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** In-memory dedup: prevents sending same notification twice in one day */
const notifLog = new Map<string, Set<string>>(); // date → Set<"userId:type">

function hasNotified(userId: string, type: string): boolean {
  return notifLog.get(todayUTC())?.has(`${userId}:${type}`) ?? false;
}

function markNotified(userId: string, type: string): void {
  const key = todayUTC();
  if (!notifLog.has(key)) {
    notifLog.clear(); // drop yesterday's entries
    notifLog.set(key, new Set());
  }
  notifLog.get(key)!.add(`${userId}:${type}`);
}

/** Compute dynamic S2S for a user with an active period */
async function computeS2S(userId: string) {
  const [activePeriod, todayAgg, periodAgg] = await Promise.all([
    prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } }),
    prisma.expense.aggregate({
      where: {
        userId,
        spentAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, period: { status: 'ACTIVE' } },
      _sum: { amount: true },
    }),
  ]);

  if (!activePeriod) return null;

  const todayTotal = todayAgg._sum.amount ?? 0;
  const totalPeriodSpent = periodAgg._sum.amount ?? 0;
  const now = new Date();
  // Use same formula as engine.ts: daysTotal - daysElapsed + 1
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - activePeriod.startDate.getTime()) / msPerDay));
  const daysLeft = Math.max(1, activePeriod.daysTotal - daysElapsed + 1);

  const periodRemaining = Math.max(0, activePeriod.s2sPeriod - totalPeriodSpent);
  const dynamicS2sDaily = Math.max(0, Math.round(periodRemaining / daysLeft));
  const s2sToday = Math.max(0, dynamicS2sDaily - todayTotal);

  let s2sStatus: 'OK' | 'WARNING' | 'OVERSPENT' | 'DEFICIT' = 'OK';
  if (activePeriod.s2sPeriod <= 0) s2sStatus = 'DEFICIT';
  else if (todayTotal > dynamicS2sDaily) s2sStatus = 'OVERSPENT';
  else if (dynamicS2sDaily > 0 && s2sToday / dynamicS2sDaily <= 0.3) s2sStatus = 'WARNING';

  return { s2sToday, s2sDaily: dynamicS2sDaily, todayTotal, daysLeft, s2sStatus, activePeriod };
}

// ── Cron 1: Notification dispatcher (every minute) ──────

cron.schedule('* * * * *', async () => {
  try {
    const users = await prisma.user.findMany({
      where: {
        telegramChatId: { not: null },
        onboardingDone: true,
      },
      include: { settings: true },
    });

    for (const user of users) {
      if (!user.telegramChatId || !user.settings) continue;

      const localTime = currentTimeInTZ(user.timezone);

      // ── Morning notification ──
      if (
        user.settings.morningNotifyEnabled &&
        localTime === user.settings.morningNotifyTime &&
        !hasNotified(user.id, 'morning')
      ) {
        markNotified(user.id, 'morning');
        const s2s = await computeS2S(user.id);
        if (s2s) {
          await sendMorningNotification(
            user.telegramChatId,
            s2s.s2sToday,
            s2s.s2sDaily,
            s2s.daysLeft,
            s2s.activePeriod.currency,
            s2s.s2sStatus,
          );
        }
      }

      // ── Evening notification ──
      if (
        user.settings.eveningNotifyEnabled &&
        localTime === user.settings.eveningNotifyTime &&
        !hasNotified(user.id, 'evening')
      ) {
        markNotified(user.id, 'evening');
        const s2s = await computeS2S(user.id);
        if (s2s) {
          await sendEveningNotification(
            user.telegramChatId,
            s2s.todayTotal,
            s2s.s2sDaily,
            s2s.activePeriod.currency,
          );
        }
      }
    }
  } catch (err) {
    console.error('[PFM Cron] Notification dispatch error:', err);
  }
});

// ── Cron 2: Daily snapshot at 23:55 ─────────────────────

cron.schedule('55 23 * * *', async () => {
  console.log('[PFM Cron] Saving daily snapshots...');
  try {
    const activePeriods = await prisma.period.findMany({
      where: { status: 'ACTIVE' },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const period of activePeriods) {
      const todayAgg = await prisma.expense.aggregate({
        where: {
          periodId: period.id,
          spentAt: { gte: today },
        },
        _sum: { amount: true },
      });

      const periodAgg = await prisma.expense.aggregate({
        where: { periodId: period.id },
        _sum: { amount: true },
      });

      const totalPeriodSpent = periodAgg._sum.amount ?? 0;
      const todayTotal = todayAgg._sum.amount ?? 0;

      const daysLeft = Math.max(
        1,
        Math.ceil((period.endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
      );
      const periodRemaining = Math.max(0, period.s2sPeriod - totalPeriodSpent);
      const s2sPlanned = Math.max(0, Math.round(periodRemaining / daysLeft));
      const s2sActual = Math.max(0, s2sPlanned - todayTotal);

      await prisma.dailySnapshot.upsert({
        where: { periodId_date: { periodId: period.id, date: today } },
        create: {
          periodId: period.id,
          date: today,
          s2sPlanned,
          s2sActual,
          totalExpenses: todayTotal,
          isOverspent: todayTotal > s2sPlanned,
        },
        update: {
          s2sPlanned,
          s2sActual,
          totalExpenses: todayTotal,
          isOverspent: todayTotal > s2sPlanned,
        },
      });
    }

    console.log(`[PFM Cron] Saved ${activePeriods.length} snapshots`);
  } catch (err) {
    console.error('[PFM Cron] Daily snapshot error:', err);
  }
});

// ── Cron 3: Payment alerts at 09:00 UTC ─────────────────

cron.schedule('0 9 * * *', async () => {
  console.log('[PFM Cron] Checking payment alerts...');
  try {
    const today = new Date();
    const todayDay = today.getDate();
    const tomorrowDay = new Date(today.getTime() + 86_400_000).getDate();

    const users = await prisma.user.findMany({
      where: {
        telegramChatId: { not: null },
        onboardingDone: true,
        settings: { paymentAlerts: true },
      },
      include: {
        settings: true,
        debts: {
          where: {
            isPaidOff: false,
            dueDay: { in: [todayDay, tomorrowDay] },
          },
        },
      },
    });

    for (const user of users) {
      if (!user.telegramChatId) continue;
      for (const debt of user.debts) {
        if (!debt.dueDay) continue;
        const daysUntil = debt.dueDay === todayDay ? 0 : 1;
        if (!hasNotified(user.id, `payment:${debt.id}`)) {
          markNotified(user.id, `payment:${debt.id}`);
          await sendPaymentAlert(
            user.telegramChatId,
            debt.title,
            debt.minPayment,
            debt.currency,
            daysUntil,
          );
        }
      }
    }
  } catch (err) {
    console.error('[PFM Cron] Payment alerts error:', err);
  }
});

// ── Cron 4: Period rollover at 00:05 ────────────────────

cron.schedule('5 0 * * *', async () => {
  console.log('[PFM Cron] Checking period rollovers...');
  try {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Find expired active periods
    const expiredPeriods = await prisma.period.findMany({
      where: { status: 'ACTIVE', endDate: { lte: today } },
      include: {
        user: {
          include: {
            incomes: { where: { isActive: true } },
            obligations: { where: { isActive: true } },
            debts: { where: { isPaidOff: false } },
            emergencyFund: true,
          },
        },
      },
    });

    for (const period of expiredPeriods) {
      const user = period.user;
      if (!user) continue;

      try {
        // Calculate how much was saved/overspent in the old period
        const totalSpentAgg = await prisma.expense.aggregate({
          where: { periodId: period.id },
          _sum: { amount: true },
        });
        const totalSpent = totalSpentAgg._sum.amount ?? 0;
        const prevSaved = period.s2sPeriod - totalSpent;

        // Mark old period as COMPLETED
        await prisma.period.update({
          where: { id: period.id },
          data: { status: 'COMPLETED' },
        });

        const { incomes, obligations, debts, emergencyFund: ef } = user;
        if (incomes.length === 0) continue;

        // Calculate new period bounds using ALL paydays from all incomes
        const allPaydays = [...new Set(incomes.flatMap((i: any) => i.paydays as number[]))].sort((a: number, b: number) => a - b);
        const bounds = calculatePeriodBounds(allPaydays, now);

        // Calculate S2S for new period
        const s2sResult = calculateS2S({
          incomes: incomes.map((i) => ({ amount: i.amount, paydays: i.paydays as number[] })),
          obligations: obligations.map((o) => ({ amount: o.amount })),
          debts: debts.map((d) => ({
            id: d.id,
            balance: d.balance,
            apr: d.apr,
            minPayment: d.minPayment,
            isFocusDebt: d.isFocusDebt,
          })),
          emergencyFund: { currentAmount: ef?.currentAmount ?? 0, targetMonths: ef?.targetMonths ?? 3 },
          periodStartDate: bounds.start,
          periodEndDate: bounds.end,
          today: now,
          totalExpensesInPeriod: 0,
          todayExpenses: 0,
          isProratedStart: bounds.isProratedStart,
          fullPeriodDays: bounds.fullPeriodDays,
        });

        await prisma.period.create({
          data: {
            userId: user.id,
            startDate: bounds.start,
            endDate: bounds.end,
            totalIncome: s2sResult.totalIncome,
            totalObligations: s2sResult.totalObligations,
            totalDebtPayments: s2sResult.totalDebtPayments,
            efContribution: s2sResult.efContribution,
            reserve: s2sResult.reserve,
            s2sPeriod: s2sResult.s2sPeriod,
            s2sDaily: s2sResult.s2sDaily,
            daysTotal: s2sResult.daysTotal,
            currency: period.currency,
            isProratedStart: bounds.isProratedStart,
            status: 'ACTIVE',
          },
        });

        // Notify user about new period
        if (user.telegramChatId) {
          await sendNewPeriodNotification(
            user.telegramChatId,
            s2sResult.s2sDaily,
            s2sResult.daysTotal,
            period.currency,
            prevSaved,
          );
        }

        console.log(`[PFM Cron] Rolled over period for user ${user.id}`);
      } catch (err) {
        console.error(`[PFM Cron] Rollover error for period ${period.id}:`, err);
      }
    }

    if (expiredPeriods.length > 0) {
      console.log(`[PFM Cron] Rolled over ${expiredPeriods.length} periods`);
    }
  } catch (err) {
    console.error('[PFM Cron] Rollover check error:', err);
  }
});

console.log('[PFM Cron] Scheduled: notifications (every min), snapshots (23:55), payment alerts (09:00 UTC), rollover (00:05)');
