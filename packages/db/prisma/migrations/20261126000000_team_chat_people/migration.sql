-- Private channels and direct messages between people. Additive: the previous release neither
-- reads nor writes these, and a channel with no people rows stays open to the whole space.

CREATE TABLE "chat_group_people" (
  "groupId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "addedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_group_people_pkey" PRIMARY KEY ("groupId", "userId"),
  CONSTRAINT "chat_group_people_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "chat_group_people_spaceId_userId_idx" ON "chat_group_people"("spaceId", "userId");

CREATE TABLE "direct_threads" (
  "threadId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userAId" TEXT NOT NULL,
  "userBId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_threads_pkey" PRIMARY KEY ("threadId"),
  CONSTRAINT "direct_threads_threadId_fkey" FOREIGN KEY ("threadId")
    REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "direct_threads_spaceId_userAId_userBId_key"
  ON "direct_threads"("spaceId", "userAId", "userBId");
CREATE INDEX "direct_threads_spaceId_userBId_idx" ON "direct_threads"("spaceId", "userBId");

ALTER TABLE "chat_group_people" ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_group_people_tenant ON "chat_group_people"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY chat_group_people_system ON "chat_group_people"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "chat_group_people" TO corvo_app;

ALTER TABLE "direct_threads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY direct_threads_tenant ON "direct_threads"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY direct_threads_system ON "direct_threads"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "direct_threads" TO corvo_app;
