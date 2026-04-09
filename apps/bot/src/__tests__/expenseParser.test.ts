import { parseExpenseFromText } from '../expenseParser';

describe('parseExpenseFromText', () => {
  // ── Success: label + number ──────────────────────────────────
  describe('success — label before number', () => {
    it('parses "кафе 2500"', () => {
      const r = parseExpenseFromText('кафе 2500');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(250000);
      expect(r.note).toBe('кафе');
      expect(r.pattern).toBe('label_before');
    });

    it('parses "кофе 350"', () => {
      const r = parseExpenseFromText('кофе 350');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(35000);
      expect(r.note).toBe('кофе');
    });

    it('parses "кафе -2500" (leading minus is a user marker, treated as positive)', () => {
      const r = parseExpenseFromText('кафе -2500');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(250000);
      expect(r.note).toBe('кафе');
    });

    it('parses "обед 1 200 руб" (thousand separator + trailing currency)', () => {
      const r = parseExpenseFromText('обед 1 200 руб');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(120000);
      expect(r.note).toBe('обед');
    });

    it('parses "обед 1 200 рублей"', () => {
      const r = parseExpenseFromText('обед 1 200 рублей');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(120000);
      expect(r.note).toBe('обед');
    });

    it('parses "кафе 2500₽" (currency glued to number)', () => {
      const r = parseExpenseFromText('кафе 2500₽');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(250000);
      expect(r.note).toBe('кафе');
    });

    it('parses "lunch 25$" (USD currency glued)', () => {
      const r = parseExpenseFromText('lunch 25$');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(2500);
      expect(r.note).toBe('lunch');
    });

    it('parses decimal amounts like "кафе 2500.50"', () => {
      const r = parseExpenseFromText('кафе 2500.50');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(250050);
      expect(r.note).toBe('кафе');
    });

    it('parses "кафе 2500,50" (comma decimal)', () => {
      const r = parseExpenseFromText('кафе 2500,50');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(250050);
      expect(r.note).toBe('кафе');
    });

    it('parses multi-word notes "обед в столовой 450"', () => {
      const r = parseExpenseFromText('обед в столовой 450');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(45000);
      expect(r.note).toBe('обед в столовой');
    });
  });

  describe('success — number before label', () => {
    it('parses "2500 кафе"', () => {
      const r = parseExpenseFromText('2500 кафе');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(250000);
      expect(r.note).toBe('кафе');
      expect(r.pattern).toBe('label_after');
    });

    it('parses "-700 кофе" (leading minus marker)', () => {
      const r = parseExpenseFromText('-700 кофе');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(70000);
      expect(r.note).toBe('кофе');
    });

    it('parses "350 утренний кофе"', () => {
      const r = parseExpenseFromText('350 утренний кофе');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(35000);
      expect(r.note).toBe('утренний кофе');
    });
  });

  // ── Ambiguous ───────────────────────────────────────────────
  describe('ambiguous', () => {
    it('treats bare number "2500" as ambiguous (no note)', () => {
      const r = parseExpenseFromText('2500');
      expect(r.kind).toBe('ambiguous');
      expect(r.amountMinor).toBe(250000);
      expect(r.note).toBe('');
      expect(r.pattern).toBe('bare_number');
    });

    it('treats signed "-2500" as ambiguous', () => {
      const r = parseExpenseFromText('-2500');
      expect(r.kind).toBe('ambiguous');
      expect(r.amountMinor).toBe(250000);
      expect(r.pattern).toBe('signed_number');
    });

    it('treats "минус 2500" as ambiguous (only filler word)', () => {
      const r = parseExpenseFromText('минус 2500');
      expect(r.kind).toBe('ambiguous');
      expect(r.amountMinor).toBe(250000);
      expect(r.pattern).toBe('number_with_filler');
    });

    it('treats "сегодня 2500" as ambiguous (only filler word)', () => {
      const r = parseExpenseFromText('сегодня 2500');
      expect(r.kind).toBe('ambiguous');
      expect(r.amountMinor).toBe(250000);
      expect(r.pattern).toBe('number_with_filler');
    });

    it('treats "сегодня потратил 2500" as ambiguous (two filler words)', () => {
      const r = parseExpenseFromText('сегодня потратил 2500');
      expect(r.kind).toBe('ambiguous');
      expect(r.amountMinor).toBe(250000);
    });

    it('treats English "spent 2500" as ambiguous', () => {
      const r = parseExpenseFromText('spent 2500');
      expect(r.kind).toBe('ambiguous');
      expect(r.amountMinor).toBe(250000);
    });

    it('treats "около 1000" as ambiguous', () => {
      const r = parseExpenseFromText('около 1000');
      expect(r.kind).toBe('ambiguous');
      expect(r.amountMinor).toBe(100000);
    });
  });

  // ── Reject ──────────────────────────────────────────────────
  describe('reject — empty or slash', () => {
    it('rejects empty string', () => {
      const r = parseExpenseFromText('');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('empty');
    });

    it('rejects whitespace-only', () => {
      const r = parseExpenseFromText('   \n  ');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('empty');
    });

    it('rejects slash commands "/today"', () => {
      const r = parseExpenseFromText('/today');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('slash_command');
    });

    it('rejects slash commands "/spend 500 кофе"', () => {
      const r = parseExpenseFromText('/spend 500 кофе');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('slash_command');
    });
  });

  describe('reject — non-expense keywords', () => {
    it('rejects "зарплата 50000"', () => {
      const r = parseExpenseFromText('зарплата 50000');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('non_expense_keyword');
    });

    it('rejects "зп 50000"', () => {
      const r = parseExpenseFromText('зп 50000');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('non_expense_keyword');
    });

    it('rejects "кредит 100000"', () => {
      const r = parseExpenseFromText('кредит 100000');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('non_expense_keyword');
    });

    it('rejects "доход 25000"', () => {
      const r = parseExpenseFromText('доход 25000');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('non_expense_keyword');
    });

    it('rejects "аванс 10000"', () => {
      const r = parseExpenseFromText('аванс 10000');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('non_expense_keyword');
    });

    it('rejects English "salary 2500"', () => {
      const r = parseExpenseFromText('salary 2500');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('non_expense_keyword');
    });

    it('rejects "income 1000"', () => {
      const r = parseExpenseFromText('income 1000');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('non_expense_keyword');
    });
  });

  describe('reject — percent / date / range', () => {
    it('rejects percent "18.9%"', () => {
      const r = parseExpenseFromText('18.9%');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('percent');
    });

    it('rejects percent with space "18 %"', () => {
      const r = parseExpenseFromText('18 %');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('percent');
    });

    it('rejects date "15.04"', () => {
      const r = parseExpenseFromText('15.04');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('date_like');
    });

    it('rejects date with year "15.04.2026"', () => {
      const r = parseExpenseFromText('15.04.2026');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('date_like');
    });

    it('rejects date "15/04"', () => {
      const r = parseExpenseFromText('15/04');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('date_like');
    });

    it('does NOT reject "100.50" as date (DD > 31)', () => {
      const r = parseExpenseFromText('кафе 100.50');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(10050);
    });

    it('rejects range "1000-1500"', () => {
      const r = parseExpenseFromText('1000-1500');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('range_like');
    });

    it('rejects range with label "кафе 1000-1500"', () => {
      const r = parseExpenseFromText('кафе 1000-1500');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('range_like');
    });
  });

  describe('reject — no amount / multiple amounts', () => {
    it('rejects "кафе" (no number)', () => {
      const r = parseExpenseFromText('кафе');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('no_amount');
    });

    it('rejects "привет как дела" (no number)', () => {
      const r = parseExpenseFromText('привет как дела');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('no_amount');
    });

    it('rejects "кафе 500 и такси 700" (multiple amounts)', () => {
      const r = parseExpenseFromText('кафе 500 и такси 700');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('multiple_amounts');
    });

    it('rejects "500 + 700" (two separate numbers)', () => {
      const r = parseExpenseFromText('500 + 700');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('multiple_amounts');
    });

    it('parses "500 700" as single number with thousand separator', () => {
      // The parser treats space between 3-digit groups as a thousand separator,
      // so "500 700" becomes 500700, not two separate numbers.
      const r = parseExpenseFromText('500 700');
      expect(r.kind).toBe('ambiguous');
      expect(r.amountMinor).toBe(50070000);
    });
  });

  describe('reject — amount out of range', () => {
    it('rejects "кафе 0"', () => {
      const r = parseExpenseFromText('кафе 0');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('amount_out_of_range');
    });

    it('rejects amounts over 10 million', () => {
      const r = parseExpenseFromText('кафе 20000000');
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('amount_out_of_range');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles trailing/leading whitespace', () => {
      const r = parseExpenseFromText('  кафе 2500  ');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(250000);
      expect(r.note).toBe('кафе');
    });

    it('handles nbsp thousand separator "кафе 1\u00A0200"', () => {
      const r = parseExpenseFromText('кафе 1\u00A0200');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(120000);
    });

    it('handles narrow nbsp thousand separator "кафе 1\u202F200"', () => {
      const r = parseExpenseFromText('кафе 1\u202F200');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(120000);
    });

    it('strips dangling "руб" from the middle of the note', () => {
      const r = parseExpenseFromText('обед 1200 руб');
      expect(r.kind).toBe('success');
      expect(r.note).toBe('обед');
    });

    it('handles max allowed amount', () => {
      const r = parseExpenseFromText('дом 10000000');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(1000000000);
      expect(r.note).toBe('дом');
    });

    it('handles English "coffee 350"', () => {
      const r = parseExpenseFromText('coffee 350');
      expect(r.kind).toBe('success');
      expect(r.amountMinor).toBe(35000);
      expect(r.note).toBe('coffee');
    });

    it('returns amountMinor never undefined for success', () => {
      const r = parseExpenseFromText('чай 50');
      expect(r.kind).toBe('success');
      expect(typeof r.amountMinor).toBe('number');
    });

    it('handles null input gracefully', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = parseExpenseFromText(null as any);
      expect(r.kind).toBe('reject');
      expect(r.reason).toBe('empty');
    });
  });
});
