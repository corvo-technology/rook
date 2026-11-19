-- Additive: one nullable column. The previous release neither reads nor writes it.
ALTER TABLE "runs" ADD COLUMN "hostContext" JSONB;
