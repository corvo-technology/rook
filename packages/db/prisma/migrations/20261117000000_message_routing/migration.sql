-- Additive: the previous release neither reads nor writes this column.
ALTER TABLE "messages" ADD COLUMN "routing" JSONB;
