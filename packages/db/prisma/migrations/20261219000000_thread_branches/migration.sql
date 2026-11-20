-- Additive: the previous release neither reads nor writes the new table or columns. Its messages
-- carry no branch, which is the original line, so it keeps working while both releases run.
ALTER TABLE "threads" ADD COLUMN "activeBranchId" TEXT;
ALTER TABLE "messages" ADD COLUMN "branchId" TEXT;

CREATE TABLE "thread_branches" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentBranchId" TEXT,
    "forkSeq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_branches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "thread_branches_threadId_createdAt_idx" ON "thread_branches"("threadId", "createdAt");
CREATE INDEX "messages_threadId_branchId_seq_idx" ON "messages"("threadId", "branchId", "seq");

ALTER TABLE "thread_branches" ADD CONSTRAINT "thread_branches_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same policies as the Space's other rows: any member of the Space reaches its thread branches.
ALTER TABLE "thread_branches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY thread_branches_tenant ON "thread_branches"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY thread_branches_system ON "thread_branches"
  USING (current_setting('app.rls_bypass', true) = 'on');
