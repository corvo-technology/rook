-- Events a partner's system sends, and routines they start. Additive: new nullable columns and a
-- new table the previous release never reads.
ALTER TABLE "routines" ADD COLUMN "eventTrigger" JSONB,
ADD COLUMN "templateKey" TEXT;

CREATE UNIQUE INDEX "routines_botId_templateKey_key" ON "routines"("botId", "templateKey");

CREATE TABLE "partner_events" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "externalTenantId" TEXT NOT NULL,
  "organizationId" TEXT,
  "type" TEXT NOT NULL,
  "name" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "payload" JSONB,
  "matched" INTEGER NOT NULL DEFAULT 0,
  "delivered" INTEGER NOT NULL DEFAULT 0,
  "occurredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_events_partnerId_fkey" FOREIGN KEY ("partnerId")
    REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "partner_events_partnerId_createdAt_idx" ON "partner_events"("partnerId", "createdAt");
CREATE INDEX "partner_events_organizationId_createdAt_idx" ON "partner_events"("organizationId", "createdAt");
CREATE INDEX "partner_events_expiresAt_idx" ON "partner_events"("expiresAt");

-- Only server code running as the system reads or writes the log; customers see it through the app.
ALTER TABLE "partner_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_events_system ON "partner_events"
  USING (current_setting('app.rls_bypass', true) = 'on');
-- A customer's own people may read what reached their space, to see what started a routine.
CREATE POLICY partner_events_space_read ON "partner_events" FOR SELECT
  USING ("organizationId" = NULLIF(current_setting('app.space_id', true), ''));
