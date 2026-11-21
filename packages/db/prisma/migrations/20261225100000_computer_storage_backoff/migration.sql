-- Additive only: new nullable columns, so the previous release keeps working beside it.
ALTER TABLE "computers" ADD COLUMN "storageFullAt" TIMESTAMP(3);
ALTER TABLE "computers" ADD COLUMN "storageWarnedAt" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "storagePausedFrom" TEXT;
