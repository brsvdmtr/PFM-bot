-- AddColumn: User.localeUserSet
-- Tracks whether the user explicitly chose a locale via Settings (true)
-- or whether their locale should be auto-redetected from Telegram language_code (false).
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "localeUserSet" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
