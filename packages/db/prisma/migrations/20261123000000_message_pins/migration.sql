-- A message can be pinned to its channel. Additive: the previous release ignores both columns.
ALTER TABLE "messages" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN "pinnedBy" TEXT;
