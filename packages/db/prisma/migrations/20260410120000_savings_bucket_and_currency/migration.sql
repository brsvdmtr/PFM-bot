-- Expand Currency enum with new values
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'EUR';
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'GBP';
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'CHF';
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'CNY';
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'JPY';
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'AED';
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'TRY';
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'USDT';

-- CreateEnum: BucketType
DO $$ BEGIN
  CREATE TYPE "BucketType" AS ENUM (
    'SAVINGS_ACCOUNT', 'DEPOSIT', 'CASH', 'CRYPTO', 'BROKERAGE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: EFTargetMode
DO $$ BEGIN
  CREATE TYPE "EFTargetMode" AS ENUM ('BY_SALARY', 'BY_EXPENSES', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: ContributionFrequency
DO $$ BEGIN
  CREATE TYPE "ContributionFrequency" AS ENUM ('MONTHLY', 'BIWEEKLY', 'WEEKLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: SavingsPace
DO $$ BEGIN
  CREATE TYPE "SavingsPace" AS ENUM ('GENTLE', 'OPTIMAL', 'AGGRESSIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: EFEntryType
DO $$ BEGIN
  CREATE TYPE "EFEntryType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'BALANCE_SYNC', 'CORRECTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: SavingsBucket
CREATE TABLE IF NOT EXISTS "SavingsBucket" (
  "id"                         TEXT NOT NULL,
  "userId"                     TEXT NOT NULL,
  "emergencyFundId"            TEXT NOT NULL,
  "name"                       TEXT NOT NULL,
  "type"                       "BucketType" NOT NULL,
  "currency"                   "Currency" NOT NULL DEFAULT 'RUB',
  "currentAmount"              INTEGER NOT NULL DEFAULT 0,
  "countsTowardEmergencyFund"  BOOLEAN NOT NULL DEFAULT true,
  "isArchived"                 BOOLEAN NOT NULL DEFAULT false,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SavingsBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmergencyFundPlan (if not exists)
CREATE TABLE IF NOT EXISTS "EmergencyFundPlan" (
  "id"                          TEXT NOT NULL,
  "userId"                      TEXT NOT NULL,
  "emergencyFundId"             TEXT NOT NULL,
  "targetMode"                  "EFTargetMode" NOT NULL DEFAULT 'BY_SALARY',
  "baseMonthlyAmount"           INTEGER,
  "targetMonths"                INTEGER DEFAULT 3,
  "manualTargetAmount"          INTEGER,
  "targetDeadlineAt"            TIMESTAMP(3),
  "contributionFrequency"       "ContributionFrequency" NOT NULL DEFAULT 'MONTHLY',
  "preferredPace"               "SavingsPace",
  "planSelectionMode"           TEXT,
  "customContributionAmount"    INTEGER,
  "customContributionFrequency" TEXT,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmergencyFundPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable: EmergencyFundEntry (if not exists)
CREATE TABLE IF NOT EXISTS "EmergencyFundEntry" (
  "id"                   TEXT NOT NULL,
  "userId"               TEXT NOT NULL,
  "emergencyFundId"      TEXT NOT NULL,
  "bucketId"             TEXT,
  "periodId"             TEXT,
  "type"                 "EFEntryType" NOT NULL,
  "amount"               INTEGER NOT NULL,
  "affectsCurrentBudget" BOOLEAN NOT NULL DEFAULT false,
  "note"                 TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt"           TIMESTAMP(3),

  CONSTRAINT "EmergencyFundEntry_pkey" PRIMARY KEY ("id")
);

-- Indexes: SavingsBucket
CREATE INDEX IF NOT EXISTS "SavingsBucket_userId_idx"
  ON "SavingsBucket"("userId");
CREATE INDEX IF NOT EXISTS "SavingsBucket_emergencyFundId_idx"
  ON "SavingsBucket"("emergencyFundId");

-- Indexes: EmergencyFundPlan
DO $$ BEGIN
  ALTER TABLE "EmergencyFundPlan"
    ADD CONSTRAINT "EmergencyFundPlan_userId_key" UNIQUE ("userId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmergencyFundPlan"
    ADD CONSTRAINT "EmergencyFundPlan_emergencyFundId_key" UNIQUE ("emergencyFundId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes: EmergencyFundEntry
CREATE INDEX IF NOT EXISTS "EmergencyFundEntry_userId_createdAt_idx"
  ON "EmergencyFundEntry"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmergencyFundEntry_emergencyFundId_idx"
  ON "EmergencyFundEntry"("emergencyFundId");
CREATE INDEX IF NOT EXISTS "EmergencyFundEntry_bucketId_idx"
  ON "EmergencyFundEntry"("bucketId");
CREATE INDEX IF NOT EXISTS "EmergencyFundEntry_periodId_idx"
  ON "EmergencyFundEntry"("periodId");

-- ForeignKeys: SavingsBucket
DO $$ BEGIN
  ALTER TABLE "SavingsBucket"
    ADD CONSTRAINT "SavingsBucket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SavingsBucket"
    ADD CONSTRAINT "SavingsBucket_emergencyFundId_fkey"
    FOREIGN KEY ("emergencyFundId") REFERENCES "EmergencyFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ForeignKeys: EmergencyFundPlan
DO $$ BEGIN
  ALTER TABLE "EmergencyFundPlan"
    ADD CONSTRAINT "EmergencyFundPlan_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmergencyFundPlan"
    ADD CONSTRAINT "EmergencyFundPlan_emergencyFundId_fkey"
    FOREIGN KEY ("emergencyFundId") REFERENCES "EmergencyFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ForeignKeys: EmergencyFundEntry
DO $$ BEGIN
  ALTER TABLE "EmergencyFundEntry"
    ADD CONSTRAINT "EmergencyFundEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmergencyFundEntry"
    ADD CONSTRAINT "EmergencyFundEntry_emergencyFundId_fkey"
    FOREIGN KEY ("emergencyFundId") REFERENCES "EmergencyFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmergencyFundEntry"
    ADD CONSTRAINT "EmergencyFundEntry_bucketId_fkey"
    FOREIGN KEY ("bucketId") REFERENCES "SavingsBucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmergencyFundEntry"
    ADD CONSTRAINT "EmergencyFundEntry_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
