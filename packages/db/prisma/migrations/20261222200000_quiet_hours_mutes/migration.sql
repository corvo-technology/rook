-- Quiet hours, mutes and the morning digest. Additive: the previous release neither reads nor
-- writes these columns or tables, and pushes keep going out as before for it.
ALTER TABLE "user"
  ADD COLUMN "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "quietHoursStart" INTEGER NOT NULL DEFAULT 1320,
  ADD COLUMN "quietHoursEnd" INTEGER NOT NULL DEFAULT 480;

ALTER TABLE "runs" ADD COLUMN "notifyPriority" TEXT;

CREATE TABLE "notification_mutes" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "until" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_mutes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_mutes_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_mutes_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notification_mutes_userId_targetKey_key" ON "notification_mutes"("userId", "targetKey");
CREATE INDEX "notification_mutes_spaceId_userId_idx" ON "notification_mutes"("spaceId", "userId");

CREATE TABLE "held_notifications" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "message" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "releaseAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "held_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "held_notifications_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "held_notifications_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "held_notifications_userId_releaseAt_idx" ON "held_notifications"("userId", "releaseAt");

CREATE TABLE "proactive_push_counts" (
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "proactive_push_counts_pkey" PRIMARY KEY ("userId", "botId", "day"),
  CONSTRAINT "proactive_push_counts_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "proactive_push_counts_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proactive_push_counts_day_idx" ON "proactive_push_counts"("day");

-- Scoped by space like the other per-member rows; the member filter is applied in the queries.
ALTER TABLE "notification_mutes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_mutes_tenant ON "notification_mutes"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY notification_mutes_system ON "notification_mutes"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_mutes" TO corvo_app;

ALTER TABLE "held_notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY held_notifications_tenant ON "held_notifications"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY held_notifications_system ON "held_notifications"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "held_notifications" TO corvo_app;

ALTER TABLE "proactive_push_counts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY proactive_push_counts_tenant ON "proactive_push_counts"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY proactive_push_counts_system ON "proactive_push_counts"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "proactive_push_counts" TO corvo_app;
