# Income Semantics — Canonical Definition

**Status:** Frozen as of 2026-03-21
**Author:** controlled data fix, confirmed by Dmitriy

---

## Canonical Definition (Semantics B — per-payout)

```
Income.amount = the amount the user RECEIVES on each single payout occurrence.
                = per-payout amount, NOT monthly total.
                Unit: kopecks (minor units). Display layer divides by 100.
```

### Formula: contribution per period

```typescript
// In computeS2S — income matched by startNominalPayday (NOT endDay inference):
const hasTrigger = income.paydays.includes(inputs.startNominalPayday);
if (!hasTrigger) return sum;
return sum + income.amount;   // Semantics B: no division by paydays.length
```

`startNominalPayday` = the nominal calendar payday that triggered the start of the
current period, resolved by `calculateActualPeriodBounds()` → `ActualPeriodBounds.startNominalPayday`.

### Multi-income modelling

To model different amounts per payday, create separate Income records:

```
{ amount: 30_000_000 kopecks, paydays: [15] }  // 300,000 ₽ on the 15th
{ amount: 20_000_000 kopecks, paydays: [1]  }  // 200,000 ₽ on the 1st
```

A single record with `paydays=[1,15]` means the user receives `amount` kopecks
on BOTH the 1st and the 15th — i.e. twice per month.

---

## Data Migration Applied: 2026-03-21

### User: Dmitriy (tgId: 327159577)

**Income record:** `cmmzgm719000dsq01ylaljmvm` (title: зп)

#### BEFORE (Semantics A — monthly total)

| Field                  | Value                            |
|------------------------|----------------------------------|
| amount                 | 50,000,000 kopecks (500,000 ₽)  |
| paydays                | [1, 15]                          |
| useRussianWorkCalendar | false                            |
| Engine formula         | round(50,000,000 / 2) = 25,000,000 kopecks = 250,000 ₽/payout |
| Period start (Mar '26) | 2026-03-15 (Sunday, no adjustment) |

#### AFTER (Semantics B — per-payout)

| Field                  | Value                            |
|------------------------|----------------------------------|
| amount                 | 25,000,000 kopecks (250,000 ₽)  |
| paydays                | [1, 15]                          |
| useRussianWorkCalendar | true                             |
| Engine formula         | 25,000,000 kopecks = 250,000 ₽/payout (no division) |
| Period start (Mar '26) | 2026-03-13 (Friday, adjusted from Sunday Mar 15) ✓ |

#### Why this is correct

1. **amount halved (50M → 25M kopecks):**
   User receives 250,000 ₽ per payout, not 500,000 ₽.
   Old record stored monthly total under implicit Semantics A.
   New record stores per-payout amount under explicit Semantics B.
   Result on dashboard: identical (250,000 ₽ per period). No regression.

2. **useRussianWorkCalendar = true:**
   March 15 2026 is a Sunday. Without this flag, `getActualPayday` returns
   March 15 (Sunday) — a non-working day on which no bank transfer occurs.
   With flag = true, `getActualPayday(2026, 2, 15, true)` → March 13 (Friday).
   This matches the factual payout date confirmed by the user.

---

## Verification

```
getActualPayday(2026, 2, 15, useRuCalendar=true)  → 2026-03-13 (Fri) ✓
getActualPayday(2026, 3,  1, useRuCalendar=true)  → 2026-04-01 (Wed) ✓

periodStart        = 2026-03-13T00:00:00+03:00
periodEnd          = 2026-04-01T00:00:00+03:00
daysTotal          = 19
startNominalPayday = 15  (income.paydays=[1,15].includes(15) = true → matched)
endNominalPayday   = 1

EXP_TOTAL_INCOME   = 25,000,000 kopecks = 250,000 ₽
```

---

## Golden Fixture Values (post-migration)

```typescript
export const GOLDEN_INCOME = [
  {
    id: 'cmmzgm719000dsq01ylaljmvm',
    amount: 25_000_000,              // kopecks, per-payout, Semantics B ✓
    paydays: [1, 15],
    useRussianWorkCalendar: true,    // ✓ fixed from false
  },
];

// Independent expected value for golden tests:
const EXP_TOTAL_INCOME = 25_000_000; // kopecks = 250,000 ₽
```

---

## Do Not Change Without

- Team sign-off
- A new audit script run across all active Income records
- A corresponding migration for all affected records
- Update to this document
