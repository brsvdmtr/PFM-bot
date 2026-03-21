#!/usr/bin/env tsx
/**
 * Income Semantics Audit Script
 *
 * PURPOSE: Determine whether Income.amount is stored as:
 *   Semantics A — monthly total  (contribution per period = amount / paydays.length)
 *   Semantics B — per-payout     (contribution per period = amount, no division)
 *
 * Run ONCE before any income amount migration.
 * Output goes to stdout. Exit code:
 *   0 — UNIFORM_B (no migration needed)
 *   0 — UNIFORM_A (migration needed but safe to proceed)
 *   1 — MIXED or AMBIGUOUS (BLOCKED — requires manual review)
 *
 * Usage:
 *   cd /srv/pfm
 *   docker compose exec api npx tsx src/scripts/audit-income-semantics.ts
 *   — or on local with DB running:
 *   cd apps/api && npx tsx scripts/audit-income-semantics.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Types ──────────────────────────────────────────────────────────────────

type Semantics = 'SEMANTICS_B' | 'SEMANTICS_A' | 'AMBIGUOUS';

interface IncomeRecord {
  id: string;
  userId: string;
  title: string;
  amount: number;
  paydays: number[];
  useRussianWorkCalendar: boolean;
  isActive: boolean;
}

interface UserInfo {
  id: string;
  telegramId: string | null;
  firstName: string | null;
}

interface IncomeAuditEntry {
  income: IncomeRecord;
  user: UserInfo;
  paydayCount: number;
  amountIfMonthly_perPayout: number;   // amount / paydayCount
  amountIfPerPayout: number;            // amount (no division)
  classification: Semantics;
  classificationReason: string;
}

// ── Classification ────────────────────────────────────────────────────────

function classifyIncome(income: IncomeRecord): { classification: Semantics; reason: string } {
  const paydayCount = income.paydays.length;

  // Single payday: semantically equivalent under A and B — cannot distinguish
  if (paydayCount === 1) {
    return {
      classification: 'AMBIGUOUS',
      reason: `Single payday [${income.paydays[0]}]: amount=${income.amount} means same under both semantics (per-payout=monthly for 1 payday)`,
    };
  }

  // Multi-payday records: we can reason about plausibility
  // Heuristic: if amount / paydayCount would be < 1000, the "monthly" interpretation
  // produces an unrealistically small per-payout (< 1000 units).
  // This is a soft signal — human must confirm.
  const perPayoutIfMonthly = Math.round(income.amount / paydayCount);

  // Both interpretations are structurally valid for multi-payday records.
  // We classify AMBIGUOUS and emit both values for human review.
  return {
    classification: 'AMBIGUOUS',
    reason: `Multi-payday [${income.paydays.join(',')}]: ` +
      `if Semantics A (monthly) → ${perPayoutIfMonthly}/payout; ` +
      `if Semantics B (per-payout) → ${income.amount}/payout. ` +
      `Human must confirm which matches actual salary received.`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  INCOME SEMANTICS AUDIT');
  console.log(`  Run at: ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');

  // Fetch all active income records with their users
  const incomes = await prisma.income.findMany({
    where: { isActive: true },
    orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
  }) as unknown as IncomeRecord[];

  if (incomes.length === 0) {
    console.log('  No active income records found.');
    await prisma.$disconnect();
    process.exit(0);
  }

  // Fetch users for display
  const userIds = [...new Set(incomes.map(i => i.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, telegramId: true, firstName: true },
  }) as unknown as UserInfo[];
  const userMap = new Map(users.map(u => [u.id, u]));

  // Build audit entries
  const entries: IncomeAuditEntry[] = incomes.map(income => {
    const user = userMap.get(income.userId) ?? { id: income.userId, telegramId: null, firstName: null };
    const { classification, reason } = classifyIncome(income);
    return {
      income,
      user,
      paydayCount: income.paydays.length,
      amountIfMonthly_perPayout: Math.round(income.amount / Math.max(1, income.paydays.length)),
      amountIfPerPayout: income.amount,
      classification,
      classificationReason: reason,
    };
  });

  // Print per-record report
  let currentUserId = '';
  for (const entry of entries) {
    if (entry.income.userId !== currentUserId) {
      currentUserId = entry.income.userId;
      const u = entry.user;
      console.log(`  ┌─ User: ${u.firstName ?? '(no name)'} │ id=${u.id} │ tgId=${u.telegramId ?? 'n/a'}`);
    }

    const { income, classification } = entry;
    const icon = classification === 'SEMANTICS_B' ? '✓' :
                 classification === 'SEMANTICS_A' ? '~' : '?';

    console.log(`  │  [${icon}] Income id=${income.id}`);
    console.log(`  │       title:   "${income.title}"`);
    console.log(`  │       amount:  ${income.amount}`);
    console.log(`  │       paydays: [${income.paydays.join(', ')}]  (count=${entry.paydayCount})`);
    console.log(`  │       useRuCal: ${income.useRussianWorkCalendar}`);
    console.log(`  │       ── Interpretation:`);
    console.log(`  │          Semantics A (monthly):    ${entry.amountIfMonthly_perPayout} per payout × ${entry.paydayCount} = ${income.amount}/month`);
    console.log(`  │          Semantics B (per-payout): ${entry.amountIfPerPayout} per payout × ${entry.paydayCount} = ${income.amount * entry.paydayCount}/month`);
    console.log(`  │       ── Classification: ${classification}`);
    console.log(`  │          ${entry.classificationReason}`);
    console.log(`  │`);
  }
  console.log('  └─────────────────────────────────────────────────────────');
  console.log('');

  // Summary
  const counts = { SEMANTICS_B: 0, SEMANTICS_A: 0, AMBIGUOUS: 0 };
  const multiPayday = entries.filter(e => e.paydayCount > 1);
  const singlePayday = entries.filter(e => e.paydayCount === 1);

  for (const e of entries) counts[e.classification]++;

  console.log('  SUMMARY');
  console.log('  ───────────────────────────────────────────────────────────');
  console.log(`  Total active income records : ${entries.length}`);
  console.log(`  Single-payday (ambiguous)   : ${singlePayday.length}`);
  console.log(`  Multi-payday (needs review) : ${multiPayday.length}`);
  console.log('');

  // Verdict
  // All single-payday records are ambiguous but safe — no migration needed either way.
  // Mixed multi-payday is the real concern.
  const hasMulti = multiPayday.length > 0;

  if (!hasMulti) {
    console.log('  VERDICT: UNIFORM_AMBIGUOUS');
    console.log('  All records have single paydays — semantics A and B produce identical');
    console.log('  results. No migration needed. Proceed with Semantics B (per-payout)');
    console.log('  as the canonical definition going forward.');
    console.log('');
    console.log('  ACTION: None. Engine change only (remove /payCount division).');
    console.log('          Confirm Income.amount value matches per-payout expectation.');
    await prisma.$disconnect();
    process.exit(0);
  }

  // Has multi-payday records — need human confirmation of each
  console.log('  VERDICT: NEEDS_HUMAN_CONFIRMATION');
  console.log('');
  console.log('  Multi-payday income records found. Cannot auto-classify.');
  console.log('  For each multi-payday record above, answer:');
  console.log('');
  console.log('    Q: Does amount=X mean you receive X on EACH payday?');
  console.log('       → Yes → Semantics B (per-payout) — no migration needed');
  console.log('       → No, X is my monthly total → Semantics A (monthly)');
  console.log('                                    → migration: amount / paydayCount');
  console.log('');
  console.log('  BLOCKED until human confirms semantics for all multi-payday records.');
  console.log('');
  console.log('  To confirm, re-run with --confirm-semantics=B or --confirm-semantics=A:');
  console.log('    npx tsx scripts/audit-income-semantics.ts --confirm-semantics=B');
  console.log('');

  // Check for --confirm-semantics flag
  const confirmArg = process.argv.find(a => a.startsWith('--confirm-semantics='));
  if (confirmArg) {
    const confirmed = confirmArg.split('=')[1]?.toUpperCase();
    if (confirmed === 'B') {
      console.log('  ✓ Semantics B confirmed by operator.');
      console.log('  VERDICT: UNIFORM_B — no data migration needed.');
      console.log('  Engine change: remove /payCount division from computeS2S.');
      console.log('  EXP_TOTAL_INCOME for golden fixture = Income.amount (no division).');
      await prisma.$disconnect();
      process.exit(0);
    } else if (confirmed === 'A') {
      console.log('  ~ Semantics A confirmed by operator.');
      console.log('  VERDICT: UNIFORM_A — data migration required.');
      console.log('  Run: npx tsx scripts/migrate-income-amount-to-per-payout.ts');
      console.log('  Migration: UPDATE Income SET amount = amount / paydays_count');
      console.log('             WHERE array_length(paydays, 1) > 1');
      await prisma.$disconnect();
      process.exit(0);
    } else {
      console.error(`  ERROR: unknown --confirm-semantics value: ${confirmed}. Use B or A.`);
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  await prisma.$disconnect();
  process.exit(1); // BLOCKED
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(2);
});
