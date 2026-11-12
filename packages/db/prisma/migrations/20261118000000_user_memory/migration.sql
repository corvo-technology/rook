-- Additive: the previous release neither reads nor writes these tables or columns.
-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "memoryMode" TEXT;

-- AlterTable
ALTER TABLE "space_members" ADD COLUMN     "memoryLearning" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "memoryLearnedUpToSeq" INTEGER;

-- CreateTable
CREATE TABLE "user_memories" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'saved',
    "source" TEXT NOT NULL,
    "botId" TEXT,
    "threadId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_memories_spaceId_userId_state_idx" ON "user_memories"("spaceId", "userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "user_memories_spaceId_userId_fingerprint_key" ON "user_memories"("spaceId", "userId", "fingerprint");

-- AddForeignKey
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What a person's agents know about them is that person's: one Space and one user.
ALTER TABLE "user_memories" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_memories_tenant ON "user_memories"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), '')
     AND "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY user_memories_system ON "user_memories"
  USING (current_setting('app.rls_bypass', true) = 'on');
