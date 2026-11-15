-- Automatic model routing. Additive: the previous release neither reads nor writes these columns,
-- and every agent keeps its pinned model (modelAuto defaults to false).
ALTER TABLE "bots" ADD COLUMN "modelAuto" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "runs" ADD COLUMN "modelTier" TEXT;
ALTER TABLE "runs" ADD COLUMN "tierEscalations" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "usage_records" ADD COLUMN "modelTier" TEXT;
ALTER TABLE "usage_records" ADD COLUMN "routedModel" TEXT;

ALTER TABLE "deployment_settings" ADD COLUMN "fastModelId" TEXT;
ALTER TABLE "deployment_settings" ADD COLUMN "strongModelId" TEXT;
