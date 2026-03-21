import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { prisma } from '@pfm/db';
import { determineFocusDebt, buildAvalanchePlan } from './avalanche';
import { getLastActualPayday, getNextActualPayday, getNextIncomeAmount } from './payday-calendar';
import {
  DEFAULT_TZ,
  daysLeftInPeriod,
  getTodayLocalStart,
  getNextLocalDayStart,
  toLocalDate,
  computeDebtPeriodSummaries,
  dayNumberInPeriod,
} from './period-utils';
// Domain finance layer — single source of truth for all financial calculations.
// Route handlers collect inputs, call domain, persist/return output. No math here.
import {
  buildDashboardView,
  rebuildActivePeriodSnapshot,
  calculateActualPeriodBounds,
} from './domain/finance';

// ── Types ──────────────────────────────────────────────

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface AuthenticatedRequest extends Request {
  tgUser?: TelegramUser;
  userId?: string;
}

// ── Config ─────────────────────────────────────────────

const PORT = parseInt(process.env.API_PORT || '3002', 10);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const GOD_MODE_IDS = (process.env.GOD_MODE_TELEGRAM_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── Telegram Auth ──────────────────────────────────────

function validateTelegramInitData(initData: string): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');
    const entries = Array.from(params.entries());
    entries.sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    if (computed !== hash) return null;

    // Reject stale initData (older than 1 hour)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (authDate && Date.now() / 1000 - authDate > 3600) return null;

    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr) as TelegramUser;
  } catch {
    return null;
  }
}

// ── Middleware ──────────────────────────────────────────

function tgAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Dev bypass
  if (process.env.NODE_ENV !== 'production') {
    const devId = req.headers['x-tg-dev'] as string | undefined;
    if (devId) {
      req.tgUser = { id: parseInt(devId, 10), first_name: 'Dev' };
      next();
      return;
    }
  }

  const initData = req.headers['x-tg-init-data'] as string | undefined;
  if (!initData) {
    res.status(401).json({ error: 'Missing Telegram init data' });
    return;
  }

  const user = validateTelegramInitData(initData);
  if (!user) {
    res.status(401).json({ error: 'Invalid Telegram init data' });
    return;
  }

  req.tgUser = user;
  next();
}

function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-internal-key'] as string | undefined;
  if (!key || key !== ADMIN_KEY) {
    res.status(401).json({ error: 'Invalid internal key' });
    return;
  }
  next();
}

/** Ensure user exists in DB, set req.userId */
async function ensureUser(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  if (!req.tgUser) {
    next();
    return;
  }

  const telegramId = String(req.tgUser.id);
  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId,
        firstName: req.tgUser.first_name,
        godMode: GOD_MODE_IDS.includes(telegramId),
        locale: req.tgUser.language_code === 'en' ? 'en' : 'ru',
        profile: { create: { displayName: req.tgUser.first_name } },
        settings: { create: {} },
      },
    });
  }

  req.userId = user.id;
  next();
}

/**
 * Rebuild the active period snapshot for a user.
 * Delegates entirely to domain/finance — no financial math here.
 */
async function triggerRecalculate(userId: string): Promise<void> {
  await rebuildActivePeriodSnapshot(userId);
}

// ── App ────────────────────────────────────────────────

const app = express();
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.MINI_APP_URL?.replace('/miniapp', '') || 'https://mytodaylimit.ru', 'https://mytodaylimit.ru']
    : true,
  credentials: false,
}));
app.use(express.json());

// ── Health ─────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/health/deep', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, db: false, error: String(err) });
  }
});

// ── TG Routes ──────────────────────────────────────────

const tg = express.Router();
tg.use(tgAuth);
tg.use(ensureUser);

// Onboarding status
tg.get('/onboarding/status', async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { onboardingDone: true },
  });
  res.json({ onboardingDone: user?.onboardingDone ?? false });
});

// Dashboard
tg.get('/dashboard', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;

  // Resolve user timezone first (needed for local-day expense filtering)
  const tzUser = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const tz = tzUser?.timezone ?? DEFAULT_TZ;
  const todayLocalStart   = getTodayLocalStart(tz);
  const tomorrowLocalStart = getNextLocalDayStart(tz);

  const now = new Date();
  const [user, activePeriodRaw, todayExpenses, periodExpenses, incomes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        debts: { where: { isPaidOff: false }, orderBy: { apr: 'desc' } },
        emergencyFund: true,
        obligations: { where: { isActive: true } },
      },
    }),
    prisma.period.findFirst({
      where: { userId, status: 'ACTIVE' },
    }),
    // Today's expenses bounded by local midnight (not UTC midnight)
    prisma.expense.findMany({
      where: {
        userId,
        spentAt: { gte: todayLocalStart, lt: tomorrowLocalStart },
      },
      orderBy: { spentAt: 'desc' },
    }),
    // Total expenses for the entire period (for carry-over calc)
    prisma.expense.aggregate({
      where: { userId, period: { status: 'ACTIVE' } },
      _sum: { amount: true },
    }),
    prisma.income.findMany({ where: { userId, isActive: true } }),
  ]);

  if (!user || !activePeriodRaw) {
    res.json({
      onboardingDone: user?.onboardingDone ?? false,
      s2sToday: 0,
      s2sDaily: 0,
      daysLeft: 0,
      daysTotal: 0,
      dayNumber: 1,
      periodSpent: 0,
      s2sPeriod: 0,
      todayExpenses: [],
      focusDebt: null,
      emergencyFund: null,
    });
    return;
  }

  // ── Self-heal: if stored period boundaries differ from actual payday bounds
  // by more than 60s, rebuild the snapshot with correct actual payout dates.
  // Uses calculateActualPeriodBounds (real payout dates) — not canonical calendar.
  let activePeriod = activePeriodRaw;
  if (incomes.length > 0) {
    const allPaydayNumsForHeal = [...new Set(incomes.flatMap(i => i.paydays as number[]))].sort((a, b) => a - b);
    const useRuCalHeal = incomes.some(i => (i as any).useRussianWorkCalendar === true);
    const actualBounds = calculateActualPeriodBounds(allPaydayNumsForHeal, now, tz, useRuCalHeal);
    if (Math.abs(activePeriod.startDate.getTime() - actualBounds.start.getTime()) > 60_000) {
      console.log(`[Dashboard] Self-healing period for user ${userId}: stored=${activePeriod.startDate.toISOString()} → actual=${actualBounds.start.toISOString()}`);
      await rebuildActivePeriodSnapshot(userId, now);
      const healed = await prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } });
      if (healed) activePeriod = healed;
    }
  }

  // ── Gather inputs for domain view ────────────────────────────────────────
  const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalPeriodSpent = periodExpenses._sum.amount ?? 0;

  const periodDebtEvents = await prisma.debtPaymentEvent.findMany({
    where: { userId, periodId: activePeriod.id, kind: 'REQUIRED_MIN_PAYMENT', deletedAt: null },
    select: { debtId: true, amountMinor: true, kind: true },
  });

  // ── Build dashboard view via domain layer (all financial math here) ───────
  const view = buildDashboardView({
    now,
    tz,
    incomes: incomes.map(i => ({
      id: i.id,
      amount: i.amount,
      paydays: i.paydays as number[],
      useRussianWorkCalendar: (i as any).useRussianWorkCalendar === true,
    })),
    obligations: user.obligations.map(o => ({ id: o.id, amount: o.amount, dueDay: o.dueDay ?? null })),
    debts: user.debts.map(d => ({
      id: d.id, balance: d.balance, apr: d.apr, minPayment: d.minPayment,
      dueDay: (d as any).dueDay ?? null, isFocusDebt: d.isFocusDebt, isPaidOff: d.isPaidOff,
    })),
    emergencyFund: user.emergencyFund
      ? { currentAmount: user.emergencyFund.currentAmount, targetMonths: user.emergencyFund.targetMonths }
      : null,
    totalPeriodSpent,
    todayTotal,
    debtPaymentEvents: periodDebtEvents.map(ev => ({
      debtId: ev.debtId,
      amountMinor: ev.amountMinor,
      kind: ev.kind as 'REQUIRED_MIN_PAYMENT' | 'EXTRA_PRINCIPAL_PAYMENT',
    })),
  });

  // ── Non-financial display fields (payday calendar, cash anchor) ───────────
  const allUseRuCalendar = incomes.some(i => (i as any).useRussianWorkCalendar === true);
  const allPaydayNums = [...new Set(incomes.flatMap(i => i.paydays as number[]))].sort((a, b) => a - b);
  const lastIncomeDate  = getLastActualPayday(allPaydayNums, now, allUseRuCalendar);
  const nextIncomeDate  = getNextActualPayday(allPaydayNums, now, allUseRuCalendar);
  const nextIncomeAmount = nextIncomeDate
    ? getNextIncomeAmount(incomes.map(i => ({ amount: i.amount, paydays: i.paydays as number[] })), nextIncomeDate)
    : 0;

  const summaryByDebtId = new Map(view.debtSummaries.map(s => [s.debtId, s]));
  const focusDebt = user.debts.find(d => d.isFocusDebt) ?? user.debts[0] ?? null;

  res.json({
    onboardingDone: user.onboardingDone,
    // ── Core S2S (backend-authoritative, from domain layer) ──
    s2sToday:    view.s2sToday,
    s2sDaily:    view.s2sDaily,
    s2sStatus:   view.s2sStatus,
    daysLeft:    view.daysLeft,
    dayNumber:   view.dayNumber,
    daysTotal:   view.totalDays,
    periodStart: new Date(view.periodStartIso),
    periodEnd:   new Date(view.periodEndIso),
    periodSpent: view.totalPeriodSpent,
    s2sPeriod:   view.s2sPeriod,
    periodRemaining:             view.periodRemaining,
    totalDebtPaymentsRemaining:  view.totalDebtPaymentsRemaining,
    // ── Today's expense list (raw, for display) ──
    todayExpenses,
    todayTotal,
    // ── Debts with per-period payment status ──
    focusDebt: focusDebt
      ? { id: focusDebt.id, title: focusDebt.title, apr: focusDebt.apr,
          balance: focusDebt.balance, minPayment: focusDebt.minPayment, type: focusDebt.type }
      : null,
    debts: user.debts.map(d => {
      const ps = summaryByDebtId.get(d.id);
      return {
        id: d.id, title: d.title, apr: d.apr, balance: d.balance,
        minPayment: d.minPayment, type: d.type, isFocusDebt: d.isFocusDebt, dueDay: d.dueDay,
        currentPeriodPayment: ps ? {
          required: ps.requiredMinForPeriod,
          paid:     ps.paidRequiredThisPeriod,
          remaining: ps.remainingRequiredThisPeriod,
          status:   ps.status,
        } : null,
      };
    }),
    // ── Emergency fund ──
    emergencyFund: user.emergencyFund
      ? { currentAmount: user.emergencyFund.currentAmount,
          targetAmount:  user.obligations.reduce((s, o) => s + o.amount, 0) * user.emergencyFund.targetMonths }
      : null,
    currency: activePeriod.currency,
    // ── Payday / cash anchor display fields ──
    cashOnHand:    activePeriod.cashAnchorAmount ?? null,
    cashAnchorAt:  activePeriod.cashAnchorAt ?? null,
    lastIncomeDate: lastIncomeDate ?? null,
    nextIncomeDate: nextIncomeDate ?? null,
    nextIncomeAmount,
    daysToNextIncome: nextIncomeDate ? daysLeftInPeriod(nextIncomeDate, now, tz) : null,
    windowStart:  activePeriod.cashAnchorAt ?? activePeriod.startDate,
    windowEnd:    nextIncomeDate ?? activePeriod.endDate,
    usesLiveWindow: false,
    // ── Debug (never source of truth) ──
    _debug: {
      ...view._debug,
      nowLocal: toLocalDate(now, tz).toISOString(),
      totalPeriodSpent: view.totalPeriodSpent,
    },
  });
});

// Quick expense
tg.post('/expenses', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { amount, note } = req.body;

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'Invalid amount' });
    return;
  }

  const activePeriod = await prisma.period.findFirst({
    where: { userId, status: 'ACTIVE' },
  });

  if (!activePeriod) {
    res.status(400).json({ error: 'No active period. Complete onboarding first.' });
    return;
  }

  const expense = await prisma.expense.create({
    data: {
      userId,
      periodId: activePeriod.id,
      amount: Math.round(amount),
      note: note || null,
      currency: activePeriod.currency,
    },
  });

  res.status(201).json(expense);
});

// Today's expenses
tg.get('/expenses/today', async (req: AuthenticatedRequest, res) => {
  const expenses = await prisma.expense.findMany({
    where: {
      userId: req.userId!,
      spentAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    },
    orderBy: { spentAt: 'desc' },
  });
  res.json(expenses);
});

// Delete expense
tg.delete('/expenses/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const expense = await prisma.expense.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!expense) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }
  await prisma.expense.delete({ where: { id: expense.id } });
  res.json({ ok: true });
});

// Profile
tg.get('/me/profile', async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    include: { profile: true, subscription: true },
  });
  res.json(user);
});

// Settings
tg.get('/me/settings', async (req: AuthenticatedRequest, res) => {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: req.userId! },
  });
  res.json(settings);
});

// ── Onboarding ─────────────────────────────────────────

// Step 1 — Income
tg.post('/onboarding/income', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { amount, paydays, currency = 'RUB', title = 'Основной доход' } = req.body;

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'Invalid amount' });
    return;
  }
  if (!paydays || !Array.isArray(paydays) || paydays.length === 0) {
    res.status(400).json({ error: 'paydays required' });
    return;
  }

  // Remove old incomes and recreate
  await prisma.income.deleteMany({ where: { userId } });
  const income = await prisma.income.create({
    data: {
      userId,
      title,
      amount: Math.round(amount),
      currency: currency as any,
      paydays,
    },
  });

  // Update user primary currency
  await prisma.user.update({
    where: { id: userId },
    data: { primaryCurrency: currency as any },
  });

  res.json(income);
});

// Step 2 — Obligations
tg.post('/onboarding/obligations', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { obligations } = req.body as {
    obligations: Array<{ title: string; type: string; amount: number; dueDay?: number }>;
  };

  if (!Array.isArray(obligations)) {
    res.status(400).json({ error: 'obligations must be array' });
    return;
  }

  await prisma.obligation.deleteMany({ where: { userId } });

  if (obligations.length > 0) {
    await prisma.obligation.createMany({
      data: obligations.map((o) => ({
        userId,
        title: o.title,
        type: (o.type || 'OTHER') as any,
        amount: Math.round(o.amount),
        dueDay: o.dueDay ?? null,
      })),
    });
  }

  const all = await prisma.obligation.findMany({ where: { userId } });
  res.json(all);
});

// Step 3 — Debts
tg.post('/onboarding/debts', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { debts } = req.body as {
    debts: Array<{
      title: string;
      type: string;
      balance: number;
      apr: number;
      minPayment: number;
      dueDay?: number;
    }>;
  };

  if (!Array.isArray(debts)) {
    res.status(400).json({ error: 'debts must be array' });
    return;
  }

  await prisma.debt.deleteMany({ where: { userId } });

  let createdDebts: any[] = [];
  if (debts.length > 0) {
    // Sort by APR desc to determine focus debt
    const sorted = [...debts].sort((a, b) => b.apr - a.apr);
    createdDebts = await Promise.all(
      sorted.map((d, i) =>
        prisma.debt.create({
          data: {
            userId,
            title: d.title,
            type: (d.type || 'OTHER') as any,
            balance: Math.round(d.balance),
            originalAmount: Math.round(d.balance),
            apr: d.apr,
            minPayment: Math.round(d.minPayment),
            dueDay: d.dueDay ?? null,
            isFocusDebt: i === 0,
          },
        })
      )
    );
  }

  res.json(createdDebts);
});

// Step 4 — Emergency Fund
tg.post('/onboarding/ef', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { currentAmount = 0, targetMonths = 3, currency = 'RUB' } = req.body;

  const ef = await prisma.emergencyFund.upsert({
    where: { userId },
    create: {
      userId,
      currentAmount: Math.round(currentAmount),
      targetMonths,
      currency: currency as any,
    },
    update: {
      currentAmount: Math.round(currentAmount),
      targetMonths,
    },
  });

  res.json(ef);
});

// Step 5 — Complete onboarding, create first period
tg.post('/onboarding/complete', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { currentCash } = req.body; // optional number in minor units

  const [user, incomes] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.income.findMany({ where: { userId, isActive: true } }),
  ]);

  if (!user || incomes.length === 0) {
    res.status(400).json({ error: 'Income required before completing onboarding' });
    return;
  }

  // Close any existing active period
  await prisma.period.updateMany({
    where: { userId, status: 'ACTIVE' },
    data: { status: 'COMPLETED' },
  });

  // Compute actual period bounds from salary schedule (real payout dates, not calendar)
  const tz = (user as any).timezone ?? DEFAULT_TZ;
  const now = new Date();
  const allPaydays = [...new Set(incomes.flatMap((inc) => inc.paydays as number[]))].sort((a, b) => a - b);
  const useRuCalendar = incomes.some((inc) => (inc as any).useRussianWorkCalendar === true);
  const bounds = calculateActualPeriodBounds(allPaydays, now, tz, useRuCalendar);

  const currency = (user.primaryCurrency || 'RUB') as any;

  // Create period shell — financial fields filled by rebuildActivePeriodSnapshot below
  await prisma.period.create({
    data: {
      userId,
      startDate:        bounds.start,
      endDate:          bounds.end,
      daysTotal:        bounds.daysTotal,
      currency,
      status:           'ACTIVE',
      isProratedStart:  false,
      totalIncome:      0,
      totalObligations: 0,
      totalDebtPayments: 0,
      efContribution:   0,
      reserve:          0,
      s2sPeriod:        0,
      s2sDaily:         0,
      cashAnchorAmount: currentCash ? Math.round(currentCash) : null,
      cashAnchorAt:     currentCash ? now : null,
    },
  });

  // Fill all financial values via the domain layer (single source of truth)
  await rebuildActivePeriodSnapshot(userId, now);

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingDone: true },
  });

  // Fetch rebuilt period and compute display-only payday fields for response
  const period = await prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } });
  const lastIncomeDate = getLastActualPayday(allPaydays, now, useRuCalendar);
  const nextIncomeDate = getNextActualPayday(allPaydays, now, useRuCalendar);

  res.json({
    period,
    cashAnchorSet: !!currentCash,
    nextIncomeDate: nextIncomeDate ?? null,
    lastIncomeDate: lastIncomeDate ?? null,
  });
});

// Update cash anchor
tg.post('/cash-anchor', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { currentCash } = req.body;

  if (currentCash === undefined || currentCash === null || typeof currentCash !== 'number' || currentCash < 0) {
    res.status(400).json({ error: 'currentCash must be a non-negative number (minor units)' });
    return;
  }

  const activePeriod = await prisma.period.findFirst({
    where: { userId, status: 'ACTIVE' },
  });

  if (!activePeriod) {
    res.status(400).json({ error: 'No active period' });
    return;
  }

  const now = new Date();
  const incomes = await prisma.income.findMany({ where: { userId, isActive: true } });
  const allPaydays = [...new Set(incomes.flatMap((i) => i.paydays as number[]))].sort((a, b) => a - b);
  const allUseRuCalendar = incomes.some((i) => (i as any).useRussianWorkCalendar);
  const nextIncomeDate = getNextActualPayday(allPaydays, now, allUseRuCalendar);
  const nextIncomeAmountVal = nextIncomeDate
    ? getNextIncomeAmount(incomes.map(i => ({ amount: i.amount, paydays: i.paydays as number[] })), nextIncomeDate)
    : 0;

  await prisma.period.update({
    where: { id: activePeriod.id },
    data: {
      cashAnchorAmount: Math.round(currentCash),
      cashAnchorAt: now,
      nextIncomeDate: nextIncomeDate ?? undefined,
      nextIncomeAmount: nextIncomeAmountVal,
    },
  });

  res.json({
    ok: true,
    cashAnchorAmount: Math.round(currentCash),
    cashAnchorAt: now,
    nextIncomeDate: nextIncomeDate ?? null,
    nextIncomeAmount: nextIncomeAmountVal,
  });
});

// ── Periods ──────────────────────────────────────────────

// Last completed period summary
tg.get('/periods/last-completed', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;

  const period = await prisma.period.findFirst({
    where: { userId, status: 'COMPLETED' },
    orderBy: { endDate: 'desc' },
    include: { dailySnapshots: true },
  });

  if (!period) {
    res.json(null);
    return;
  }

  const [totalSpentAgg, topExpenses] = await Promise.all([
    prisma.expense.aggregate({
      where: { periodId: period.id },
      _sum: { amount: true },
    }),
    prisma.expense.findMany({
      where: { periodId: period.id },
      orderBy: { amount: 'desc' },
      take: 5,
    }),
  ]);

  const totalSpent = totalSpentAgg._sum.amount ?? 0;
  const saved = period.s2sPeriod - totalSpent;
  const overspentDays = period.dailySnapshots.filter((s) => s.isOverspent).length;

  res.json({
    id: period.id,
    startDate: period.startDate,
    endDate: period.endDate,
    daysTotal: period.daysTotal,
    s2sPeriod: period.s2sPeriod,
    s2sDaily: period.s2sDaily,
    totalSpent,
    saved,
    overspentDays,
    currency: period.currency,
    topExpenses: topExpenses.map((e) => ({ amount: e.amount, note: e.note, spentAt: e.spentAt })),
  });
});

tg.get('/periods/current', async (req: AuthenticatedRequest, res) => {
  const period = await prisma.period.findFirst({
    where: { userId: req.userId!, status: 'ACTIVE' },
    include: { expenses: { orderBy: { spentAt: 'desc' } } },
  });
  res.json(period);
});

tg.post('/periods/recalculate', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  // Domain layer handles all fetching, bounds computation, and DB update.
  await triggerRecalculate(userId);
  res.json({ ok: true });
});

// ── Incomes CRUD ─────────────────────────────────────────

tg.get('/incomes', async (req: AuthenticatedRequest, res) => {
  const incomes = await prisma.income.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json(incomes);
});

tg.post('/incomes', async (req: AuthenticatedRequest, res) => {
  const { title, amount, paydays, currency = 'RUB', frequency = 'MONTHLY' } = req.body;
  if (!title || !amount || !paydays) {
    res.status(400).json({ error: 'title, amount, paydays required' });
    return;
  }
  const income = await prisma.income.create({
    data: {
      userId: req.userId!, title,
      amount: Math.round(amount), paydays,
      currency: currency as any, frequency: frequency as any,
    },
  });
  res.status(201).json(income);
});

tg.patch('/incomes/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const income = await prisma.income.findFirst({ where: { id, userId: req.userId! } });
  if (!income) { res.status(404).json({ error: 'Not found' }); return; }
  const updated = await prisma.income.update({ where: { id }, data: req.body });
  res.json(updated);
});

tg.delete('/incomes/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const income = await prisma.income.findFirst({ where: { id, userId: req.userId! } });
  if (!income) { res.status(404).json({ error: 'Not found' }); return; }
  await prisma.income.delete({ where: { id } });
  res.json({ ok: true });
});

// ── Obligations CRUD ─────────────────────────────────────

tg.get('/obligations', async (req: AuthenticatedRequest, res) => {
  const obligations = await prisma.obligation.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json(obligations);
});

tg.post('/obligations', async (req: AuthenticatedRequest, res) => {
  const { title, type = 'OTHER', amount, dueDay } = req.body;
  if (!title || !amount) {
    res.status(400).json({ error: 'title, amount required' });
    return;
  }
  const obligation = await prisma.obligation.create({
    data: {
      userId: req.userId!, title,
      type: type as any, amount: Math.round(amount),
      dueDay: dueDay ?? null,
    },
  });
  res.status(201).json(obligation);
});

tg.patch('/obligations/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const ob = await prisma.obligation.findFirst({ where: { id, userId: req.userId! } });
  if (!ob) { res.status(404).json({ error: 'Not found' }); return; }
  const updated = await prisma.obligation.update({ where: { id }, data: req.body });
  res.json(updated);
});

tg.delete('/obligations/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const ob = await prisma.obligation.findFirst({ where: { id, userId: req.userId! } });
  if (!ob) { res.status(404).json({ error: 'Not found' }); return; }
  await prisma.obligation.delete({ where: { id } });
  res.json({ ok: true });
});

// ── Debts ───────────────────────────────────────────────

tg.get('/debts', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const [debts, activePeriod] = await Promise.all([
    prisma.debt.findMany({ where: { userId, isPaidOff: false }, orderBy: { apr: 'desc' } }),
    prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } }),
  ]);

  if (!activePeriod) {
    res.json(debts.map((d) => ({ ...d, currentPeriodPayment: null })));
    return;
  }

  const paymentEvents = await prisma.debtPaymentEvent.findMany({
    where: { userId, periodId: activePeriod.id, kind: 'REQUIRED_MIN_PAYMENT', deletedAt: null },
    select: { debtId: true, amountMinor: true },
  });
  const paidByDebt = new Map<string, number>();
  for (const ev of paymentEvents) {
    paidByDebt.set(ev.debtId, (paidByDebt.get(ev.debtId) ?? 0) + ev.amountMinor);
  }

  const enriched = debts.map((d) => {
    const paid = paidByDebt.get(d.id) ?? 0;
    const remaining = Math.max(0, d.minPayment - paid);
    const status: 'PAID' | 'PARTIAL' | 'UNPAID' =
      paid >= d.minPayment ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
    return { ...d, currentPeriodPayment: { required: d.minPayment, paid, remaining, status } };
  });
  res.json(enriched);
});

tg.post('/debts', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { title, type = 'OTHER', balance, apr, minPayment, dueDay } = req.body;

  if (!title || !balance || apr === undefined || !minPayment) {
    res.status(400).json({ error: 'title, balance, apr, minPayment required' });
    return;
  }

  // New debt — check if there's a focus debt
  const hasFocus = await prisma.debt.findFirst({ where: { userId, isFocusDebt: true, isPaidOff: false } });

  const debt = await prisma.debt.create({
    data: {
      userId,
      title,
      type: type as any,
      balance: Math.round(balance),
      originalAmount: Math.round(balance),
      apr,
      minPayment: Math.round(minPayment),
      dueDay: dueDay ?? null,
      isFocusDebt: !hasFocus,
    },
  });

  // Auto-recalculate active period
  try {
    await triggerRecalculate(userId);
  } catch { /* non-blocking */ }

  res.status(201).json(debt);
});

tg.patch('/debts/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const userId = req.userId!;
  const debt = await prisma.debt.findFirst({ where: { id, userId } });
  if (!debt) { res.status(404).json({ error: 'Not found' }); return; }
  const allowed = ['title', 'type', 'balance', 'apr', 'minPayment', 'dueDay'];
  const data: Record<string, any> = {};
  for (const key of allowed) {
    if (key in req.body) data[key] = req.body[key];
  }
  const updated = await prisma.debt.update({ where: { id }, data });

  // Auto-recalculate active period
  try {
    await triggerRecalculate(userId);
  } catch { /* non-blocking */ }

  res.json(updated);
});

tg.delete('/debts/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const userId = req.userId!;
  const debt = await prisma.debt.findFirst({ where: { id, userId } });
  if (!debt) { res.status(404).json({ error: 'Not found' }); return; }
  await prisma.debt.delete({ where: { id: debt.id } });

  // If deleted debt was focus, assign new focus
  if (debt.isFocusDebt) {
    const allDebts = await prisma.debt.findMany({ where: { userId, isPaidOff: false }, orderBy: { apr: 'desc' } });
    if (allDebts.length > 0) {
      const focusId = determineFocusDebt(allDebts.map((d) => ({ id: d.id, title: d.title, balance: d.balance, apr: d.apr, minPayment: d.minPayment, type: d.type })));
      if (focusId) await prisma.debt.update({ where: { id: focusId }, data: { isFocusDebt: true } });
    }
  }

  // Auto-recalculate active period
  try {
    await triggerRecalculate(userId);
  } catch { /* non-blocking */ }

  res.json({ ok: true });
});

// Debt payment
tg.post('/debts/:id/payment', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const { amount, isExtra = false } = req.body;

  const debt = await prisma.debt.findFirst({ where: { id, userId: req.userId! } });
  if (!debt) { res.status(404).json({ error: 'Not found' }); return; }
  if (!amount || amount <= 0) { res.status(400).json({ error: 'Invalid amount' }); return; }

  const paymentAmount = Math.round(amount);
  const newBalance = Math.max(0, debt.balance - paymentAmount);

  const [payment] = await Promise.all([
    prisma.debtPayment.create({
      data: { debtId: id, amount: paymentAmount, isExtra },
    }),
    prisma.debt.update({
      where: { id },
      data: {
        balance: newBalance,
        isPaidOff: newBalance === 0,
        paidOffAt: newBalance === 0 ? new Date() : null,
        isFocusDebt: newBalance === 0 ? false : debt.isFocusDebt,
      },
    }),
  ]);

  // If debt is paid off, reassign focus
  if (newBalance === 0) {
    const remaining = await prisma.debt.findMany({
      where: { userId: req.userId!, isPaidOff: false },
      orderBy: { apr: 'desc' },
    });
    if (remaining.length > 0) {
      const focusId = determineFocusDebt(remaining.map((d) => ({ id: d.id, title: d.title, balance: d.balance, apr: d.apr, minPayment: d.minPayment, type: d.type })));
      if (focusId) {
        await prisma.debt.updateMany({ where: { userId: req.userId! }, data: { isFocusDebt: false } });
        await prisma.debt.update({ where: { id: focusId }, data: { isFocusDebt: true } });
      }
    }
  }

  res.json({ ok: true, payment, newBalance });
});

// ── DebtPaymentEvent CRUD ────────────────────────────────────────────────────

tg.post('/debts/:debtId/payments', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const debtId = req.params.debtId as string;
  const { amountMinor, kind = 'REQUIRED_MIN_PAYMENT', note, paymentDate } = req.body;

  if (!amountMinor || typeof amountMinor !== 'number' || amountMinor <= 0) {
    res.status(400).json({ error: 'amountMinor must be a positive number' });
    return;
  }
  if (!['REQUIRED_MIN_PAYMENT', 'EXTRA_PRINCIPAL_PAYMENT'].includes(kind)) {
    res.status(400).json({ error: 'Invalid kind' });
    return;
  }

  const [debt, activePeriod] = await Promise.all([
    prisma.debt.findFirst({ where: { id: debtId, userId } }),
    prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } }),
  ]);
  if (!debt) { res.status(404).json({ error: 'Debt not found' }); return; }
  if (!activePeriod) { res.status(400).json({ error: 'No active period' }); return; }

  const amount = Math.round(amountMinor);

  // For EXTRA_PRINCIPAL_PAYMENT: reduce debt balance
  if (kind === 'EXTRA_PRINCIPAL_PAYMENT') {
    const newBalance = Math.max(0, debt.balance - amount);
    await prisma.debt.update({
      where: { id: debtId },
      data: {
        balance: newBalance,
        isPaidOff: newBalance === 0,
        paidOffAt: newBalance === 0 ? new Date() : null,
        isFocusDebt: newBalance === 0 ? false : debt.isFocusDebt,
      },
    });
    if (newBalance === 0) {
      const remaining = await prisma.debt.findMany({
        where: { userId, isPaidOff: false },
        orderBy: { apr: 'desc' },
      });
      if (remaining.length > 0) {
        const focusId = determineFocusDebt(remaining.map((d) => ({ id: d.id, title: d.title, balance: d.balance, apr: d.apr, minPayment: d.minPayment, type: d.type })));
        if (focusId) {
          await prisma.debt.updateMany({ where: { userId }, data: { isFocusDebt: false } });
          await prisma.debt.update({ where: { id: focusId }, data: { isFocusDebt: true } });
        }
      }
    }
  }

  const event = await prisma.debtPaymentEvent.create({
    data: {
      userId,
      debtId,
      periodId: activePeriod.id,
      amountMinor: amount,
      kind: kind as any,
      source: 'MANUAL',
      note: note ?? null,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
    },
  });

  try { await triggerRecalculate(userId); } catch { /* non-blocking */ }
  res.status(201).json(event);
});

tg.patch('/debts/:debtId/payments/:paymentId', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { debtId, paymentId } = req.params as { debtId: string; paymentId: string };
  const { amountMinor, note, paymentDate } = req.body;

  const event = await prisma.debtPaymentEvent.findFirst({
    where: { id: paymentId, debtId, userId, deletedAt: null },
  });
  if (!event) { res.status(404).json({ error: 'Payment not found' }); return; }

  if (amountMinor !== undefined && event.kind === 'EXTRA_PRINCIPAL_PAYMENT') {
    res.status(400).json({ error: 'Cannot edit amount on EXTRA_PRINCIPAL_PAYMENT; delete and recreate' });
    return;
  }

  const data: Record<string, any> = {};
  if (amountMinor !== undefined) data.amountMinor = Math.round(amountMinor);
  if (note !== undefined) data.note = note;
  if (paymentDate !== undefined) data.paymentDate = new Date(paymentDate);

  const updated = await prisma.debtPaymentEvent.update({ where: { id: paymentId }, data });
  try { await triggerRecalculate(userId); } catch { /* non-blocking */ }
  res.json(updated);
});

tg.delete('/debts/:debtId/payments/:paymentId', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { debtId, paymentId } = req.params as { debtId: string; paymentId: string };

  const event = await prisma.debtPaymentEvent.findFirst({
    where: { id: paymentId, debtId, userId, deletedAt: null },
  });
  if (!event) { res.status(404).json({ error: 'Payment not found' }); return; }

  // For EXTRA_PRINCIPAL_PAYMENT: recompute balance from scratch using remaining events
  if (event.kind === 'EXTRA_PRINCIPAL_PAYMENT') {
    const [debt, otherExtras] = await Promise.all([
      prisma.debt.findUnique({ where: { id: debtId } }),
      prisma.debtPaymentEvent.aggregate({
        where: { debtId, kind: 'EXTRA_PRINCIPAL_PAYMENT', deletedAt: null, id: { not: paymentId } },
        _sum: { amountMinor: true },
      }),
    ]);
    if (debt) {
      const totalExtra = otherExtras._sum.amountMinor ?? 0;
      const restoredBalance = Math.max(0, (debt.originalAmount ?? debt.balance) - totalExtra);
      await prisma.debt.update({
        where: { id: debtId },
        data: { balance: restoredBalance, isPaidOff: false, paidOffAt: null },
      });
    }
  }

  await prisma.debtPaymentEvent.update({ where: { id: paymentId }, data: { deletedAt: new Date() } });
  try { await triggerRecalculate(userId); } catch { /* non-blocking */ }
  res.json({ ok: true });
});

// Avalanche plan
tg.get('/debts/avalanche-plan', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const debts = await prisma.debt.findMany({
    where: { userId, isPaidOff: false },
    orderBy: { apr: 'desc' },
  });

  const activePeriod = await prisma.period.findFirst({
    where: { userId, status: 'ACTIVE' },
  });

  // Estimate monthly extra from current period
  const monthlyExtra = activePeriod ? Math.round(activePeriod.s2sPeriod * 0.10 / (activePeriod.daysTotal / 30)) : 0;

  const plan = buildAvalanchePlan(
    debts.map((d) => ({ id: d.id, title: d.title, balance: d.balance, apr: d.apr, minPayment: d.minPayment, type: d.type })),
    monthlyExtra
  );

  res.json(plan);
});

// ── Expenses (history) ─────────────────────────────────

tg.get('/expenses', async (req: AuthenticatedRequest, res) => {
  const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
  const offset = parseInt(req.query.offset as string || '0', 10);

  const activePeriod = await prisma.period.findFirst({
    where: { userId: req.userId!, status: 'ACTIVE' },
  });

  const where: any = { userId: req.userId! };
  if (activePeriod) where.periodId = activePeriod.id;

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { spentAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.expense.count({ where }),
  ]);

  res.json({ expenses, total, periodId: activePeriod?.id ?? null });
});

// Settings PATCH
tg.patch('/me/settings', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const allowed = [
    'morningNotifyTime', 'eveningNotifyTime',
    'morningNotifyEnabled', 'eveningNotifyEnabled',
    'paymentAlerts', 'deficitAlerts', 'weeklyDigest',
  ];
  const data: Record<string, any> = {};
  for (const key of allowed) {
    if (key in req.body) data[key] = req.body[key];
  }

  const settings = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  res.json(settings);
});

// Plan
tg.get('/me/plan', async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    include: { subscription: true },
  });

  const isPro =
    user?.godMode ||
    (user?.subscription?.status === 'ACTIVE' && user.subscription.currentPeriodEnd > new Date());

  res.json({
    plan: isPro ? 'PRO' : 'FREE',
    godMode: user?.godMode ?? false,
    subscription: user?.subscription ?? null,
  });
});

// ── Billing ─────────────────────────────────────────────

tg.post('/billing/pro/checkout', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;

  if (!BOT_TOKEN) {
    res.status(503).json({ error: 'Bot token not configured' });
    return;
  }

  // Check not already PRO
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });

  const isPro =
    user?.godMode ||
    (user?.subscription?.status === 'ACTIVE' && (user.subscription.currentPeriodEnd ?? new Date(0)) > new Date());

  if (isPro) {
    res.status(400).json({ error: 'Already PRO' });
    return;
  }

  // Create Telegram Stars invoice link
  const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'PFM PRO',
      description: 'Месячная подписка: аналитика, уведомления, экспорт данных',
      payload: `pro_${userId}`,
      currency: 'XTR',       // Telegram Stars
      prices: [{ label: 'PFM PRO (1 месяц)', amount: 100 }],
    }),
  });

  if (!tgRes.ok) {
    const err = await tgRes.json().catch(() => ({}));
    console.error('[PFM API] createInvoiceLink error:', err);
    res.status(502).json({ error: 'Failed to create invoice' });
    return;
  }

  const tgData = (await tgRes.json()) as { ok: boolean; result?: string };
  if (!tgData.ok || !tgData.result) {
    res.status(502).json({ error: 'Invalid Telegram response' });
    return;
  }

  res.json({ invoiceUrl: tgData.result });
});

app.use('/tg', tg);

// ── Internal Routes ────────────────────────────────────

const internal = express.Router();
internal.use(internalAuth);

// Store chat ID for notifications
internal.post('/store-chat-id', async (req, res) => {
  const { telegramId, chatId } = req.body;
  if (!telegramId || !chatId) {
    res.status(400).json({ error: 'telegramId and chatId required' });
    return;
  }
  await prisma.user.updateMany({
    where: { telegramId: String(telegramId) },
    data: { telegramChatId: String(chatId) },
  });
  res.json({ ok: true });
});

internal.post('/activate-subscription', async (req, res) => {
  const { telegramId, chargeId, amount } = req.body;

  const user = await prisma.user.findUnique({ where: { telegramId: String(telegramId) } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const subscription = await prisma.subscription.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      starsPrice: amount,
      telegramChargeId: chargeId,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
    update: {
      status: 'ACTIVE',
      starsPrice: amount,
      telegramChargeId: chargeId,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelledAt: null,
      cancelAtPeriodEnd: false,
    },
  });

  await prisma.paymentEvent.create({
    data: {
      userId: user.id,
      subscriptionId: subscription.id,
      telegramPaymentChargeId: chargeId,
      totalAmount: amount,
      eventType: 'subscription_activated',
    },
  });

  res.json({ ok: true, subscription });
});

app.use('/internal', internal);

// ── Start ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[PFM API] Running on port ${PORT}`);

  // Start cron jobs after server is up
  import('./cron').catch((err) => console.error('[PFM API] Failed to start cron:', err));
});
