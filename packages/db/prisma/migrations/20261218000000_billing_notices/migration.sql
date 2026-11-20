-- Additive: the previous release never reads or writes this table.
CREATE TABLE "billing_notices" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_notices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_notices_key_key" ON "billing_notices"("key");
CREATE INDEX "billing_notices_organizationId_createdAt_idx" ON "billing_notices"("organizationId", "createdAt");

-- Internal and system-only, like the billing journal.
ALTER TABLE "billing_notices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_notices_system ON "billing_notices"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, DELETE ON "billing_notices" TO corvo_app;
