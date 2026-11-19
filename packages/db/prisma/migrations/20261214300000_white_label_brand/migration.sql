-- Additive: new tables only. The previous release neither reads nor writes them.

-- CreateTable
CREATE TABLE "partner_brands" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "logoKey" TEXT,
    "iconKey" TEXT,
    "accent" TEXT,
    "supportEmail" TEXT,
    "termsUrl" TEXT,
    "privacyUrl" TEXT,
    "senderDomain" TEXT,
    "senderState" TEXT NOT NULL DEFAULT 'none',
    "senderProviderId" TEXT,
    "senderRecords" JSONB,
    "senderError" TEXT,
    "senderCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_domains" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "providerId" TEXT,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_customers" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_brands_partnerId_key" ON "partner_brands"("partnerId");
CREATE UNIQUE INDEX "partner_domains_hostname_key" ON "partner_domains"("hostname");
CREATE INDEX "partner_domains_partnerId_idx" ON "partner_domains"("partnerId");
CREATE INDEX "partner_domains_state_idx" ON "partner_domains"("state");
CREATE UNIQUE INDEX "partner_customers_organizationId_key" ON "partner_customers"("organizationId");
CREATE INDEX "partner_customers_partnerId_idx" ON "partner_customers"("partnerId");

-- AddForeignKey
ALTER TABLE "partner_brands" ADD CONSTRAINT "partner_brands_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_domains" ADD CONSTRAINT "partner_domains_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partner_customers" ADD CONSTRAINT "partner_customers_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_customers" ADD CONSTRAINT "partner_customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A customer belongs to one partner for good: the link can be removed with its organization but
-- never pointed somewhere else.
CREATE FUNCTION partner_customers_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."partnerId" IS DISTINCT FROM OLD."partnerId"
     OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."hostname" IS DISTINCT FROM OLD."hostname" THEN
    RAISE EXCEPTION 'partner_customers rows cannot change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER partner_customers_immutable BEFORE UPDATE ON "partner_customers"
  FOR EACH ROW EXECUTE FUNCTION partner_customers_immutable();

-- System-only, like the other partner tables.
ALTER TABLE "partner_brands" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_brands_system ON "partner_brands"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "partner_domains" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_domains_system ON "partner_domains"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "partner_customers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_customers_system ON "partner_customers"
  USING (current_setting('app.rls_bypass', true) = 'on');
