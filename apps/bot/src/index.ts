import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { detectLocale, formatNumber, t, type Locale } from '@pfm/shared';
import { parseExpenseFromText, type ParseResult } from './expenseParser';

// ── Types ─────────────────────────────────────────────

interface DashboardResponse {
  onboardingDone: boolean;
  s2sToday: number; s2sDaily: number; s2sStatus: string;
  daysLeft: number; currency: string;
}

interface ApiExpense {
  id: string;
  amount: number;
  note: string | null;
  currency: string;
}

type CreateExpenseResult =
  | { ok: true; expense: ApiExpense }
  | { ok: false; kind: 'onboarding' | 'error' };

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

// ── Analytics ─────────────────────────────────────────
// Structured log lines, no raw user text. Grep logs for `[PFM Bot] analytics`.

function logEvent(event: string, data: Record<string, unknown>): void {
  try {
    console.log(`[PFM Bot] analytics ${event} ${JSON.stringify(data)}`);
  } catch {
    // never throw from analytics
  }
}

// ── Markdown helpers ──────────────────────────────────
// Legacy Telegram Markdown only treats *, _, [ and ` as special. Strip them
// from user-supplied notes so malformed text can't break message rendering.

function escapeMarkdown(s: string): string {
  return s.replace(/[*_`[\]]/g, '');
}

// ── API helpers ───────────────────────────────────────
//
// The bot talks to /tg/* endpoints server-to-server. In production the API's
// tgAuth middleware requires either valid Telegram initData (which only the
// Mini App has) or the bot's internal auth pair: `X-Internal-Key` = ADMIN_KEY
// plus `X-Bot-Telegram-Id` = the acting user's Telegram id. We always send
// that pair from the bot, so the same code path works in dev and prod.

function tgHeaders(telegramId: number): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Internal-Key': ADMIN_KEY,
    'X-Bot-Telegram-Id': String(telegramId),
  };
}

async function apiCreateExpense(
  telegramId: number,
  amountMinor: number,
  note: string | undefined,
): Promise<CreateExpenseResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/tg/expenses`, {
      method: 'POST',
      headers: tgHeaders(telegramId),
      body: JSON.stringify({ amount: amountMinor, note }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      console.error('[PFM Bot] apiCreateExpense non-2xx:', res.status, err);
      if (err.error === 'No active period. Complete onboarding first.') {
        return { ok: false, kind: 'onboarding' };
      }
      return { ok: false, kind: 'error' };
    }
    const expense = (await res.json()) as ApiExpense;
    return { ok: true, expense };
  } catch (err) {
    console.error('[PFM Bot] apiCreateExpense failed:', err);
    return { ok: false, kind: 'error' };
  }
}

async function apiDeleteExpense(telegramId: number, expenseId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/tg/expenses/${expenseId}`, {
      method: 'DELETE',
      headers: tgHeaders(telegramId),
    });
    if (!res.ok) {
      console.error('[PFM Bot] apiDeleteExpense non-2xx:', res.status);
    }
    return res.ok;
  } catch (err) {
    console.error('[PFM Bot] apiDeleteExpense failed:', err);
    return false;
  }
}

async function apiGetDashboard(telegramId: number): Promise<DashboardResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/tg/dashboard`, {
      headers: tgHeaders(telegramId),
    });
    if (!res.ok) {
      console.error('[PFM Bot] apiGetDashboard non-2xx:', res.status);
      return null;
    }
    return (await res.json()) as DashboardResponse;
  } catch (err) {
    console.error('[PFM Bot] apiGetDashboard failed:', err);
    return null;
  }
}

// ── Reply builders ────────────────────────────────────

/**
 * Shape the "expense recorded" confirmation: text body + inline Delete button.
 * Used for both auto-success (text handler) and confirmed-ambiguous (cy action).
 */
function buildExpenseReply(
  locale: Locale,
  opts: {
    amountMajor: number;
    currency: string;
    note: string;
    s2sTodayMinor: number;
    expenseId: string;
  },
): { text: string; reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } {
  const sym = opts.currency === 'USD' ? '$' : '₽';
  const s2s = formatNumber(Math.round(opts.s2sTodayMinor / 100), locale);
  const amount = formatNumber(opts.amountMajor, locale);
  const noteText = opts.note
    ? t(locale, 'bot.exp.successWithNote', { note: escapeMarkdown(opts.note) })
    : t(locale, 'bot.exp.successNoNote');

  return {
    text: t(locale, 'bot.exp.success', { amount, sym, noteText, s2s }),
    reply_markup: {
      inline_keyboard: [[
        {
          text: t(locale, 'bot.exp.deleteButton'),
          callback_data: `exp:del:${opts.expenseId}`,
        },
      ]],
    },
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
    const data = await apiGetDashboard(ctx.from.id);
    if (!data) throw new Error('API error');

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
//
// Behavior preserved exactly: same reply template (`bot.spendSuccess`) and
// same keyboard (Open App). Internal API calls now reuse the shared helpers
// but nothing visible to the user has changed.

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

  const amountMinor = Math.round(amount * 100);
  const created = await apiCreateExpense(ctx.from.id, amountMinor, note);
  if (!created.ok) {
    if (created.kind === 'onboarding') {
      await ctx.reply(t(locale, 'bot.onboardingFirst'), {
        reply_markup: openAppKeyboard(locale, MINI_APP_URL),
      });
      return;
    }
    await ctx.reply(t(locale, 'bot.genericError'));
    return;
  }

  const dash = await apiGetDashboard(ctx.from.id);
  if (!dash) {
    await ctx.reply(t(locale, 'bot.genericError'));
    return;
  }

  const s2s = formatNumber(Math.round(dash.s2sToday / 100), locale);
  const sym = dash.currency === 'USD' ? '$' : '₽';
  const noteText = note ? ` (${note})` : '';
  await ctx.reply(
    t(locale, 'bot.spendSuccess', { amount, sym, noteText, s2s }),
    {
      parse_mode: 'Markdown',
      reply_markup: openAppKeyboard(locale, MINI_APP_URL),
    },
  );
});

// ── /help ──────────────────────────────────────────────

bot.help(async (ctx) => {
  const locale = getLocale(ctx);
  await ctx.reply(t(locale, 'bot.help'), {
    reply_markup: openAppKeyboard(locale, MINI_APP_URL),
  });
});

// ── Free-text expense logging ──────────────────────────
//
// Flow:
//   - deterministic `parseExpenseFromText` classifies the text
//   - success   → create expense via API, reply with s2s + inline Delete button
//   - ambiguous → ask the user to confirm via inline Yes/No buttons; the
//                 amountMinor is carried in callback_data, there's nothing else
//                 to persist because ambiguous results always have empty note
//   - reject    → either stay silent (pure chatter, non-expense keywords) or
//                 show a short "didn't get it" hint for things that clearly
//                 look like a failed attempt (multiple amounts, out-of-range)
//
// We only act on private chats. In groups we silently ignore every text
// message so we don't spam people.

/** Reject reasons that warrant a visible hint; the rest are treated as chatter. */
const HINT_REJECT_REASONS = new Set<ParseResult['reason']>([
  'multiple_amounts',
  'range_like',
  'amount_out_of_range',
]);

function redactForAnalytics(parse: ParseResult): Record<string, unknown> {
  return {
    kind: parse.kind,
    pattern: parse.pattern,
    reason: parse.reason ?? null,
    // amountMinor is a bucketed coarse value — safe and useful for analytics
    amountBucket: parse.amountMinor !== undefined ? bucketAmount(parse.amountMinor) : null,
    hasNote: !!parse.note && parse.note.length > 0,
  };
}

/** Coarse log-scale bucket so we don't leak exact amounts through logs. */
function bucketAmount(amountMinor: number): string {
  const major = amountMinor / 100;
  if (major < 100) return '<100';
  if (major < 500) return '100-500';
  if (major < 1000) return '500-1k';
  if (major < 5000) return '1k-5k';
  if (major < 10000) return '5k-10k';
  if (major < 50000) return '10k-50k';
  if (major < 100000) return '50k-100k';
  return '>100k';
}

bot.on(message('text'), async (ctx) => {
  // Only private chats get the free-text expense flow.
  if (ctx.chat.type !== 'private') return;

  const text = ctx.message.text;
  // Slash commands are handled by bot.command('...') registrations above.
  // Telegraf still calls this text handler afterwards, so bail out cleanly.
  if (text.startsWith('/')) return;

  const locale = getLocale(ctx);
  const parsed = parseExpenseFromText(text);

  // ── Reject ────────────────────────────────────────
  if (parsed.kind === 'reject') {
    logEvent('expense_text_parse_reject', {
      telegramId: ctx.from.id,
      ...redactForAnalytics(parsed),
    });
    if (parsed.reason && HINT_REJECT_REASONS.has(parsed.reason)) {
      await ctx.reply(t(locale, 'bot.exp.notRecognized'), { parse_mode: 'Markdown' });
    }
    return;
  }

  // ── Ambiguous → confirm flow ──────────────────────
  if (parsed.kind === 'ambiguous') {
    logEvent('expense_text_parse_ambiguous', {
      telegramId: ctx.from.id,
      ...redactForAnalytics(parsed),
    });
    const amountMinor = parsed.amountMinor!;
    const dash = await apiGetDashboard(ctx.from.id);
    const currency = dash?.currency ?? 'RUB';
    const sym = currency === 'USD' ? '$' : '₽';
    const amount = formatNumber(Math.round(amountMinor / 100), locale);
    await ctx.reply(
      t(locale, 'bot.exp.confirmPrompt', { amount, sym }),
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: t(locale, 'bot.exp.confirmYes'), callback_data: `exp:cy:${amountMinor}` },
            { text: t(locale, 'bot.exp.confirmNo'), callback_data: 'exp:cn' },
          ]],
        },
      },
    );
    return;
  }

  // ── Success → create expense immediately ──────────
  logEvent('expense_text_parse_success', {
    telegramId: ctx.from.id,
    ...redactForAnalytics(parsed),
  });

  const amountMinor = parsed.amountMinor!;
  const note = parsed.note && parsed.note.length > 0 ? parsed.note : undefined;
  const created = await apiCreateExpense(ctx.from.id, amountMinor, note);
  if (!created.ok) {
    if (created.kind === 'onboarding') {
      await ctx.reply(t(locale, 'bot.exp.onboardingFirst'), {
        reply_markup: openAppKeyboard(locale, MINI_APP_URL),
      });
      return;
    }
    await ctx.reply(t(locale, 'bot.exp.createFailed'));
    return;
  }

  const dash = await apiGetDashboard(ctx.from.id);
  if (!dash) {
    // Expense was created but we couldn't fetch the updated dashboard.
    // Still acknowledge success — the user sees it in the Mini App.
    await ctx.reply(t(locale, 'bot.exp.createFailed'));
    return;
  }

  const reply = buildExpenseReply(locale, {
    amountMajor: amountMinor / 100,
    currency: dash.currency,
    note: note ?? '',
    s2sTodayMinor: dash.s2sToday,
    expenseId: created.expense.id,
  });
  await ctx.reply(reply.text, {
    parse_mode: 'Markdown',
    reply_markup: reply.reply_markup,
  });
  logEvent('expense_text_logged', {
    telegramId: ctx.from.id,
    expenseId: created.expense.id,
    amountMinor,
    source: 'text_auto',
  });
});

// ── Callback actions: exp:* ────────────────────────────
//
// Callback_data layout (≤ 64 bytes — Telegram limit):
//   exp:del:<expenseId>    delete a just-created expense
//   exp:cy:<amountMinor>   user confirmed an ambiguous parse → record it
//   exp:cn                 user cancelled an ambiguous parse

bot.action(/^exp:del:(.+)$/, async (ctx) => {
  const locale = getLocale(ctx);
  const expenseId = (ctx.match as RegExpExecArray)[1];
  const ok = await apiDeleteExpense(ctx.from!.id, expenseId);
  if (!ok) {
    try { await ctx.answerCbQuery(t(locale, 'bot.exp.deleteFailed')); } catch {}
    return;
  }
  try { await ctx.answerCbQuery('✓'); } catch {}

  const dash = await apiGetDashboard(ctx.from!.id);
  const s2s = dash
    ? formatNumber(Math.round(dash.s2sToday / 100), locale)
    : '—';
  try {
    await ctx.editMessageText(
      t(locale, 'bot.exp.deleted', { s2s, sym: dash?.currency === 'USD' ? '$' : '₽' }),
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    console.error('[PFM Bot] exp:del editMessageText failed:', err);
  }
  logEvent('expense_text_deleted', {
    telegramId: ctx.from!.id,
    expenseId,
  });
});

bot.action(/^exp:cy:(\d+)$/, async (ctx) => {
  const locale = getLocale(ctx);
  const amountMinor = parseInt((ctx.match as RegExpExecArray)[1], 10);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    try { await ctx.answerCbQuery(); } catch {}
    return;
  }

  const created = await apiCreateExpense(ctx.from!.id, amountMinor, undefined);
  if (!created.ok) {
    try { await ctx.answerCbQuery(); } catch {}
    if (created.kind === 'onboarding') {
      try {
        await ctx.editMessageText(t(locale, 'bot.exp.onboardingFirst'));
      } catch {}
      return;
    }
    try { await ctx.editMessageText(t(locale, 'bot.exp.createFailed')); } catch {}
    return;
  }

  try { await ctx.answerCbQuery('✓'); } catch {}

  const dash = await apiGetDashboard(ctx.from!.id);
  if (!dash) {
    try { await ctx.editMessageText(t(locale, 'bot.exp.createFailed')); } catch {}
    return;
  }

  const reply = buildExpenseReply(locale, {
    amountMajor: amountMinor / 100,
    currency: dash.currency,
    note: '',
    s2sTodayMinor: dash.s2sToday,
    expenseId: created.expense.id,
  });
  try {
    await ctx.editMessageText(reply.text, {
      parse_mode: 'Markdown',
      reply_markup: reply.reply_markup,
    });
  } catch (err) {
    console.error('[PFM Bot] exp:cy editMessageText failed:', err);
  }

  logEvent('expense_text_logged', {
    telegramId: ctx.from!.id,
    expenseId: created.expense.id,
    amountMinor,
    source: 'text_confirmed',
  });
});

bot.action('exp:cn', async (ctx) => {
  const locale = getLocale(ctx);
  try { await ctx.answerCbQuery(); } catch {}
  try {
    await ctx.editMessageText(t(locale, 'bot.exp.cancelled'));
  } catch (err) {
    console.error('[PFM Bot] exp:cn editMessageText failed:', err);
  }
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
