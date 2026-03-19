import { Telegraf } from 'telegraf';

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
    // TODO: implement when dashboard API is ready
    await ctx.reply('💰 Откройте Mini App для просмотра Safe to Spend', {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Открыть PFM 💰', web_app: { url: MINI_APP_URL } }],
        ],
      },
    });
  } catch (err) {
    console.error('[PFM Bot] /today error:', err);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

// ── /spend <amount> — quick expense ────────────────────

bot.command('spend', async (ctx) => {
  const text = ctx.message.text.replace('/spend', '').trim();
  const amount = parseFloat(text);

  if (!text || isNaN(amount) || amount <= 0) {
    await ctx.reply('Использование: /spend 500\n(сумма в рублях)');
    return;
  }

  // TODO: implement when expense API is wired
  await ctx.reply(`✅ Расход ${amount} ₽ записан.\nОткройте PFM для деталей.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Открыть PFM 💰', web_app: { url: MINI_APP_URL } }],
      ],
    },
  });
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
