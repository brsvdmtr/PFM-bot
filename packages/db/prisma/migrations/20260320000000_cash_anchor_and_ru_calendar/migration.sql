-- AddColumn: Period.triggerPayday
ALTER TABLE "Period" ADD COLUMN IF NOT EXISTS "triggerPayday" INTEGER;

-- AddColumn: Period.cashAnchorAmount
ALTER TABLE "Period" ADD COLUMN IF NOT EXISTS "cashAnchorAmount" INTEGER;

-- AddColumn: Period.cashAnchorAt
ALTER TABLE "Period" ADD COLUMN IF NOT EXISTS "cashAnchorAt" TIMESTAMP(3);

-- AddColumn: Period.lastIncomeDate
ALTER TABLE "Period" ADD COLUMN IF NOT EXISTS "lastIncomeDate" TIMESTAMP(3);

-- AddColumn: Period.nextIncomeDate
ALTER TABLE "Period" ADD COLUMN IF NOT EXISTS "nextIncomeDate" TIMESTAMP(3);

-- AddColumn: Period.nextIncomeAmount
ALTER TABLE "Period" ADD COLUMN IF NOT EXISTS "nextIncomeAmount" INTEGER;

-- AddColumn: Income.useRussianWorkCalendar
ALTER TABLE "Income" ADD COLUMN IF NOT EXISTS "useRussianWorkCalendar" BOOLEAN NOT NULL DEFAULT false;
