-- Additive only: new tables, and new columns with defaults, so the previous release keeps working.

-- AlterTable
ALTER TABLE "partner_webhook_events" ADD COLUMN     "payload" JSONB;

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "billingModel" TEXT NOT NULL DEFAULT 'wallet',
ADD COLUMN     "checkoutUrl" TEXT,
ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 2000,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'embedded',
ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['tenants:write']::TEXT[];

-- CreateTable
CREATE TABLE "catalog_plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalog_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_plan_prices" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "creditMinor" INTEGER NOT NULL,
    "creditExpires" TEXT NOT NULL DEFAULT 'period_end',

    CONSTRAINT "catalog_plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_packs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalog_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_pack_prices" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "creditMinor" INTEGER NOT NULL,

    CONSTRAINT "catalog_pack_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'USD',
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "pendingPlanKey" TEXT,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "baseMinor" INTEGER NOT NULL,
    "markupMinor" INTEGER NOT NULL DEFAULT 0,
    "chargedMinor" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'partner_reported',
    "externalRef" TEXT,
    "pastDueSince" TIMESTAMP(3),
    "lapsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_grants" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "creditMinor" INTEGER NOT NULL,
    "creditMicros" BIGINT NOT NULL,
    "fxRateId" TEXT,
    "fxRate" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_share_entries" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "baseMinor" INTEGER NOT NULL,
    "rookShareMinor" INTEGER NOT NULL,
    "partnerCommissionMinor" INTEGER NOT NULL,
    "markupMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "externalRef" TEXT,
    "reverses" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_share_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_invoices" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "totalMinor" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "partnerTenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "rookShareMinor" INTEGER NOT NULL,

    CONSTRAINT "partner_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "status" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_plans_key_key" ON "catalog_plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_plan_prices_planId_currency_key" ON "catalog_plan_prices"("planId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_packs_key_key" ON "catalog_packs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_pack_prices_packId_currency_key" ON "catalog_pack_prices"("packId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_base_quote_validFrom_key" ON "fx_rates"("base", "quote", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_partnerTenantId_key" ON "tenant_subscriptions"("partnerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_grants_source_key" ON "credit_grants"("source");

-- CreateIndex
CREATE INDEX "credit_grants_partnerTenantId_period_idx" ON "credit_grants"("partnerTenantId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_share_entries_source_key" ON "revenue_share_entries"("source");

-- CreateIndex
CREATE INDEX "revenue_share_entries_partnerId_period_idx" ON "revenue_share_entries"("partnerId", "period");

-- CreateIndex
CREATE INDEX "revenue_share_entries_partnerTenantId_externalRef_idx" ON "revenue_share_entries"("partnerTenantId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "partner_invoices_partnerId_period_currency_key" ON "partner_invoices"("partnerId", "period", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "partner_invoice_lines_entryId_key" ON "partner_invoice_lines"("entryId");

-- CreateIndex
CREATE INDEX "partner_invoice_lines_invoiceId_idx" ON "partner_invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_partnerId_key_key" ON "idempotency_records"("partnerId", "key");

-- AddForeignKey
ALTER TABLE "catalog_plan_prices" ADD CONSTRAINT "catalog_plan_prices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "catalog_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_pack_prices" ADD CONSTRAINT "catalog_pack_prices_packId_fkey" FOREIGN KEY ("packId") REFERENCES "catalog_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_partnerTenantId_fkey" FOREIGN KEY ("partnerTenantId") REFERENCES "partner_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_share_entries" ADD CONSTRAINT "revenue_share_entries_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_invoices" ADD CONSTRAINT "partner_invoices_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_invoice_lines" ADD CONSTRAINT "partner_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "partner_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- System-only, like the other partner tables.
ALTER TABLE "catalog_plans" ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_plans_system ON "catalog_plans"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "catalog_plan_prices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_plan_prices_system ON "catalog_plan_prices"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "catalog_packs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_packs_system ON "catalog_packs"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "catalog_pack_prices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_pack_prices_system ON "catalog_pack_prices"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "fx_rates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY fx_rates_system ON "fx_rates"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "commerce_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY commerce_settings_system ON "commerce_settings"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_subscriptions_system ON "tenant_subscriptions"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "credit_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_grants_system ON "credit_grants"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "revenue_share_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY revenue_share_entries_system ON "revenue_share_entries"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "partner_invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_invoices_system ON "partner_invoices"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "partner_invoice_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_invoice_lines_system ON "partner_invoice_lines"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_records_system ON "idempotency_records"
  USING (current_setting('app.rls_bypass', true) = 'on');
