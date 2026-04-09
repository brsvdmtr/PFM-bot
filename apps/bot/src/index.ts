import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
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
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('[PFM Bot] answerPreCheckoutQuery failed:', err);
  }
});

// ── Successful payment ─────────────────────────────────

bot.on(message('successful_payment'), async (ctx) => {
  const locale = getLocale(ctx);
  const payment = ctx.message.successful_payment;

  console.log('[PFM Bot] successful_payment received', {
    telegramId: ctx.from.id,
    chargeId: payment.telegram_payment_charge_id,
    amount: payment.total_amount,
    currency: payment.currency,
    payload: payment.invoice_payload,
  });

  try {
    const res = await fetch(`${API_BASE_URL}/internal/activate-subscription`, {
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
        payload: payment.invoice_payload,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[PFM Bot] activate-subscription failed:', res.status, body);
      throw new Error(`activate-subscription HTTP ${res.status}`);
    }

    console.log('[PFM Bot] subscription activated for', ctx.from.id);
    await ctx.reply(t(locale, 'bot.payActivated'));
  } catch (err) {
    console.error('[PFM Bot] Payment processing error:', err);
    await ctx.reply(t(locale, 'bot.payError'));
  }
});

// ── Star payment reconciliation ────────────────────────

// Replays any star transactions that don't yet have a corresponding
// PaymentEvent in our DB. Safety net for races where successful_payment
// was missed (e.g. bot was being redeployed at the moment of payment).
async function reconcileStarPayments(): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getStarTransactions?limit=50`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      ok: boolean;
      result?: { transactions?: Array<{
        id: string;
        amount: number;
        source?: {
          type?: string;
          user?: { id?: number };
          invoice_payload?: string;
        };
      }> };
    };

    if (!data.ok) {
      console.warn('[PFM Bot] reconcileStarPayments: getStarTransactions failed', data);
      return;
    }

    const transactions = data.result?.transactions ?? [];
    let replayed = 0;
    let skipped = 0;

    for (const tx of transactions) {
      // Only incoming invoice payments (user -> bot) for PRO.
      if (tx.source?.type !== 'user') continue;
      if (!tx.source?.invoice_payload?.startsWith('pro_')) continue;

      const telegramId = tx.source.user?.id;
      const chargeId = tx.id;
      const amount = tx.amount;
      if (!telegramId || !chargeId || typeof amount !== 'number') continue;

      try {
        const r = await fetch(`${API_BASE_URL}/internal/activate-subscription`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Key': ADMIN_KEY,
          },
          body: JSON.stringify({
            telegramId,
            chargeId,
            amount,
            currency: 'XTR',
            payload: tx.source.invoice_payload,
          }),
        });

        if (!r.ok) {
          console.warn('[PFM Bot] reconcileStarPayments: activate failed', chargeId, r.status);
          continue;
        }

        const result = (await r.json().catch(() => ({}))) as { alreadyProcessed?: boolean };
        if (result.alreadyProcessed) {
          skipped++;
        } else {
          replayed++;
          console.log('[PFM Bot] reconcileStarPayments: replayed', { chargeId, telegramId });
        }
      } catch (err) {
        console.error('[PFM Bot] reconcileStarPayments: error replaying', chargeId, err);
      }
    }

    console.log('[PFM Bot] reconcileStarPayments done', {
      total: transactions.length,
      replayed,
      skipped,
    });
  } catch (err) {
    console.error('[PFM Bot] reconcileStarPayments failed:', err);
  }
}

// ── Launch ─────────────────────────────────────────────

// NOTE: do NOT pass dropPendingUpdates: true here. If a successful_payment
// arrives just before a redeploy, dropping it would lose the activation
// silently. We rely on idempotency at the API layer + reconciliation below.
//
// Explicit allowedUpdates ensures we always receive payment-related updates
// even if a previous bot instance had narrowed them via setWebhook/getUpdates.
bot.launch({
  allowedUpdates: ['message', 'callback_query', 'pre_checkout_query'],
}).then(() => {
  console.log('[PFM Bot] Running (long polling)');
});

// Telegraf v4: bot.launch() resolves on STOP, not start. Log eagerly so we
// can see in logs that the process reached the launch call.
console.log('[PFM Bot] launching...');

// Reconcile shortly after startup (give the API time to be ready), then
// every hour as a safety net.
setTimeout(() => { void reconcileStarPayments(); }, 10_000);
setInterval(() => { void reconcileStarPayments(); }, 60 * 60 * 1000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
