-- CreateEnum: DebtPaymentKind
DO $$ BEGIN
  CREATE TYPE "DebtPaymentKind" AS ENUM ('REQUIRED_MIN_PAYMENT', 'EXTRA_PRINCIPAL_PAYMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: DebtPaymentSource
DO $$ BEGIN
  CREATE TYPE "DebtPaymentSource" AS ENUM ('MANUAL', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: DebtPaymentEvent
CREATE TABLE IF NOT EXISTS "DebtPaymentEvent" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "debtId"      TEXT NOT NULL,
  "periodId"    TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind"        "DebtPaymentKind" NOT NULL,
  "source"      "DebtPaymentSource" NOT NULL DEFAULT 'MANUAL',
  "note"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"   TIMESTAMP(3),

  CONSTRAINT "DebtPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "DebtPaymentEvent_userId_periodId_idx"
  ON "DebtPaymentEvent"("userId", "periodId");

CREATE INDEX IF NOT EXISTS "DebtPaymentEvent_debtId_periodId_idx"
  ON "DebtPaymentEvent"("debtId", "periodId");

-- AddForeignKeys (safe: IF NOT EXISTS via DO block)
DO $$ BEGIN
  ALTER TABLE "DebtPaymentEvent"
    ADD CONSTRAINT "DebtPaymentEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DebtPaymentEvent"
    ADD CONSTRAINT "DebtPaymentEvent_debtId_fkey"
    FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DebtPaymentEvent"
    ADD CONSTRAINT "DebtPaymentEvent_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
