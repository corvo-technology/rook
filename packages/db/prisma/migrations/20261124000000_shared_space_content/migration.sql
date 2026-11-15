-- Shared spaces: every member sees and works with the space's agents, channels and
-- conversations. Additive: the previous release neither reads nor writes these.

-- Who wrote a user message; NULL on older rows, which belong to the thread's creator.
ALTER TABLE "messages" ADD COLUMN "authorUserId" TEXT;

-- Per-member read state for a shared conversation. The thread's creator keeps using the
-- unread and lastReadSeq columns on the thread, so no row is moved or rewritten.
CREATE TABLE "thread_member_reads" (
  "threadId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "unread" BOOLEAN NOT NULL DEFAULT false,
  "lastReadSeq" INTEGER NOT NULL DEFAULT -1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "thread_member_reads_pkey" PRIMARY KEY ("threadId", "userId"),
  CONSTRAINT "thread_member_reads_threadId_fkey" FOREIGN KEY ("threadId")
    REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "thread_member_reads_spaceId_userId_idx" ON "thread_member_reads"("spaceId", "userId");

ALTER TABLE "thread_member_reads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY thread_member_reads_tenant ON "thread_member_reads"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY thread_member_reads_system ON "thread_member_reads"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "thread_member_reads" TO corvo_app;
