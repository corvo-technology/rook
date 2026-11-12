-- Additive: the previous release neither reads nor writes this column.
-- AlterTable
ALTER TABLE "wiki_settings" ADD COLUMN     "reviewedAt" TIMESTAMP(3);
