-- A message posted inside a channel thread names the message the thread hangs from.
-- Additive: the previous release ignores the column.
ALTER TABLE "messages" ADD COLUMN "threadRootId" TEXT;
