-- How many times a conflicting wiki change was written again. Additive: the previous release
-- neither reads nor writes this column.
ALTER TABLE "wiki_changes" ADD COLUMN "retries" INTEGER NOT NULL DEFAULT 0;
