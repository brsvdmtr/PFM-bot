import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { prisma } from '@pfm/db';
import { calculateS2S, calculatePeriodBounds } from './engine';
import { determineFocusDebt } from './avalanche';

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

// ── App ────────────────────────────────────────────────

const app = express();
app.use(cors());
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

  const [user, activePeriod, todayExpenses] = await Promise.all([
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
    prisma.expense.findMany({
      where: {
        userId,
        spentAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
      orderBy: { spentAt: 'desc' },
    }),
  ]);

  if (!user || !activePeriod) {
    res.json({
      onboardingDone: user?.onboardingDone ?? false,
      s2sToday: 0,
      s2sDaily: 0,
      daysLeft: 0,
      daysTotal: 0,
      todayExpenses: [],
      focusDebt: null,
      emergencyFund: null,
    });
    return;
  }

  const todayTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
  const now = new Date();
  const daysLeft = Math.max(1, Math.ceil((activePeriod.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const focusDebt = user.debts.find((d) => d.isFocusDebt) ?? user.debts[0] ?? null;

  res.json({
    onboardingDone: user.onboardingDone,
    s2sToday: Math.max(0, activePeriod.s2sDaily - todayTotal),
    s2sDaily: activePeriod.s2sDaily,
    daysLeft,
    daysTotal: activePeriod.daysTotal,
    periodStart: activePeriod.startDate,
    periodEnd: activePeriod.endDate,
    todayExpenses,
    todayTotal,
    focusDebt: focusDebt
      ? {
          id: focusDebt.id,
          title: focusDebt.title,
          apr: focusDebt.apr,
          balance: focusDebt.balance,
          type: focusDebt.type,
        }
      : null,
    emergencyFund: user.emergencyFund
      ? {
          currentAmount: user.emergencyFund.currentAmount,
          targetAmount: user.obligations.reduce((sum, o) => sum + o.amount, 0) * user.emergencyFund.targetMonths,
        }
      : null,
    currency: activePeriod.currency,
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

  const [user, incomes, obligations, debts, ef] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.income.findMany({ where: { userId, isActive: true } }),
    prisma.obligation.findMany({ where: { userId, isActive: true } }),
    prisma.debt.findMany({ where: { userId, isPaidOff: false } }),
    prisma.emergencyFund.findUnique({ where: { userId } }),
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

  // Calculate period bounds from first income's paydays
  const paydays = incomes[0].paydays as number[];
  const today = new Date();
  const bounds = calculatePeriodBounds(paydays, today);

  // Calculate S2S
  const totalPeriodIncome = incomes.reduce((sum, inc) => {
    // Scale monthly amount to period days
    const monthlyAmount = inc.amount;
    return sum + (bounds.isProratedStart
      ? Math.round(monthlyAmount * (bounds.daysTotal / bounds.fullPeriodDays))
      : monthlyAmount);
  }, 0);

  const s2sResult = calculateS2S({
    incomes: incomes.map((inc) => ({ amount: inc.amount, paydays: inc.paydays as number[] })),
    obligations: obligations.map((o) => ({ amount: o.amount })),
    debts: debts.map((d) => ({
      id: d.id,
      balance: d.balance,
      apr: d.apr,
      minPayment: d.minPayment,
      isFocusDebt: d.isFocusDebt,
    })),
    emergencyFund: {
      currentAmount: ef?.currentAmount ?? 0,
      targetMonths: ef?.targetMonths ?? 3,
    },
    periodStartDate: bounds.start,
    periodEndDate: bounds.end,
    today,
    totalExpensesInPeriod: 0,
    todayExpenses: 0,
    isProratedStart: bounds.isProratedStart,
    fullPeriodDays: bounds.fullPeriodDays,
  });

  const currency = (user.primaryCurrency || 'RUB') as any;

  const period = await prisma.period.create({
    data: {
      userId,
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
      currency,
      isProratedStart: bounds.isProratedStart,
      status: 'ACTIVE',
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { onboardingDone: true },
  });

  res.json({
    period,
    s2s: s2sResult,
  });
});

// ── Debts ───────────────────────────────────────────────

tg.get('/debts', async (req: AuthenticatedRequest, res) => {
  const debts = await prisma.debt.findMany({
    where: { userId: req.userId!, isPaidOff: false },
    orderBy: { apr: 'desc' },
  });
  res.json(debts);
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

  res.status(201).json(debt);
});

tg.delete('/debts/:id', async (req: AuthenticatedRequest, res) => {
  const id = req.params.id as string;
  const debt = await prisma.debt.findFirst({ where: { id, userId: req.userId! } });
  if (!debt) { res.status(404).json({ error: 'Not found' }); return; }
  await prisma.debt.delete({ where: { id: debt.id } });
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

app.use('/tg', tg);

// ── Internal Routes ────────────────────────────────────

const internal = express.Router();
internal.use(internalAuth);

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
});
