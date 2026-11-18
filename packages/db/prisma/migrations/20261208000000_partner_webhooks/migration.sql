-- Additive only: the previous release never reads these.
ALTER TABLE "partners" ADD COLUMN "walletOwnerUserId" TEXT;
ALTER TABLE "partners" ADD COLUMN "webhookUrl" TEXT;
ALTER TABLE "partners" ADD COLUMN "webhookSecretVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "partner_webhook_events" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "externalTenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "grantedCents" INTEGER NOT NULL,
    "usedCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "partner_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_webhook_events_partnerId_externalTenantId_kind_period_key"
  ON "partner_webhook_events"("partnerId", "externalTenantId", "kind", "period");

ALTER TABLE "partner_webhook_events" ADD CONSTRAINT "partner_webhook_events_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- System-only, like the other partner tables.
ALTER TABLE "partner_webhook_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_webhook_events_system ON "partner_webhook_events"
  USING (current_setting('app.rls_bypass', true) = 'on');
