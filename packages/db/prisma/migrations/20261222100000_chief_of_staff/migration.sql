-- Additive only: the previous release neither reads nor writes these.
ALTER TABLE "bots" ADD COLUMN "chiefWatchAt" TIMESTAMP(3);

CREATE TABLE "surfaced_items" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT,
    "summary" TEXT NOT NULL,
    "runId" TEXT,
    "surfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surfaced_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surfaced_items_botId_threadId_key_key" ON "surfaced_items"("botId", "threadId", "key");
CREATE INDEX "surfaced_items_botId_threadId_surfacedAt_idx" ON "surfaced_items"("botId", "threadId", "surfacedAt");

ALTER TABLE "surfaced_items" ADD CONSTRAINT "surfaced_items_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
