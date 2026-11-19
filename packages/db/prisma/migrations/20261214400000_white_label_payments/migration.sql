-- Additive: new nullable or defaulted columns and new tables. The previous release neither reads nor
-- writes them, so it keeps working while this one starts. Nothing is dropped or renamed.

-- AlterTable
ALTER TABLE "partners" ADD COLUMN "connectAccountId" TEXT,
ADD COLUMN "connectState" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "tenant_subscriptions" ADD COLUMN "providerCustomerRef" TEXT,
ADD COLUMN "providerSubscriptionRef" TEXT;

-- CreateTable
CREATE TABLE "partner_payouts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_disputes" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerTenantId" TEXT,
    "providerRef" TEXT NOT NULL,
    "paymentRef" TEXT,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_connectAccountId_key" ON "partners"("connectAccountId");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_providerSubscriptionRef_idx" ON "tenant_subscriptions"("providerSubscriptionRef");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payouts_providerRef_key" ON "partner_payouts"("providerRef");

-- CreateIndex
CREATE INDEX "partner_payouts_partnerId_createdAt_idx" ON "partner_payouts"("partnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_disputes_providerRef_key" ON "partner_disputes"("providerRef");

-- CreateIndex
CREATE INDEX "partner_disputes_partnerId_createdAt_idx" ON "partner_disputes"("partnerId", "createdAt");

-- AddForeignKey
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_disputes" ADD CONSTRAINT "partner_disputes_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
