-- Additive: the previous release never reads or writes this column.
ALTER TABLE "user" ADD COLUMN "locale" TEXT;
