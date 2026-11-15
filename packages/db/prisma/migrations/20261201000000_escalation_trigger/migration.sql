-- Why a run moved up a tier. Additive: the previous release neither reads nor writes these columns.
ALTER TABLE "runs" ADD COLUMN "escalationTrigger" TEXT;
ALTER TABLE "runs" ADD COLUMN "escalationReason" TEXT;
