-- What a partner's people are told by email and in the app. Additive: new tables the previous
-- release never reads.
CREATE TABLE "partner_alerts" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "externalTenantId" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3),
  "emailedAt" TIMESTAMP(3),
  CONSTRAINT "partner_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_alerts_partnerId_fkey" FOREIGN KEY ("partnerId")
    REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "partner_alerts_partnerId_externalTenantId_kind_key_key"
  ON "partner_alerts"("partnerId", "externalTenantId", "kind", "key");
CREATE INDEX "partner_alerts_dispatchedAt_createdAt_idx"
  ON "partner_alerts"("dispatchedAt", "createdAt");

CREATE TABLE "partner_alert_preferences" (
  "partnerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "email" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "partner_alert_preferences_pkey" PRIMARY KEY ("partnerId", "kind"),
  CONSTRAINT "partner_alert_preferences_partnerId_fkey" FOREIGN KEY ("partnerId")
    REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "partner_alerts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_alerts_system ON "partner_alerts"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "partner_alert_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_alert_preferences_system ON "partner_alert_preferences"
  USING (current_setting('app.rls_bypass', true) = 'on');
