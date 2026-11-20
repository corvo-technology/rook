-- Additive: columns the previous release never reads.
ALTER TABLE "billing_accounts" ADD COLUMN "aiUseCents" INTEGER;
ALTER TABLE "billing_accounts" ADD COLUMN "pendingPlanKey" TEXT;
ALTER TABLE "billing_accounts" ADD COLUMN "pendingAiUseCents" INTEGER;
