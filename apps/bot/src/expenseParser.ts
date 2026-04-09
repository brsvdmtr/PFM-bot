/**
 * Free-text expense parser for the PFM Telegram bot.
 *
 * Deterministic, LLM-free. Turns a message like "кафе 2500" into
 * { kind: 'success', amountMinor: 250000, note: 'кафе' }.
 *
 * v1 scope: single expense per message, no categories, no dates.
 *
 * Contract:
 *  - 'success'   — confident enough to create the expense immediately
 *  - 'ambiguous' — looks like an expense but not confident, bot should
 *                  ask the user to confirm before creating
 *  - 'reject'    — not an expense, bot should either ignore or show
 *                  a "not recognized" hint
 *
 * Amounts are returned in **minor units** (kopecks / cents) so the
 * caller can pass them straight to the API expense create endpoint
 * without re-doing unit conversion.
 */

export type ParseKind = 'success' | 'ambiguous' | 'reject';

export type RejectReason =
  | 'empty'
  | 'slash_command'
  | 'non_expense_keyword'
  | 'percent'
  | 'date_like'
  | 'range_like'
  | 'multiple_amounts'
  | 'no_amount'
  | 'amount_out_of_range';

export type Pattern =
  | 'label_before'
  | 'label_after'
  | 'bare_number'
  | 'signed_number'
  | 'number_with_filler'
  | 'unknown';

export interface ParseResult {
  kind: ParseKind;
  /** Amount in minor units (e.g. kopecks). Only present when kind !== 'reject'. */
  amountMinor?: number;
  /** Human-readable note extracted from the message. '' if none. */
  note?: string;
  /** Which pattern matched, for analytics. */
  pattern: Pattern;
  /** Only present when kind === 'reject'. */
  reason?: RejectReason;
}

// ── Constants ───────────────────────────────────────────────

/**
 * Words that are NEVER part of an expense note and, when they're the
 * ONLY non-number content in the message, push the result to 'ambiguous'.
 * Lowercase. Matched as whole words.
 */
const FILLER_WORDS = new Set<string>([
  // RU
  'сегодня', 'вчера', 'ну', 'вот', 'это', 'уже', 'где', 'то', 'где-то',
  'около', 'примерно', 'приблизительно', 'прим', 'около-то', 'как-то',
  'минус', 'плюс',
  'потратил', 'потратила', 'потрачено', 'трачу', 'потратили',
  'за', 'на', 'в', 'и',
  // EN
  'today', 'yesterday', 'just', 'well', 'like', 'around', 'about',
  'approximately', 'approx', 'minus', 'plus', 'spent', 'paid',
]);

/**
 * Keywords that indicate this is explicitly NOT an expense.
 * If any of these appear anywhere in the message, we reject.
 */
const NON_EXPENSE_KEYWORDS = [
  'зарплат', 'зп', 'salary', 'wage',
  'кредит', 'credit', 'loan',
  'доход', 'income', 'revenue', 'earning',
  'аванс',
];

/** Currency suffix pattern — stripped from the message before number extraction. */
const CURRENCY_SUFFIX_RE = /(\d)\s*(?:₽|руб(?:лей|ля)?|р\b\.?|\$|usd|dollars?)\.?/giu;

/**
 * Number token: handles thousand separators like "2 500" and optional
 * leading minus and optional fractional part.
 *
 * Matches:
 *   - 2500, -2500, 2500.50, 2500,50
 *   - 2 500, 1 234 567
 *   - -1 200
 *
 * Does NOT match "2 50" (the second group has <3 digits so fallthrough
 * to plain \d+ treats them as two separate numbers).
 */
const NUMBER_RE = /-?(?:\d{1,3}(?:[\s\u00A0\u202F]\d{3})+|\d+)(?:[.,]\d+)?/g;

/** Percent anywhere in the string → reject. */
const PERCENT_RE = /\d\s*%/;

/**
 * Date-like token: DD.MM, DD/MM, optionally with year. Reject to avoid
 * accidentally treating "15.04" as an amount.
 *
 * Bounds: DD is 1-31, MM is 1-12. This is strict enough to avoid false
 * positives like "100.50" (DD>31).
 */
const DATE_RE = /\b(?:[12]?\d|3[01])[./](?:0?[1-9]|1[0-2])(?:[./]\d{2,4})?\b/;

/** Range like "1000-1500" with an actual dash between two numbers. */
const RANGE_RE = /\b\d+\s*[–—-]\s*\d+\b/;

/** Max accepted amount in major units (e.g. 10 000 000 rubles). Prevents parsing garbage. */
const MAX_AMOUNT_MAJOR = 10_000_000;

// ── Public API ──────────────────────────────────────────────

export function parseExpenseFromText(rawInput: string): ParseResult {
  const input = (rawInput ?? '').trim();

  if (!input) {
    return { kind: 'reject', pattern: 'unknown', reason: 'empty' };
  }

  // Slash commands must be handled upstream by bot.command(); bail out.
  if (input.startsWith('/')) {
    return { kind: 'reject', pattern: 'unknown', reason: 'slash_command' };
  }

  const lower = input.toLowerCase();

  // Hard rejects — explicitly non-expense content.
  for (const kw of NON_EXPENSE_KEYWORDS) {
    if (lower.includes(kw)) {
      return { kind: 'reject', pattern: 'unknown', reason: 'non_expense_keyword' };
    }
  }

  if (PERCENT_RE.test(input)) {
    return { kind: 'reject', pattern: 'unknown', reason: 'percent' };
  }

  if (DATE_RE.test(input)) {
    return { kind: 'reject', pattern: 'unknown', reason: 'date_like' };
  }

  if (RANGE_RE.test(input)) {
    return { kind: 'reject', pattern: 'unknown', reason: 'range_like' };
  }

  // Strip currency markers that are glued to digits so number extraction is clean.
  const withoutCurrency = input.replace(CURRENCY_SUFFIX_RE, '$1');

  // Extract all number tokens.
  const matches: Array<{ text: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  NUMBER_RE.lastIndex = 0;
  while ((m = NUMBER_RE.exec(withoutCurrency)) !== null) {
    matches.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }

  if (matches.length === 0) {
    return { kind: 'reject', pattern: 'unknown', reason: 'no_amount' };
  }
  if (matches.length > 1) {
    return { kind: 'reject', pattern: 'unknown', reason: 'multiple_amounts' };
  }

  const only = matches[0];
  const amount = parseAmount(only.text);
  if (amount === null || amount <= 0 || amount > MAX_AMOUNT_MAJOR) {
    return { kind: 'reject', pattern: 'unknown', reason: 'amount_out_of_range' };
  }
  const amountMinor = Math.round(amount * 100);

  // Build the note from whatever text remains once the number (and its
  // immediately-preceding minus sign, if any) is removed.
  const before = withoutCurrency.slice(0, only.start);
  const after = withoutCurrency.slice(only.end);
  const rawNote = `${before} ${after}`.replace(/\s+/g, ' ').trim();

  // Also strip currency words that were left dangling in the middle of the
  // sentence (e.g. "обед 1 200 руб" → after number extraction leaves "обед  руб",
  // we want just "обед").
  const cleanedNote = rawNote
    .replace(/\b(?:₽|руб(?:лей|ля)?|р\.?|rub|usd|dollars?)\b\.?/giu, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Pattern classification (for analytics).
  let pattern: Pattern;
  if (cleanedNote.length === 0) {
    pattern = only.text.startsWith('-') ? 'signed_number' : 'bare_number';
  } else if (only.start === 0) {
    // Number came first in the original (after currency strip).
    pattern = 'label_after';
  } else {
    pattern = 'label_before';
  }

  // Ambiguity check: if what's left is empty or purely filler words,
  // don't auto-create.
  if (isAmbiguousNote(cleanedNote)) {
    return {
      kind: 'ambiguous',
      amountMinor,
      note: '',
      pattern: cleanedNote.length > 0 ? 'number_with_filler' : pattern,
    };
  }

  return {
    kind: 'success',
    amountMinor,
    note: cleanedNote,
    pattern,
  };
}

// ── Internals ───────────────────────────────────────────────

/**
 * Parse a number token (already currency-stripped) into a major-unit number.
 * Returns null if the token cannot be parsed.
 *
 * Handles:
 *   - thousand separators: regular space, nbsp (U+00A0), narrow nbsp (U+202F)
 *   - decimal separators: '.' or ','
 *   - leading minus sign (treated as positive — it's just the user's
 *     way of marking "this is an expense")
 */
function parseAmount(token: string): number | null {
  // Drop sign; for expenses, "minus" is just a user marker.
  let t = token.replace(/^-/, '');
  // Remove thousand separators.
  t = t.replace(/[\s\u00A0\u202F]/g, '');
  // Normalize decimal separator.
  t = t.replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isAmbiguousNote(note: string): boolean {
  if (note.length === 0) return true;
  // Tokenize by whitespace and punctuation, strip empties.
  const tokens = note
    .toLowerCase()
    .split(/[\s,.;:!?()[\]"“”«»]+/u)
    .filter((w) => w.length > 0);
  if (tokens.length === 0) return true;
  // Every token must be a filler word for the whole note to count as ambiguous.
  return tokens.every((w) => FILLER_WORDS.has(w));
}
