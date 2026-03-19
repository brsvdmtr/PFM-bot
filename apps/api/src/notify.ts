// ── Telegram notification sender ────────────────────────
// Calls Telegram Bot API directly (no Telegraf dependency)

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://localhost:3003/miniapp';

// ── Low-level send ──────────────────────────────────────

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: 'Markdown' | 'HTML' = 'Markdown',
): Promise<void> {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        reply_markup: {
          inline_keyboard: [[{ text: 'Открыть PFM 💰', web_app: { url: MINI_APP_URL } }]],
        },
      }),
    });
  } catch (err) {
    console.error('[PFM Notify] Failed to send message:', err);
  }
}

// ── Notification builders ───────────────────────────────

export async function sendMorningNotification(
  chatId: string,
  s2sToday: number,
  s2sDaily: number,
  daysLeft: number,
  currency: string,
  s2sStatus: string,
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => (n / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

  let emoji = '🟢';
  if (s2sStatus === 'OVERSPENT' || s2sStatus === 'DEFICIT') emoji = '🔴';
  else if (s2sStatus === 'WARNING') emoji = '🟡';

  const text =
    `🌅 *Доброе утро!*\n\n` +
    `${emoji} *Safe to Spend сегодня:*\n` +
    `*${fmt(s2sToday)} ${sym}*\n` +
    `из дневного лимита ${fmt(s2sDaily)} ${sym}\n\n` +
    `📅 Осталось дней в периоде: ${daysLeft}`;

  await sendTelegramMessage(chatId, text);
}

export async function sendEveningNotification(
  chatId: string,
  todaySpent: number,
  s2sDaily: number,
  currency: string,
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => (n / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  const remaining = s2sDaily - todaySpent;
  const isOverspent = remaining < 0;

  const statusLine = isOverspent
    ? `⚠️ Перерасход: *${fmt(Math.abs(remaining))} ${sym}* — завтра лимит уменьшится`
    : `✅ Остаток: *${fmt(remaining)} ${sym}*`;

  const text =
    `🌙 *Итог дня*\n\n` +
    `Потрачено сегодня: *${fmt(todaySpent)} ${sym}*\n` +
    `Дневной лимит: ${fmt(s2sDaily)} ${sym}\n\n` +
    statusLine;

  await sendTelegramMessage(chatId, text);
}

export async function sendPaymentAlert(
  chatId: string,
  debtTitle: string,
  minPayment: number,
  currency: string,
  daysUntil: number,
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => (n / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  const when = daysUntil === 0 ? 'сегодня' : 'завтра';

  const text =
    `⚠️ *Напоминание о платеже*\n\n` +
    `${when.charAt(0).toUpperCase() + when.slice(1)} нужно заплатить по «${debtTitle}»:\n` +
    `*${fmt(minPayment)} ${sym}*\n\n` +
    `Не забудьте внести платёж вовремя!`;

  await sendTelegramMessage(chatId, text);
}

export async function sendNewPeriodNotification(
  chatId: string,
  s2sDaily: number,
  daysTotal: number,
  currency: string,
  prevSaved?: number,
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => (n / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

  const savedLine =
    prevSaved !== undefined && prevSaved > 0
      ? `\n✨ В прошлом периоде сэкономили: *${fmt(prevSaved)} ${sym}*`
      : prevSaved !== undefined && prevSaved < 0
        ? `\n⚠️ Перерасход в прошлом периоде: *${fmt(Math.abs(prevSaved))} ${sym}*`
        : '';

  const text =
    `🔄 *Начался новый период!*${savedLine}\n\n` +
    `💰 Дневной лимит: *${fmt(s2sDaily)} ${sym}*\n` +
    `📅 Дней в периоде: ${daysTotal}`;

  await sendTelegramMessage(chatId, text);
}

export async function sendDeficitAlert(
  chatId: string,
  deficit: number,
  currency: string,
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => (n / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

  const text =
    `🔴 *Дефицит бюджета*\n\n` +
    `Ваши обязательства превышают доходы на *${fmt(deficit)} ${sym}*.\n\n` +
    `Откройте PFM, чтобы пересмотреть расходы.`;

  await sendTelegramMessage(chatId, text);
}
