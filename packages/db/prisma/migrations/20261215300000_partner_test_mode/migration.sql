-- Partner test mode: a separate test key, test customers and a daily cap. Additive: new nullable
-- or defaulted columns and a new table the previous release never reads.
ALTER TABLE "partners"
  ADD COLUMN "testKeyPrefix" TEXT,
  ADD COLUMN "testKeyHash" TEXT,
  ADD COLUMN "testWebhookUrl" TEXT,
  ADD COLUMN "testDailyCap" INTEGER NOT NULL DEFAULT 300;
CREATE UNIQUE INDEX "partners_testKeyPrefix_key" ON "partners"("testKeyPrefix");

ALTER TABLE "partner_tenants" ADD COLUMN "testMode" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "partner_tenants_partnerId_testMode_idx" ON "partner_tenants"("partnerId", "testMode");

CREATE TABLE "partner_test_usage" (
  "partnerId" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_test_usage_pkey" PRIMARY KEY ("partnerId", "day"),
  CONSTRAINT "partner_test_usage_partnerId_fkey" FOREIGN KEY ("partnerId")
    REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "partner_test_usage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_test_usage_system ON "partner_test_usage"
  USING (current_setting('app.rls_bypass', true) = 'on');
