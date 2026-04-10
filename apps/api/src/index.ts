import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { prisma } from '@pfm/db';
import { detectLocale, type Locale } from '@pfm/shared';
import { determineFocusDebt, buildAvalanchePlan, buildDebtStrategy, buildDebtAccelerationHint } from './avalanche';
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
  locale?: Locale;
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
  // Dev bypass (only in non-production)
  if (process.env.NODE_ENV !== 'production') {
    const devId = req.headers['x-tg-dev'] as string | undefined;
    if (devId) {
      req.tgUser = { id: parseInt(devId, 10), first_name: 'Dev' };
      next();
      return;
    }
  }

  // Bot server-to-server path: the bot process has ADMIN_KEY (it already
  // uses it for /internal/*) and tells us which Telegram user it is acting
  // on behalf of. This is how the bot calls /tg/expenses and /tg/dashboard
  // for /spend, /today, and free-text expense logging — the bot never has
  // Telegram initData, only the Mini App does.
  const internalKey = req.headers['x-internal-key'] as string | undefined;
  const botTelegramId = req.headers['x-bot-telegram-id'] as string | undefined;
  if (ADMIN_KEY && internalKey && internalKey === ADMIN_KEY && botTelegramId) {
    const parsed = parseInt(botTelegramId, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      req.tgUser = { id: parsed, first_name: 'Bot' };
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

/** Ensure user exists in DB, set req.userId and req.locale (with auto-redetect when not user-set). */
async function ensureUser(req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> {
  if (!req.tgUser) {
    next();
    return;
  }

  const telegramId = String(req.tgUser.id);
  const detected = detectLocale(req.tgUser.language_code);
  let user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        telegramId,
        firstName: req.tgUser.first_name,
        godMode: GOD_MODE_IDS.includes(telegramId),
        locale: detected,
        localeUserSet: false,
        profile: { create: { displayName: req.tgUser.first_name } },
        settings: { create: {} },
      },
    });
  } else if (!user.localeUserSet && user.locale !== detected) {
    // User hasn't manually picked a locale — auto-redetect from current Telegram language_code
    user = await prisma.user.update({
      where: { id: user.id },
      data: { locale: detected },
    });
  }

  req.userId = user.id;
  req.locale = (user.locale === 'ru' || user.locale === 'en' ? user.locale : 'en') as Locale;
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
        emergencyFund: { include: { buckets: { where: { isArchived: false } } } },
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

  // ── Savings adjustments from EmergencyFundEntry ─────────────────────────
  const efEntries = await prisma.emergencyFundEntry.findMany({
    where: { userId, periodId: activePeriod.id, affectsCurrentBudget: true, reversedAt: null },
    select: { type: true, amount: true, createdAt: true },
  });
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  // For today filter, use same timezone logic as expenses
  let periodSavingsAdjustment = 0;
  let todaySavingsAdjustment = 0;
  for (const e of efEntries) {
    const sign = e.type === 'DEPOSIT' ? 1 : e.type === 'WITHDRAWAL' ? -1 : 0;
    periodSavingsAdjustment += sign * e.amount;
    // Rough today check — same as todayExpenses logic
    if (e.createdAt >= todayStart) {
      todaySavingsAdjustment += sign * e.amount;
    }
  }

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
    cashOnHand: activePeriod.cashAnchorAmount ?? null,
    periodSavingsAdjustment,
    todaySavingsAdjustment,
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
      ? {
          currentAmount: user.emergencyFund.currentAmount,
          targetAmount:  user.obligations.reduce((s, o) => s + o.amount, 0) * user.emergencyFund.targetMonths,
          baseCurrency: user.emergencyFund.currency,
          progressPct: (() => {
            const ta = user.obligations.reduce((s, o) => s + o.amount, 0) * user.emergencyFund!.targetMonths;
            return ta > 0 ? Math.min(100, Math.round((user.emergencyFund!.currentAmount / ta) * 100)) : user.emergencyFund!.currentAmount > 0 ? 100 : 0;
          })(),
          bucketsCount: (user.emergencyFund as any).buckets?.length ?? 0,
          foreignBucketsCount: (user.emergencyFund as any).buckets?.filter((b: any) => b.currency !== user.emergencyFund!.currency).length ?? 0,
          excludedBucketsCount: (user.emergencyFund as any).buckets?.filter((b: any) => !b.countsTowardEmergencyFund).length ?? 0,
        }
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
    usesLiveWindow: (activePeriod.cashAnchorAmount ?? 0) > 0,
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

// Locale: get current effective locale + override flag
tg.get('/me/locale', async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { locale: true, localeUserSet: true },
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({
    locale: user.locale,
    userSet: user.localeUserSet,
    pref: user.localeUserSet ? user.locale : 'auto',
  });
});

// Locale: set explicit override (or revert to auto)
tg.patch('/me/locale', async (req: AuthenticatedRequest, res) => {
  const { pref } = req.body as { pref?: 'auto' | 'ru' | 'en' };
  if (pref !== 'auto' && pref !== 'ru' && pref !== 'en') {
    res.status(400).json({ error: 'pref must be auto, ru, or en' });
    return;
  }
  const userId = req.userId!;
  if (pref === 'auto') {
    const detected = detectLocale(req.tgUser?.language_code);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { locale: detected, localeUserSet: false },
      select: { locale: true, localeUserSet: true },
    });
    res.json({ locale: updated.locale, userSet: updated.localeUserSet, pref: 'auto' });
    return;
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { locale: pref, localeUserSet: true },
    select: { locale: true, localeUserSet: true },
  });
  res.json({ locale: updated.locale, userSet: updated.localeUserSet, pref: updated.locale });
});

// ── Onboarding ─────────────────────────────────────────

// Step 1 — Income
tg.post('/onboarding/income', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { amount, paydays, currency = 'RUB', title = 'Основной доход', useRussianWorkCalendar } = req.body;

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'Invalid amount' });
    return;
  }
  if (!paydays || !Array.isArray(paydays) || paydays.length === 0) {
    res.status(400).json({ error: 'paydays required' });
    return;
  }

  // Remove old incomes and recreate
  // Semantics B: DB stores per-payout amount. UI sends monthly total.
  // Convert: perPayout = monthly / paydays.length
  const perPayoutAmount = Math.round(amount / paydays.length);

  await prisma.income.deleteMany({ where: { userId } });
  const income = await prisma.income.create({
    data: {
      userId,
      title,
      amount: perPayoutAmount,
      currency: currency as any,
      paydays,
      useRussianWorkCalendar: useRussianWorkCalendar !== false,
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

// ── Emergency Fund Management ─────────────────────────────

// Helper: compute EF current amount from included active buckets in baseCurrency only
async function getEFCurrentFromBuckets(userId: string, efId: string, baseCurrency?: string): Promise<number> {
  const where: any = { userId, emergencyFundId: efId, countsTowardEmergencyFund: true, isArchived: false };
  if (baseCurrency) where.currency = baseCurrency;
  const result = await prisma.savingsBucket.aggregate({
    where,
    _sum: { currentAmount: true },
  });
  return result._sum.currentAmount ?? 0;
}

// Helper: sync EF.currentAmount from buckets (only baseCurrency counted)
async function syncEFBalance(userId: string, efId: string): Promise<number> {
  const ef = await prisma.emergencyFund.findUnique({ where: { id: efId }, select: { currency: true } });
  const amt = await getEFCurrentFromBuckets(userId, efId, ef?.currency ?? 'RUB');
  await prisma.emergencyFund.update({ where: { id: efId }, data: { currentAmount: amt } });
  return amt;
}

// Helper: capture before/after s2sDaily around a recalculate
async function computeRecalcDiff(userId: string): Promise<{
  s2sDailyBefore: number; s2sDailyAfter: number; changed: boolean; reason: string;
}> {
  const periodBefore = await prisma.period.findFirst({ where: { userId, status: 'ACTIVE' }, select: { s2sDaily: true } });
  const s2sDailyBefore = periodBefore?.s2sDaily ?? 0;
  await triggerRecalculate(userId);
  const periodAfter = await prisma.period.findFirst({ where: { userId, status: 'ACTIVE' }, select: { s2sDaily: true } });
  const s2sDailyAfter = periodAfter?.s2sDaily ?? 0;
  return { s2sDailyBefore, s2sDailyAfter, changed: s2sDailyBefore !== s2sDailyAfter, reason: 'EF_UPDATED' };
}

tg.get('/ef', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const [ef, obligations, activePeriod, incomes, plan] = await Promise.all([
    prisma.emergencyFund.findUnique({ where: { userId } }),
    prisma.obligation.findMany({ where: { userId, isActive: true } }),
    prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } }),
    prisma.income.findMany({ where: { userId, isActive: true } }),
    prisma.emergencyFundPlan.findUnique({ where: { userId } }),
  ]);
  if (!ef) { res.json(null); return; }

  // Compute current amount from buckets (or fall back to stored value if no buckets yet)
  const buckets = await prisma.savingsBucket.findMany({ where: { emergencyFundId: ef.id, isArchived: false } });
  const currentAmount = buckets.length > 0 ? await getEFCurrentFromBuckets(userId, ef.id, ef.currency) : ef.currentAmount;

  // Compute target based on plan mode
  const { computeTargetAmount } = await import('./domain/finance/efPlan');
  const totalObligations = obligations.reduce((s, o) => s + o.amount, 0);
  const monthlyIncome = incomes.reduce((s, i) => {
    const payCount = Array.isArray(i.paydays) ? (i.paydays as number[]).length : 1;
    return s + i.amount * payCount;
  }, 0);

  const targetMode = plan?.targetMode ?? 'BY_SALARY';
  const baseMonthlyAmount = plan?.baseMonthlyAmount ?? monthlyIncome;
  const targetMonths = plan?.targetMonths ?? ef.targetMonths;
  const targetAmount = computeTargetAmount(
    targetMode as any, baseMonthlyAmount, targetMonths, plan?.manualTargetAmount ?? null, totalObligations,
  );

  const progressPct = targetAmount > 0 ? Math.min(100, Math.round((currentAmount / targetAmount) * 100)) : currentAmount > 0 ? 100 : 0;

  // Feasibility
  const { computeEFPlan } = await import('./domain/finance/efPlan');
  const planResult = computeEFPlan({
    targetAmount, currentAmount, monthlyIncomeBase: baseMonthlyAmount,
    monthlyRequiredExpenses: totalObligations,
    contributionFrequency: (plan?.contributionFrequency ?? 'MONTHLY') as any,
    targetDeadlineAt: plan?.targetDeadlineAt ?? null,
    preferredPace: (plan?.preferredPace ?? null) as any,
    now: new Date(),
    locale: req.locale,
  });

  res.json({
    currentAmount, targetAmount,
    targetMode, baseMonthlyAmount, targetMonths,
    manualTargetAmount: plan?.manualTargetAmount ?? null,
    targetDeadlineAt: plan?.targetDeadlineAt?.toISOString() ?? null,
    contributionFrequency: plan?.contributionFrequency ?? 'MONTHLY',
    preferredPace: plan?.preferredPace ?? null,
    progressPct,
    remainingToTarget: Math.max(0, targetAmount - currentAmount),
    feasibility: planResult.feasibility,
    canAffectCurrentBudget: !!activePeriod,
    currency: ef.currency,
  });
});

// ── Buckets ──

tg.get('/ef/buckets', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const buckets = await prisma.savingsBucket.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, type: true, currency: true, currentAmount: true, countsTowardEmergencyFund: true, isArchived: true },
  });
  res.json({ items: buckets });
});

tg.post('/ef/buckets', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { name, type, currentAmount = 0, countsTowardEmergencyFund = true, currency } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return; }
  const validTypes = ['SAVINGS_ACCOUNT', 'DEPOSIT', 'CASH', 'CRYPTO', 'BROKERAGE', 'OTHER'];
  if (!validTypes.includes(type)) { res.status(400).json({ error: 'Invalid bucket type' }); return; }
  if (typeof currentAmount === 'number' && currentAmount < 0) { res.status(400).json({ error: 'Amount must be >= 0' }); return; }

  const validCurrencies = ['RUB', 'USD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'AED', 'TRY', 'USDT'];
  const bucketCurrency = currency && validCurrencies.includes(currency) ? currency : 'RUB';

  const ef = await prisma.emergencyFund.findUnique({ where: { userId } });
  if (!ef) { res.status(404).json({ error: 'EF not found. Complete onboarding first.' }); return; }

  // If currency differs from EF baseCurrency, don't count toward EF by default
  const isForeignCurrency = bucketCurrency !== ef.currency;
  const countsForEF = isForeignCurrency ? false
    : type === 'CRYPTO' ? (countsTowardEmergencyFund === true)
    : countsTowardEmergencyFund !== false;

  const bucket = await prisma.savingsBucket.create({
    data: {
      userId, emergencyFundId: ef.id,
      name: name.trim(), type: type as any,
      currency: bucketCurrency as any,
      currentAmount: Math.max(0, Math.round(currentAmount)),
      countsTowardEmergencyFund: countsForEF,
    },
  });

  await syncEFBalance(userId, ef.id);
  const recalcDiff = await computeRecalcDiff(userId);
  res.status(201).json({ bucket, recalcDiff });
});

tg.patch('/ef/buckets/:id', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const id = req.params.id as string;
  const bucket = await prisma.savingsBucket.findFirst({ where: { id, userId } });
  if (!bucket) { res.status(404).json({ error: 'Bucket not found' }); return; }

  const data: Record<string, any> = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim();
  if (req.body.countsTowardEmergencyFund !== undefined) data.countsTowardEmergencyFund = req.body.countsTowardEmergencyFund === true;
  if (req.body.isArchived !== undefined) data.isArchived = req.body.isArchived === true;
  if (req.body.type !== undefined) {
    const validTypes = ['SAVINGS_ACCOUNT', 'DEPOSIT', 'CASH', 'CRYPTO', 'BROKERAGE', 'OTHER'];
    if (validTypes.includes(req.body.type)) data.type = req.body.type;
  }
  if (req.body.currency !== undefined) {
    const validCurrencies = ['RUB', 'USD', 'EUR', 'GBP', 'CHF', 'CNY', 'JPY', 'AED', 'TRY', 'USDT'];
    if (validCurrencies.includes(req.body.currency)) data.currency = req.body.currency;
  }
  if (req.body.currentAmount !== undefined) {
    data.currentAmount = Math.max(0, Math.round(req.body.currentAmount));
  }

  const updated = await prisma.savingsBucket.update({ where: { id }, data });
  await syncEFBalance(userId, bucket.emergencyFundId);
  const recalcDiff = await computeRecalcDiff(userId);
  res.json({ bucket: updated, recalcDiff });
});

tg.delete('/ef/buckets/:id', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const id = req.params.id as string;
  const bucket = await prisma.savingsBucket.findFirst({ where: { id, userId } });
  if (!bucket) { res.status(404).json({ error: 'Bucket not found' }); return; }
  await prisma.savingsBucket.update({ where: { id }, data: { isArchived: true } });
  await syncEFBalance(userId, bucket.emergencyFundId);
  const recalcDiff = await computeRecalcDiff(userId);
  res.json({ ok: true, recalcDiff });
});

// ── Entries (operations on buckets) ──

tg.get('/ef/entries', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
  const entries = await prisma.emergencyFundEntry.findMany({
    where: { userId, reversedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { bucket: { select: { name: true } } },
  });
  res.json({
    items: entries.map((e) => ({
      id: e.id, bucketId: e.bucketId, bucketName: e.bucket?.name ?? null,
      type: e.type, amount: e.amount, affectsCurrentBudget: e.affectsCurrentBudget,
      note: e.note, createdAt: e.createdAt.toISOString(),
    })),
  });
});

tg.post('/ef/entries', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { bucketId, type, amount, affectsCurrentBudget = false, note } = req.body;

  if (!['DEPOSIT', 'WITHDRAWAL', 'BALANCE_SYNC'].includes(type)) {
    res.status(400).json({ error: 'type must be DEPOSIT, WITHDRAWAL, or BALANCE_SYNC' });
    return;
  }
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  const ef = await prisma.emergencyFund.findUnique({ where: { userId } });
  if (!ef) { res.status(404).json({ error: 'Emergency fund not found' }); return; }

  // Find bucket (optional for backward compat, required for new flow)
  let bucket: any = null;
  if (bucketId) {
    bucket = await prisma.savingsBucket.findFirst({ where: { id: bucketId, userId } });
    if (!bucket) { res.status(404).json({ error: 'Bucket not found' }); return; }
  }

  const targetBalance = bucket ? bucket.currentAmount : ef.currentAmount;

  // Validate withdrawal
  if (type === 'WITHDRAWAL' && amount > targetBalance) {
    res.status(400).json({ error: 'Cannot withdraw more than current balance' });
    return;
  }

  // Budget-affecting requires active period
  const activePeriod = affectsCurrentBudget
    ? await prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } })
    : null;
  if (affectsCurrentBudget && !activePeriod) {
    res.status(400).json({ error: 'No active period — cannot affect budget.' });
    return;
  }

  // Compute new balance
  let newBalance: number;
  if (type === 'BALANCE_SYNC') {
    newBalance = amount;
  } else if (type === 'DEPOSIT') {
    newBalance = targetBalance + amount;
  } else {
    newBalance = targetBalance - amount;
  }
  newBalance = Math.max(0, newBalance);

  // Atomic transaction
  const txOps: any[] = [
    prisma.emergencyFundEntry.create({
      data: {
        userId, emergencyFundId: ef.id,
        bucketId: bucket?.id ?? null,
        periodId: activePeriod?.id ?? null,
        type: type as any,
        amount: Math.round(amount),
        affectsCurrentBudget: affectsCurrentBudget === true,
        note: note ?? null,
      },
    }),
  ];

  if (bucket) {
    txOps.push(prisma.savingsBucket.update({ where: { id: bucket.id }, data: { currentAmount: newBalance } }));
  } else {
    txOps.push(prisma.emergencyFund.update({ where: { id: ef.id }, data: { currentAmount: newBalance } }));
  }

  const [entry] = await prisma.$transaction(txOps);

  // Sync EF total from buckets
  if (bucket) {
    await syncEFBalance(userId, ef.id);
  }

  // Recalculate period if budget-affecting
  if (affectsCurrentBudget && activePeriod) {
    try { await triggerRecalculate(userId); } catch {}
  }

  res.status(201).json({ entry, newBalance });
});

// ── Plan ──

tg.get('/ef/plan', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const [ef, plan, obligations, incomes] = await Promise.all([
    prisma.emergencyFund.findUnique({ where: { userId } }),
    prisma.emergencyFundPlan.findUnique({ where: { userId } }),
    prisma.obligation.findMany({ where: { userId, isActive: true } }),
    prisma.income.findMany({ where: { userId, isActive: true } }),
  ]);
  if (!ef) { res.json(null); return; }

  const { computeTargetAmount, computeEFPlan } = await import('./domain/finance/efPlan');
  const totalObligations = obligations.reduce((s, o) => s + o.amount, 0);
  const monthlyIncome = incomes.reduce((s, i) => {
    const payCount = Array.isArray(i.paydays) ? (i.paydays as number[]).length : 1;
    return s + i.amount * payCount;
  }, 0);

  const targetMode = (plan?.targetMode ?? 'BY_SALARY') as 'BY_SALARY' | 'BY_EXPENSES' | 'MANUAL';
  const baseMonthlyAmount = plan?.baseMonthlyAmount ?? monthlyIncome;
  const targetMonths = plan?.targetMonths ?? ef.targetMonths;

  // Get current amount from buckets
  const buckets = await prisma.savingsBucket.findMany({ where: { emergencyFundId: ef.id, isArchived: false } });
  const currentAmount = buckets.length > 0 ? await getEFCurrentFromBuckets(userId, ef.id) : ef.currentAmount;

  const targetAmount = computeTargetAmount(targetMode, baseMonthlyAmount, targetMonths, plan?.manualTargetAmount ?? null, totalObligations);

  const freq = (plan?.contributionFrequency ?? 'MONTHLY') as 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';
  const result = computeEFPlan({
    targetAmount, currentAmount, monthlyIncomeBase: baseMonthlyAmount,
    monthlyRequiredExpenses: totalObligations,
    contributionFrequency: freq,
    targetDeadlineAt: plan?.targetDeadlineAt ?? null,
    preferredPace: (plan?.preferredPace ?? null) as any,
    now: new Date(),
    locale: req.locale,
  });

  // Build selectedPlan from stored plan preferences
  const selMode = ((plan as any)?.planSelectionMode ?? null) as 'SYSTEM' | 'CUSTOM' | null;
  const customAmt = (plan as any)?.customContributionAmount as number | null ?? null;
  const customFreq = ((plan as any)?.customContributionFrequency ?? null) as 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY' | null;

  let selectedPlan: any = { mode: selMode, pace: plan?.preferredPace ?? null, contributionAmount: null, frequency: null, monthlyEquivalent: null, projectedMonthsToTarget: null, projectedTargetDate: null, loadPctOfFreeCashflow: null };

  if (selMode === 'SYSTEM' && plan?.preferredPace) {
    const sc = result.scenarios?.find((s: any) => s.pace === plan!.preferredPace);
    if (sc) {
      selectedPlan = { ...selectedPlan, contributionAmount: sc.contributionAmount, frequency: sc.frequency, monthlyEquivalent: sc.contributionAmount, projectedMonthsToTarget: sc.projectedMonthsToTarget, projectedTargetDate: sc.projectedTargetDate, loadPctOfFreeCashflow: sc.loadPctOfFreeCashflow };
    }
  } else if (selMode === 'CUSTOM' && customAmt && customAmt > 0) {
    const cFreq = customFreq ?? 'MONTHLY';
    const monthlyEq = cFreq === 'MONTHLY' ? customAmt : cFreq === 'WEEKLY' ? Math.round(customAmt * 52 / 12) : Math.round(customAmt * 26 / 12);
    const remainingGap = Math.max(0, targetAmount - currentAmount);
    const monthsToTarget = monthlyEq > 0 ? Math.ceil(remainingGap / monthlyEq) : null;
    const monthlyFCF = Math.max(0, baseMonthlyAmount - totalObligations);
    const loadPct = monthlyFCF > 0 ? Math.round(monthlyEq * 100 / monthlyFCF) : null;
    const projDate = monthsToTarget != null ? new Date(new Date().getTime() + monthsToTarget * 30.44 * 24 * 60 * 60 * 1000).toISOString() : null;

    // Comparison hint
    const gentle = result.scenarios?.find((s: any) => s.pace === 'GENTLE')?.contributionAmount ?? 0;
    const optimal = result.scenarios?.find((s: any) => s.pace === 'OPTIMAL')?.contributionAmount ?? 0;
    const aggressive = result.scenarios?.find((s: any) => s.pace === 'AGGRESSIVE')?.contributionAmount ?? 0;
    let comparisonHint: string | null = null;
    if (monthlyEq < gentle) comparisonHint = 'Мягче щадящего сценария';
    else if (monthlyEq < optimal) comparisonHint = 'Между щадящим и оптимальным';
    else if (monthlyEq < aggressive) comparisonHint = 'Между оптимальным и агрессивным';
    else comparisonHint = 'Агрессивнее системного максимума';

    selectedPlan = { mode: 'CUSTOM', pace: null, contributionAmount: customAmt, frequency: cFreq, monthlyEquivalent: monthlyEq, projectedMonthsToTarget: monthsToTarget, projectedTargetDate: projDate, loadPctOfFreeCashflow: loadPct, comparisonHint };
  }

  res.json({ ...result, selectedPlan });
});

tg.patch('/ef/plan', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const ef = await prisma.emergencyFund.findUnique({ where: { userId } });
  if (!ef) { res.status(404).json({ error: 'EF not found' }); return; }

  const data: Record<string, any> = {};
  if (req.body.targetMode !== undefined) data.targetMode = req.body.targetMode;
  if (req.body.baseMonthlyAmount !== undefined) data.baseMonthlyAmount = req.body.baseMonthlyAmount;
  if (req.body.targetMonths !== undefined) {
    data.targetMonths = req.body.targetMonths;
    // Also sync EF.targetMonths for backward compat
    await prisma.emergencyFund.update({ where: { id: ef.id }, data: { targetMonths: req.body.targetMonths } });
  }
  if (req.body.manualTargetAmount !== undefined) data.manualTargetAmount = req.body.manualTargetAmount;
  if (req.body.targetDeadlineAt !== undefined) data.targetDeadlineAt = req.body.targetDeadlineAt ? new Date(req.body.targetDeadlineAt) : null;
  if (req.body.contributionFrequency !== undefined) data.contributionFrequency = req.body.contributionFrequency;
  if (req.body.preferredPace !== undefined) data.preferredPace = req.body.preferredPace;
  if (req.body.planSelectionMode !== undefined) data.planSelectionMode = req.body.planSelectionMode;
  if (req.body.customContributionAmount !== undefined) data.customContributionAmount = req.body.customContributionAmount;
  if (req.body.customContributionFrequency !== undefined) data.customContributionFrequency = req.body.customContributionFrequency;

  const plan = await prisma.emergencyFundPlan.upsert({
    where: { userId },
    create: { userId, emergencyFundId: ef.id, ...data },
    update: data,
  });
  res.json(plan);
});

// Legacy PATCH /ef for backward compat (targetMonths only)
tg.patch('/ef', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { targetMonths } = req.body;
  if (!targetMonths || typeof targetMonths !== 'number' || targetMonths < 1 || targetMonths > 12) {
    res.status(400).json({ error: 'targetMonths must be 1-12' });
    return;
  }
  const ef = await prisma.emergencyFund.findUnique({ where: { userId } });
  if (!ef) { res.status(404).json({ error: 'Emergency fund not found' }); return; }

  await prisma.emergencyFund.update({ where: { id: ef.id }, data: { targetMonths } });
  // Also sync plan if exists
  await prisma.emergencyFundPlan.upsert({
    where: { userId },
    create: { userId, emergencyFundId: ef.id, targetMonths },
    update: { targetMonths },
  });
  res.json({ ok: true, targetMonths });
});

// ── Incomes CRUD ─────────────────────────────────────────

tg.get('/incomes', async (req: AuthenticatedRequest, res) => {
  const incomes = await prisma.income.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  // Return monthlyEquivalent for UI display (amount is per-payout in DB)
  const withMonthly = incomes.map((i) => ({
    ...i,
    monthlyEquivalent: i.amount * (Array.isArray(i.paydays) ? (i.paydays as number[]).length : 1),
  }));
  res.json(withMonthly);
});

tg.post('/incomes', async (req: AuthenticatedRequest, res) => {
  const { title, amount, paydays, currency = 'RUB', frequency = 'MONTHLY', useRussianWorkCalendar } = req.body;
  if (!title || !amount || !paydays) {
    res.status(400).json({ error: 'title, amount, paydays required' });
    return;
  }
  // Semantics B: UI sends monthly total, DB stores per-payout
  const payCount = Array.isArray(paydays) ? paydays.length : 1;
  const perPayoutAmount = Math.round(amount / payCount);

  const income = await prisma.income.create({
    data: {
      userId: req.userId!, title,
      amount: perPayoutAmount, paydays,
      currency: currency as any, frequency: frequency as any,
      useRussianWorkCalendar: useRussianWorkCalendar === true,
    },
  });
  res.status(201).json(income);
});

tg.patch('/incomes/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const income = await prisma.income.findFirst({ where: { id, userId: req.userId! } });
  if (!income) { res.status(404).json({ error: 'Not found' }); return; }

  const data: Record<string, any> = {};
  if (req.body.title !== undefined) data.title = req.body.title;
  if (req.body.currency !== undefined) data.currency = req.body.currency;
  if (req.body.useRussianWorkCalendar !== undefined) data.useRussianWorkCalendar = req.body.useRussianWorkCalendar === true;

  // If amount or paydays change, convert monthly→per-payout
  const newPaydays = req.body.paydays ?? (income.paydays as number[]);
  if (req.body.amount !== undefined) {
    const payCount = Array.isArray(newPaydays) ? newPaydays.length : 1;
    data.amount = Math.round(req.body.amount / payCount);
  }
  if (req.body.paydays !== undefined) {
    data.paydays = req.body.paydays;
    // If paydays changed but amount wasn't sent, recalculate stored per-payout from current monthly equivalent
    if (req.body.amount === undefined) {
      const currentPayCount = Array.isArray(income.paydays) ? (income.paydays as number[]).length : 1;
      const monthlyEquiv = income.amount * currentPayCount;
      const newPayCount = Array.isArray(req.body.paydays) ? req.body.paydays.length : 1;
      data.amount = Math.round(monthlyEquiv / newPayCount);
    }
  }

  const updated = await prisma.income.update({ where: { id }, data });
  try { await triggerRecalculate(req.userId!); } catch {}
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

  // Validation
  if ('balance' in req.body && (typeof req.body.balance !== 'number' || req.body.balance <= 0)) {
    res.status(400).json({ error: 'balance must be a positive number' }); return;
  }
  if ('apr' in req.body && (typeof req.body.apr !== 'number' || req.body.apr < 0 || req.body.apr > 1)) {
    res.status(400).json({ error: 'apr must be between 0 and 1' }); return;
  }
  if ('minPayment' in req.body && (typeof req.body.minPayment !== 'number' || req.body.minPayment < 0)) {
    res.status(400).json({ error: 'minPayment must be >= 0' }); return;
  }
  if ('dueDay' in req.body && req.body.dueDay !== null && (typeof req.body.dueDay !== 'number' || req.body.dueDay < 1 || req.body.dueDay > 31)) {
    res.status(400).json({ error: 'dueDay must be 1-31 or null' }); return;
  }
  if ('title' in req.body) req.body.title = String(req.body.title).trim();

  const allowed = ['title', 'type', 'balance', 'apr', 'minPayment', 'dueDay'];
  const data: Record<string, any> = {};
  for (const key of allowed) {
    if (key in req.body) data[key] = req.body[key];
  }
  const updated = await prisma.debt.update({ where: { id }, data });

  // Reassign focus debt if APR or balance changed (avalanche priority may shift)
  if ('apr' in req.body || 'balance' in req.body) {
    const allActive = await prisma.debt.findMany({ where: { userId, isPaidOff: false }, orderBy: { apr: 'desc' } });
    if (allActive.length > 0) {
      const focusId = determineFocusDebt(allActive.map((d) => ({ id: d.id, title: d.title, balance: d.balance, apr: d.apr, minPayment: d.minPayment, type: d.type })));
      if (focusId) {
        await prisma.debt.updateMany({ where: { userId }, data: { isFocusDebt: false } });
        await prisma.debt.update({ where: { id: focusId }, data: { isFocusDebt: true } });
      }
    }
  }

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

  // Auto-recalculate active period
  try { await triggerRecalculate(req.userId!); } catch { /* non-blocking */ }

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

// Debt strategy — actionable "what to do next" with correct payoff forecast
tg.get('/debts/strategy', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;

  const [debts, activePeriod, user] = await Promise.all([
    prisma.debt.findMany({ where: { userId }, orderBy: { apr: 'desc' } }),
    prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  const currency = user?.primaryCurrency ?? 'RUB';

  // Derive avalanchePool from stored period snapshot fields:
  // s2sPeriod = totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - avalanchePool
  // => avalanchePool = totalIncome - totalObligations - totalDebtPayments - reserve - efContribution - s2sPeriod
  const avalanchePool = activePeriod
    ? Math.max(
        0,
        activePeriod.totalIncome
          - activePeriod.totalObligations
          - activePeriod.totalDebtPayments
          - (activePeriod.reserve ?? 0)
          - (activePeriod.efContribution ?? 0)
          - activePeriod.s2sPeriod,
      )
    : 0;
  const daysTotal = activePeriod?.daysTotal ?? 30;

  const strategy = buildDebtStrategy(
    debts.map((d) => ({
      id: d.id,
      title: d.title,
      balance: d.balance,
      apr: d.apr,
      minPayment: d.minPayment,
      isFocusDebt: d.isFocusDebt,
      isPaidOff: d.isPaidOff,
    })),
    avalanchePool,
    daysTotal,
    currency,
    req.locale,
  );

  // Build acceleration hint
  const focusItem = strategy.items.find((i) => i.isFocus);
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  const isPro = user?.godMode || (subscription?.status === 'ACTIVE' && (subscription.currentPeriodEnd ?? new Date(0)) > new Date());

  // Live s2sDaily from period snapshot
  const s2sDaily = activePeriod?.s2sDaily ?? 0;

  const accelerationHint = buildDebtAccelerationHint({
    focusDebt: focusItem ? { id: focusItem.debtId, balance: focusItem.balance, apr: focusItem.apr, minPayment: focusItem.minPayment } : null,
    baselineMonthlyPayment: focusItem?.baseline.monthlyPaymentUsed ?? 0,
    s2sDaily,
    isPro: isPro === true,
    currency,
    locale: req.locale,
  });

  res.json({ ...strategy, accelerationHint });
});

// ── Free Cash Recommendation ──────────────────────────────
//
// Flow: user enters a windfall (premium, bonus, gift) → we recommend where
// to park it (EF / debt / split) → user tweaks → apply in one atomic tx.
// Domain logic lives in domain/finance/freeCashRecommendation.ts.

type FreeCashContextInput = {
  userId: string;
  amountMinor: number;
};

async function buildFreeCashContext(params: FreeCashContextInput) {
  const { userId, amountMinor } = params;
  const [ef, obligations, incomes, debts, plan, user] = await Promise.all([
    prisma.emergencyFund.findUnique({ where: { userId } }),
    prisma.obligation.findMany({ where: { userId, isActive: true } }),
    prisma.income.findMany({ where: { userId, isActive: true } }),
    prisma.debt.findMany({ where: { userId }, orderBy: { apr: 'desc' } }),
    prisma.emergencyFundPlan.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);

  // EF balance: from buckets if any, else stored legacy value (or 0 if no EF)
  let efCurrentMinor = 0;
  let efTargetMinor = 0;
  if (ef) {
    const buckets = await prisma.savingsBucket.findMany({
      where: { emergencyFundId: ef.id, isArchived: false },
    });
    efCurrentMinor = buckets.length > 0
      ? await getEFCurrentFromBuckets(userId, ef.id)
      : ef.currentAmount;

    const { computeTargetAmount } = await import('./domain/finance/efPlan');
    const totalObligations = obligations.reduce((s, o) => s + o.amount, 0);
    const monthlyIncome = incomes.reduce((s, i) => {
      const payCount = Array.isArray(i.paydays) ? (i.paydays as number[]).length : 1;
      return s + i.amount * payCount;
    }, 0);
    const targetMode = (plan?.targetMode ?? 'BY_SALARY') as 'BY_SALARY' | 'BY_EXPENSES' | 'MANUAL';
    const baseMonthlyAmount = plan?.baseMonthlyAmount ?? monthlyIncome;
    const targetMonths = plan?.targetMonths ?? ef.targetMonths;
    efTargetMinor = computeTargetAmount(
      targetMode,
      baseMonthlyAmount,
      targetMonths,
      plan?.manualTargetAmount ?? null,
      totalObligations,
    );
  }

  const monthlyEssentialsMinor = obligations.reduce((s, o) => s + o.amount, 0);
  const currency = user?.primaryCurrency ?? 'RUB';

  return {
    input: {
      amountMinor,
      efCurrentMinor,
      efTargetMinor,
      monthlyEssentialsMinor,
      debts: debts.map((d) => ({
        id: d.id,
        title: d.title,
        balance: d.balance,
        apr: d.apr,
        minPayment: d.minPayment,
        isFocusDebt: d.isFocusDebt,
        isPaidOff: d.isPaidOff,
      })),
    },
    ef,
    currency,
  };
}

tg.post('/free-cash/preview', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { amountMinor, mode, splitEfShare } = req.body as {
    amountMinor?: number;
    mode?: 'EMERGENCY_FUND' | 'DEBT_PREPAY' | 'SPLIT';
    splitEfShare?: number;
  };

  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor) || amountMinor <= 0) {
    res.status(400).json({ error: 'amountMinor must be a positive number' });
    return;
  }
  if (mode !== undefined && !['EMERGENCY_FUND', 'DEBT_PREPAY', 'SPLIT'].includes(mode)) {
    res.status(400).json({ error: 'Invalid mode' });
    return;
  }
  if (splitEfShare !== undefined && (typeof splitEfShare !== 'number' || splitEfShare < 0 || splitEfShare > 1)) {
    res.status(400).json({ error: 'splitEfShare must be 0..1' });
    return;
  }

  const { input, currency } = await buildFreeCashContext({ userId, amountMinor: Math.round(amountMinor) });
  const { recommendFreeCash } = await import('./domain/finance/freeCashRecommendation');

  const recommendation = recommendFreeCash(input, {
    mode,
    splitEfShare,
  });

  res.json({
    ...recommendation,
    currency,
    // Echo snapshot so UI can display EF state without another call
    snapshot: {
      efCurrentMinor: input.efCurrentMinor,
      efTargetMinor: input.efTargetMinor,
      monthlyEssentialsMinor: input.monthlyEssentialsMinor,
    },
  });
});

tg.post('/free-cash/apply', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { amountMinor, mode, splitEfShare, note } = req.body as {
    amountMinor?: number;
    mode?: 'EMERGENCY_FUND' | 'DEBT_PREPAY' | 'SPLIT';
    splitEfShare?: number;
    note?: string;
  };

  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor) || amountMinor <= 0) {
    res.status(400).json({ error: 'amountMinor must be a positive number' });
    return;
  }
  if (!mode || !['EMERGENCY_FUND', 'DEBT_PREPAY', 'SPLIT'].includes(mode)) {
    res.status(400).json({ error: 'mode is required (EMERGENCY_FUND | DEBT_PREPAY | SPLIT)' });
    return;
  }
  if (splitEfShare !== undefined && (typeof splitEfShare !== 'number' || splitEfShare < 0 || splitEfShare > 1)) {
    res.status(400).json({ error: 'splitEfShare must be 0..1' });
    return;
  }

  // Recompute recommendation server-side — never trust client for money math.
  const { input, ef, currency } = await buildFreeCashContext({ userId, amountMinor: Math.round(amountMinor) });
  const { recommendFreeCash } = await import('./domain/finance/freeCashRecommendation');
  const recommendation = recommendFreeCash(input, {
    mode,
    splitEfShare,
  });

  if (recommendation.belowThreshold) {
    res.status(400).json({ error: 'Amount below significant threshold — use /tg/ef/entries or /tg/incomes directly' });
    return;
  }

  const { primaryEffect } = recommendation;
  const toEf = primaryEffect.toEmergencyFundMinor;
  const toDebt = primaryEffect.toDebtMinor;
  const focusDebtId = primaryEffect.focusDebtId;

  // Load active period (needed for DebtPaymentEvent FK)
  const activePeriod = await prisma.period.findFirst({ where: { userId, status: 'ACTIVE' } });

  // Validate: debt payment requires active period
  if (toDebt > 0 && !activePeriod) {
    res.status(400).json({ error: 'No active period — cannot record debt payment' });
    return;
  }
  // Validate: EF deposit requires an EF record
  if (toEf > 0 && !ef) {
    res.status(400).json({ error: 'Emergency fund not set up' });
    return;
  }

  // For EF deposit, pick target bucket (first non-archived), or null for legacy path
  let targetBucket: { id: string; currentAmount: number } | null = null;
  if (toEf > 0 && ef) {
    const bucket = await prisma.savingsBucket.findFirst({
      where: { emergencyFundId: ef.id, isArchived: false, countsTowardEmergencyFund: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, currentAmount: true },
    });
    targetBucket = bucket ?? null;
  }

  // Atomic transaction: create all records + update balances together
  const result = await prisma.$transaction(async (tx) => {
    let efEntryId: string | null = null;
    let debtEventId: string | null = null;

    // ── EF side ──
    if (toEf > 0 && ef) {
      const efEntry = await tx.emergencyFundEntry.create({
        data: {
          userId,
          emergencyFundId: ef.id,
          bucketId: targetBucket?.id ?? null,
          periodId: activePeriod?.id ?? null,
          type: 'DEPOSIT',
          amount: toEf,
          affectsCurrentBudget: false, // free cash is new money, not a reallocation
          note: note ?? 'Free cash',
        },
      });
      efEntryId = efEntry.id;

      if (targetBucket) {
        await tx.savingsBucket.update({
          where: { id: targetBucket.id },
          data: { currentAmount: targetBucket.currentAmount + toEf },
        });
      } else {
        // Legacy path: no buckets → update ef.currentAmount directly
        await tx.emergencyFund.update({
          where: { id: ef.id },
          data: { currentAmount: ef.currentAmount + toEf },
        });
      }
    }

    // ── Debt side ──
    if (toDebt > 0 && focusDebtId && activePeriod) {
      const debt = await tx.debt.findFirst({ where: { id: focusDebtId, userId } });
      if (!debt) throw new Error('Focus debt disappeared mid-transaction');

      const newBalance = Math.max(0, debt.balance - toDebt);
      await tx.debt.update({
        where: { id: focusDebtId },
        data: {
          balance: newBalance,
          isPaidOff: newBalance === 0,
          paidOffAt: newBalance === 0 ? new Date() : null,
          isFocusDebt: newBalance === 0 ? false : debt.isFocusDebt,
        },
      });

      const debtEvent = await tx.debtPaymentEvent.create({
        data: {
          userId,
          debtId: focusDebtId,
          periodId: activePeriod.id,
          amountMinor: toDebt,
          kind: 'EXTRA_PRINCIPAL_PAYMENT',
          source: 'MANUAL',
          note: note ?? 'Free cash',
        },
      });
      debtEventId = debtEvent.id;
    }

    // ── History record ──
    const historyRecord = await tx.freeCashEvent.create({
      data: {
        userId,
        periodId: activePeriod?.id ?? null,
        amountMinor: Math.round(amountMinor),
        currency: currency as any,
        recommendedMode: recommendation.defaultMode as any,
        reasonCode: recommendation.reasonCode as any,
        chosenMode: recommendation.mode as any,
        splitEfShare: recommendation.splitEfShare,
        toEfMinor: toEf,
        toDebtMinor: toDebt,
        focusDebtId: focusDebtId ?? null,
        efCurrentMinor: input.efCurrentMinor,
        efTargetMinor: input.efTargetMinor,
        monthlyEssentialsMinor: input.monthlyEssentialsMinor,
        note: note ?? null,
      },
    });

    return { efEntryId, debtEventId, historyId: historyRecord.id };
  });

  // Post-commit side effects (non-blocking):
  // - Reassign focus debt if the old focus was paid off
  // - Sync EF legacy balance from buckets
  // - Trigger period recalculate
  if (toDebt > 0 && focusDebtId) {
    const updated = await prisma.debt.findUnique({ where: { id: focusDebtId } });
    if (updated?.isPaidOff) {
      const remaining = await prisma.debt.findMany({
        where: { userId, isPaidOff: false },
        orderBy: { apr: 'desc' },
      });
      if (remaining.length > 0) {
        const newFocusId = determineFocusDebt(
          remaining.map((d) => ({ id: d.id, title: d.title, balance: d.balance, apr: d.apr, minPayment: d.minPayment, type: d.type })),
        );
        if (newFocusId) {
          await prisma.debt.updateMany({ where: { userId }, data: { isFocusDebt: false } });
          await prisma.debt.update({ where: { id: newFocusId }, data: { isFocusDebt: true } });
        }
      }
    }
  }
  if (toEf > 0 && ef && targetBucket) {
    try { await syncEFBalance(userId, ef.id); } catch { /* non-blocking */ }
  }
  try { await triggerRecalculate(userId); } catch { /* non-blocking */ }

  res.status(201).json({
    ok: true,
    applied: {
      toEmergencyFundMinor: toEf,
      toDebtMinor: toDebt,
      mode: recommendation.mode,
      focusDebtId: focusDebtId ?? null,
    },
    historyId: result.historyId,
  });
});

// ── Analytics (simple stdout logger) ──────────────────────────
//
// MVP: we just pipe events to stdout as JSON so they're picked up by
// Docker logs / journalctl. Later we can swap for a real analytics sink
// without changing the frontend.

tg.post('/events', async (req: AuthenticatedRequest, res) => {
  const userId = req.userId!;
  const { event, props } = req.body as { event?: string; props?: Record<string, unknown> };

  if (!event || typeof event !== 'string' || event.length > 100) {
    res.status(400).json({ error: 'event is required (string, max 100 chars)' });
    return;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    type: 'analytics_event',
    event,
    userId,
    ts: new Date().toISOString(),
    props: props ?? {},
  }));

  res.json({ ok: true });
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
  console.log('[PFM API] /internal/activate-subscription', { telegramId, chargeId, amount });

  if (!telegramId || !chargeId || typeof amount !== 'number') {
    res.status(400).json({ error: 'telegramId, chargeId, amount required' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { telegramId: String(telegramId) } });
    if (!user) {
      console.error('[PFM API] activate-subscription: user not found', telegramId);
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Idempotency: if we've already recorded this charge, do nothing.
    // This is what makes startup reconciliation safe to replay.
    const existingEvent = await prisma.paymentEvent.findUnique({
      where: { telegramPaymentChargeId: String(chargeId) },
    });
    if (existingEvent) {
      console.log('[PFM API] activate-subscription: chargeId already processed', chargeId);
      res.json({ ok: true, alreadyProcessed: true });
      return;
    }

    const now = new Date();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    // Extend if there's an active period, otherwise start fresh from now.
    const existingSub = await prisma.subscription.findUnique({ where: { userId: user.id } });
    const baseTime =
      existingSub && existingSub.currentPeriodEnd > now
        ? existingSub.currentPeriodEnd.getTime()
        : now.getTime();
    const periodEnd = new Date(baseTime + THIRTY_DAYS_MS);
    const periodStart = existingSub ? existingSub.currentPeriodStart : now;

    const subscription = await prisma.subscription.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        status: 'ACTIVE',
        starsPrice: amount,
        telegramChargeId: String(chargeId),
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
      update: {
        status: 'ACTIVE',
        starsPrice: amount,
        telegramChargeId: String(chargeId),
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelledAt: null,
        cancelAtPeriodEnd: false,
      },
    });

    // PaymentEvent has a unique constraint on telegramPaymentChargeId.
    // Catch P2002 in case of a concurrent insert race.
    try {
      await prisma.paymentEvent.create({
        data: {
          userId: user.id,
          subscriptionId: subscription.id,
          telegramPaymentChargeId: String(chargeId),
          totalAmount: amount,
          eventType: 'subscription_activated',
        },
      });
    } catch (eventErr: any) {
      if (eventErr?.code === 'P2002') {
        console.warn('[PFM API] PaymentEvent race for chargeId', chargeId);
      } else {
        throw eventErr;
      }
    }

    console.log('[PFM API] subscription activated', { userId: user.id, periodEnd });
    res.json({ ok: true, subscription });
  } catch (err) {
    console.error('[PFM API] activate-subscription failed:', err);
    res.status(500).json({ error: 'Activation failed' });
  }
});

app.use('/internal', internal);

// ── Start ──────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[PFM API] Running on port ${PORT}`);

  // Start cron jobs after server is up
  import('./cron').catch((err) => console.error('[PFM API] Failed to start cron:', err));
});
