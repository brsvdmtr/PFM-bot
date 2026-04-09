-- CreateEnum: FreeCashMode
DO $$ BEGIN
  CREATE TYPE "FreeCashMode" AS ENUM ('EMERGENCY_FUND', 'DEBT_PREPAY', 'SPLIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: FreeCashReason
DO $$ BEGIN
  CREATE TYPE "FreeCashReason" AS ENUM (
    'NO_SIGNIFICANT_AMOUNT',
    'NO_DEBT',
    'EF_PROTECTIVE',
    'EF_FULLY_FUNDED',
    'HIGH_APR_DEBT',
    'BALANCED_SPLIT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: FreeCashEvent
CREATE TABLE IF NOT EXISTS "FreeCashEvent" (
  "id"                     TEXT NOT NULL,
  "userId"                 TEXT NOT NULL,
  "periodId"               TEXT,
  "amountMinor"            INTEGER NOT NULL,
  "currency"               "Currency" NOT NULL DEFAULT 'RUB',

  -- Recommendation snapshot (what the engine said at the time)
  "recommendedMode"        "FreeCashMode" NOT NULL,
  "reasonCode"             "FreeCashReason" NOT NULL,

  -- Actual user choice (may differ from recommendation)
  "chosenMode"             "FreeCashMode" NOT NULL,
  "splitEfShare"           DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "toEfMinor"              INTEGER NOT NULL,
  "toDebtMinor"            INTEGER NOT NULL,
  "focusDebtId"            TEXT,

  -- Snapshot of inputs for later analysis (not foreign keys)
  "efCurrentMinor"         INTEGER NOT NULL,
  "efTargetMinor"          INTEGER NOT NULL,
  "monthlyEssentialsMinor" INTEGER NOT NULL,

  "note"                   TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FreeCashEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "FreeCashEvent_userId_createdAt_idx"
  ON "FreeCashEvent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "FreeCashEvent_periodId_idx"
  ON "FreeCashEvent"("periodId");

-- AddForeignKey: userId → User.id (CASCADE)
DO $$ BEGIN
  ALTER TABLE "FreeCashEvent"
    ADD CONSTRAINT "FreeCashEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
