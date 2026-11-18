-- Additive: the previous release neither reads nor writes these tables. Nothing is dropped or renamed.

-- CreateTable
CREATE TABLE "partner_plans" (
    "partnerId" TEXT NOT NULL,
    "tierKey" TEXT NOT NULL,
    "pricingVersion" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "includedCredits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_plans_pkey" PRIMARY KEY ("partnerId")
);

-- CreateTable
CREATE TABLE "partner_auto_topup_attempts" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "crossingKey" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_auto_topup_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_auto_topup_attempts_partnerId_crossingKey_key" ON "partner_auto_topup_attempts"("partnerId", "crossingKey");

-- AddForeignKey
ALTER TABLE "partner_plans" ADD CONSTRAINT "partner_plans_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_auto_topup_attempts" ADD CONSTRAINT "partner_auto_topup_attempts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
