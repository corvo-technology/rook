-- Additive: the previous release neither reads nor writes these columns.
ALTER TABLE "bots" ADD COLUMN "monthlyTokenLimit" BIGINT;
ALTER TABLE "bots" ADD COLUMN "budgetAlertMonth" TEXT;
ALTER TABLE "spaces" ADD COLUMN "pausedAt" TIMESTAMP(3);
