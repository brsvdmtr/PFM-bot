import { Telegraf } from 'telegraf';

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

// ── /start ─────────────────────────────────────────────

bot.start(async (ctx) => {
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
    await ctx.reply('👋 Открываю PFM Bot...', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Открыть PFM 💰',
              web_app: { url: `${MINI_APP_URL}?startapp=${payload}` },
            },
          ],
        ],
      },
    });
  } else {
    // Regular start
    await ctx.reply(
      '👋 Привет! Я PFM Bot — помогу контролировать расходы и выбраться из долгов.\n\n' +
        'Нажми кнопку, чтобы открыть приложение 👇',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Открыть PFM 💰',
                web_app: { url: MINI_APP_URL },
              },
            ],
          ],
        },
      }
    );
  }
});

// ── /today — quick S2S check ───────────────────────────

bot.command('today', async (ctx) => {
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
      await ctx.reply('Сначала пройдите настройку в Mini App 👇', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Открыть PFM 💰', web_app: { url: MINI_APP_URL } }],
          ],
        },
      });
      return;
    }

    const s2s = (data.s2sToday / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
    const daily = (data.s2sDaily / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
    const sym = data.currency === 'USD' ? '$' : '₽';
    const daysLeft = data.daysLeft;

    let emoji = '🟢';
    if (data.s2sStatus === 'OVERSPENT') emoji = '🔴';
    else if (data.s2sStatus === 'WARNING') emoji = '🟡';
    else if (data.s2sStatus === 'DEFICIT') emoji = '🔴';

    await ctx.reply(
      `${emoji} *Safe to Spend сегодня:*\n\n` +
      `*${s2s} ${sym}*\n` +
      `из дневного лимита ${daily} ${sym}\n\n` +
      `📅 Осталось дней в периоде: ${daysLeft}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Открыть PFM 💰', web_app: { url: MINI_APP_URL } }],
          ],
        },
      }
    );
  } catch (err) {
    console.error('[PFM Bot] /today error:', err);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

// ── /spend <amount> — quick expense ────────────────────

bot.command('spend', async (ctx) => {
  const text = ctx.message.text.replace('/spend', '').trim();
  const parts = text.split(/\s+/);
  const amount = parseFloat(parts[0]);
  const note = parts.slice(1).join(' ') || undefined;

  if (!parts[0] || isNaN(amount) || amount <= 0) {
    await ctx.reply('Использование: /spend 500 обед\n(сумма в рублях, заметка опционально)');
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
        await ctx.reply('Сначала пройдите настройку в Mini App 👇', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Открыть PFM 💰', web_app: { url: MINI_APP_URL } }],
            ],
          },
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

    const s2s = (data.s2sToday / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
    const sym = data.currency === 'USD' ? '$' : '₽';

    const noteText = note ? ` (${note})` : '';
    await ctx.reply(
      `✅ Расход ${amount} ${sym}${noteText} записан.\n\n` +
      `Осталось сегодня: *${s2s} ${sym}*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Открыть PFM 💰', web_app: { url: MINI_APP_URL } }],
          ],
        },
      }
    );
  } catch (err) {
    console.error('[PFM Bot] /spend error:', err);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

// ── /help ──────────────────────────────────────────────

bot.help(async (ctx) => {
  await ctx.reply(
    'PFM Bot — персональный финансовый менеджер.\n\n' +
      '📊 Рассчитывает, сколько можно безопасно тратить каждый день\n' +
      '💳 Помогает выбраться из долгов (стратегия «лавина»)\n' +
      '🛡 Формирует подушку безопасности\n\n' +
      'Команды:\n' +
      '/start — Открыть приложение\n' +
      '/today — Лимит на сегодня\n' +
      '/spend <сумма> — Быстрый ввод расхода\n' +
      '/help — Справка',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть PFM 💰', web_app: { url: MINI_APP_URL } }],
        ],
      },
    }
  );
});

// ── Pre-checkout (Telegram Stars) ──────────────────────

bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// ── Successful payment ─────────────────────────────────

bot.on('message', async (ctx, next) => {
  const msg = ctx.message;
  if ('successful_payment' in msg && msg.successful_payment) {
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
      await ctx.reply('🎉 PRO подписка активирована! Спасибо за поддержку.');
    } catch (err) {
      console.error('[PFM Bot] Payment processing error:', err);
      await ctx.reply('Произошла ошибка при активации. Напишите в поддержку.');
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
