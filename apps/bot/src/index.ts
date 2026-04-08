import { Telegraf, Context } from 'telegraf';
import { detectLocale, formatNumber, t, type Locale } from '@pfm/shared';

// ── Types ─────────────────────────────────────────────

interface DashboardResponse {
  onboardingDone: boolean;
  s2sToday: number; s2sDaily: number; s2sStatus: string;
  daysLeft: number; currency: string;
}

// ── Config ─────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://localhost:3003/miniapp';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3002';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

if (!BOT_TOKEN) {
  console.warn('[PFM Bot] BOT_TOKEN not set. Bot will idle.');
  setInterval(() => {}, 60_000);
  // eslint-disable-next-line no-constant-condition
  if (true) throw new Error('BOT_TOKEN is required');
}

const bot = new Telegraf(BOT_TOKEN);

// ── Locale helpers ────────────────────────────────────

function getLocale(ctx: Context): Locale {
  return detectLocale(ctx.from?.language_code);
}

function openAppKeyboard(locale: Locale, url: string) {
  return {
    inline_keyboard: [
      [{ text: t(locale, 'bot.openApp'), web_app: { url } }],
    ],
  };
}

// ── /start ─────────────────────────────────────────────

bot.start(async (ctx) => {
  const locale = getLocale(ctx);
  const payload = ctx.startPayload;

  // Store chatId for notifications
  try {
    await fetch(`${API_BASE_URL}/internal/store-chat-id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': ADMIN_KEY,
      },
      body: JSON.stringify({
        telegramId: ctx.from.id,
        chatId: ctx.chat.id,
      }),
    }).catch(() => {}); // non-blocking
  } catch {}

  // Set menu button
  try {
    await ctx.setChatMenuButton({
      type: 'web_app',
      text: 'PFM',
      web_app: { url: MINI_APP_URL },
    });
  } catch (err) {
    console.error('[PFM Bot] Failed to set menu button:', err);
  }

  if (payload) {
    // Deep link — open Mini App with payload
    await ctx.reply(t(locale, 'bot.welcomeShort'), {
      reply_markup: openAppKeyboard(locale, `${MINI_APP_URL}?startapp=${payload}`),
    });
  } else {
    // Regular start
    await ctx.reply(t(locale, 'bot.welcome'), {
      reply_markup: openAppKeyboard(locale, MINI_APP_URL),
    });
  }
});

// ── /today — quick S2S check ───────────────────────────

bot.command('today', async (ctx) => {
  const locale = getLocale(ctx);
  try {
    // Find user by telegram ID via internal endpoint
    const res = await fetch(`${API_BASE_URL}/tg/dashboard`, {
      headers: {
        'Content-Type': 'application/json',
        'X-TG-DEV': String(ctx.from.id),
      },
    });

    if (!res.ok) throw new Error('API error');
    const data = (await res.json()) as DashboardResponse;

    if (!data.onboardingDone) {
      await ctx.reply(t(locale, 'bot.onboardingFirst'), {
        reply_markup: openAppKeyboard(locale, MINI_APP_URL),
      });
      return;
    }

    const s2s = formatNumber(Math.round(data.s2sToday / 100), locale);
    const daily = formatNumber(Math.round(data.s2sDaily / 100), locale);
    const sym = data.currency === 'USD' ? '$' : '₽';
    const daysLeft = data.daysLeft;

    let emoji = '🟢';
    if (data.s2sStatus === 'OVERSPENT') emoji = '🔴';
    else if (data.s2sStatus === 'WARNING') emoji = '🟡';
    else if (data.s2sStatus === 'DEFICIT') emoji = '🔴';

    await ctx.reply(
      `${emoji} ${t(locale, 'bot.todayHeader')}\n\n` +
        t(locale, 'bot.todayBody', { s2s, sym, daily, daysLeft }),
      {
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(locale, MINI_APP_URL),
      },
    );
  } catch (err) {
    console.error('[PFM Bot] /today error:', err);
    await ctx.reply(t(locale, 'bot.genericError'));
  }
});

// ── /spend <amount> — quick expense ────────────────────

bot.command('spend', async (ctx) => {
  const locale = getLocale(ctx);
  const text = ctx.message.text.replace('/spend', '').trim();
  const parts = text.split(/\s+/);
  const amount = parseFloat(parts[0]);
  const note = parts.slice(1).join(' ') || undefined;

  if (!parts[0] || isNaN(amount) || amount <= 0) {
    await ctx.reply(t(locale, 'bot.spendUsage'));
    return;
  }

  try {
    const amountKop = Math.round(amount * 100);

    // Create expense via API
    const res = await fetch(`${API_BASE_URL}/tg/expenses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TG-DEV': String(ctx.from.id),
      },
      body: JSON.stringify({ amount: amountKop, note }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      if (err.error === 'No active period. Complete onboarding first.') {
        await ctx.reply(t(locale, 'bot.onboardingFirst'), {
          reply_markup: openAppKeyboard(locale, MINI_APP_URL),
        });
        return;
      }
      throw new Error('API error');
    }

    // Get updated S2S
    const dashRes = await fetch(`${API_BASE_URL}/tg/dashboard`, {
      headers: {
        'Content-Type': 'application/json',
        'X-TG-DEV': String(ctx.from.id),
      },
    });
    const data = (await dashRes.json()) as DashboardResponse;

    const s2s = formatNumber(Math.round(data.s2sToday / 100), locale);
    const sym = data.currency === 'USD' ? '$' : '₽';

    const noteText = note ? ` (${note})` : '';
    await ctx.reply(
      t(locale, 'bot.spendSuccess', { amount, sym, noteText, s2s }),
      {
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(locale, MINI_APP_URL),
      },
    );
  } catch (err) {
    console.error('[PFM Bot] /spend error:', err);
    await ctx.reply(t(locale, 'bot.genericError'));
  }
});

// ── /help ──────────────────────────────────────────────

bot.help(async (ctx) => {
  const locale = getLocale(ctx);
  await ctx.reply(t(locale, 'bot.help'), {
    reply_markup: openAppKeyboard(locale, MINI_APP_URL),
  });
});

// ── Pre-checkout (Telegram Stars) ──────────────────────

bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// ── Successful payment ─────────────────────────────────

bot.on('message', async (ctx, next) => {
  const msg = ctx.message;
  if ('successful_payment' in msg && msg.successful_payment) {
    const locale = getLocale(ctx);
    const payment = msg.successful_payment;
    try {
      await fetch(`${API_BASE_URL}/internal/activate-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': ADMIN_KEY,
        },
        body: JSON.stringify({
          telegramId: ctx.from.id,
          chargeId: payment.telegram_payment_charge_id,
          amount: payment.total_amount,
          currency: payment.currency,
        }),
      });
      await ctx.reply(t(locale, 'bot.payActivated'));
    } catch (err) {
      console.error('[PFM Bot] Payment processing error:', err);
      await ctx.reply(t(locale, 'bot.payError'));
    }
    return;
  }
  return next();
});

// ── Launch ─────────────────────────────────────────────

bot.launch({ dropPendingUpdates: true }).then(() => {
  console.log('[PFM Bot] Running (long polling)');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
