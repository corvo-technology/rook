-- Additive: the previous release neither reads nor writes this column.
ALTER TABLE "push_tokens" ADD COLUMN "locale" TEXT;
