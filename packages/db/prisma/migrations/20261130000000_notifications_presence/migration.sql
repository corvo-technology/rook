-- Notifications inbox and presence. Additive: the previous release neither reads nor writes
-- this table or column.
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "threadId" TEXT,
  "messageId" TEXT,
  "botId" TEXT,
  "actorId" TEXT,
  "detail" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");
CREATE INDEX "notifications_spaceId_userId_readAt_createdAt_idx"
  ON "notifications"("spaceId", "userId", "readAt", "createdAt");
CREATE INDEX "notifications_userId_threadId_readAt_idx" ON "notifications"("userId", "threadId", "readAt");

-- Scoped by space like the other per-member rows; the member filter is applied in the queries.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant ON "notifications"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY notifications_system ON "notifications"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO corvo_app;

ALTER TABLE "space_members" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
