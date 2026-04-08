// ── Telegram notification sender ────────────────────────
// Calls Telegram Bot API directly (no Telegraf dependency)

import { t, formatNumber, type Locale } from '@pfm/shared';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://localhost:3003/miniapp';

// ── Low-level send ──────────────────────────────────────

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  locale: Locale = 'en',
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
          inline_keyboard: [[{ text: t(locale, 'bot.openApp'), web_app: { url: MINI_APP_URL } }]],
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
  locale: Locale = 'en',
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => formatNumber(Math.round(n / 100), locale);

  let emoji = '🟢';
  if (s2sStatus === 'OVERSPENT' || s2sStatus === 'DEFICIT') emoji = '🔴';
  else if (s2sStatus === 'WARNING') emoji = '🟡';

  const text =
    `${t(locale, 'notify.morningGreeting')}\n\n` +
    `${emoji} ${t(locale, 'notify.morningS2s')}\n` +
    t(locale, 'notify.morningBody', {
      s2s: fmt(s2sToday),
      sym,
      daily: fmt(s2sDaily),
      daysLeft,
    });

  await sendTelegramMessage(chatId, text, locale);
}

export async function sendEveningNotification(
  chatId: string,
  todaySpent: number,
  s2sDaily: number,
  currency: string,
  locale: Locale = 'en',
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => formatNumber(Math.round(n / 100), locale);
  const remaining = s2sDaily - todaySpent;
  const isOverspent = remaining < 0;

  const statusLine = isOverspent
    ? t(locale, 'notify.eveningOver', { over: fmt(Math.abs(remaining)), sym })
    : t(locale, 'notify.eveningOk', { remaining: fmt(remaining), sym });

  const text =
    `${t(locale, 'notify.eveningHeader')}\n\n` +
    `${t(locale, 'notify.eveningSpent', { spent: fmt(todaySpent), sym })}\n` +
    `${t(locale, 'notify.eveningLimit', { limit: fmt(s2sDaily), sym })}\n\n` +
    statusLine;

  await sendTelegramMessage(chatId, text, locale);
}

export async function sendPaymentAlert(
  chatId: string,
  debtTitle: string,
  minPayment: number,
  currency: string,
  daysUntil: number,
  locale: Locale = 'en',
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => formatNumber(Math.round(n / 100), locale);

  const headerLine =
    daysUntil === 0
      ? t(locale, 'notify.paymentLineToday', { title: debtTitle })
      : t(locale, 'notify.paymentLineTomorrow', { title: debtTitle });

  const text =
    `${t(locale, 'notify.paymentHeader')}\n\n` +
    `${headerLine}\n` +
    `${t(locale, 'notify.paymentAmount', { amount: fmt(minPayment), sym })}\n\n` +
    t(locale, 'notify.paymentFooter');

  await sendTelegramMessage(chatId, text, locale);
}

export async function sendNewPeriodNotification(
  chatId: string,
  s2sDaily: number,
  daysTotal: number,
  currency: string,
  prevSaved: number | undefined,
  locale: Locale = 'en',
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => formatNumber(Math.round(n / 100), locale);

  const savedLine =
    prevSaved !== undefined && prevSaved > 0
      ? t(locale, 'notify.newPeriodSaved', { amount: fmt(prevSaved), sym })
      : prevSaved !== undefined && prevSaved < 0
        ? t(locale, 'notify.newPeriodOver', { amount: fmt(Math.abs(prevSaved)), sym })
        : '';

  const text =
    `${t(locale, 'notify.newPeriodHeader')}${savedLine}\n\n` +
    `${t(locale, 'notify.newPeriodLimit', { limit: fmt(s2sDaily), sym })}\n` +
    t(locale, 'notify.newPeriodDays', { days: daysTotal });

  await sendTelegramMessage(chatId, text, locale);
}

export async function sendDeficitAlert(
  chatId: string,
  deficit: number,
  currency: string,
  locale: Locale = 'en',
): Promise<void> {
  const sym = currency === 'USD' ? '$' : '₽';
  const fmt = (n: number) => formatNumber(Math.round(n / 100), locale);

  const text =
    `${t(locale, 'notify.deficitHeader')}\n\n` +
    t(locale, 'notify.deficitBody', { amount: fmt(deficit), sym });

  await sendTelegramMessage(chatId, text, locale);
}
