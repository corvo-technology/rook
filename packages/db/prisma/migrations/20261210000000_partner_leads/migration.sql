-- Additive: the previous release neither reads nor writes this table.
-- CreateTable
CREATE TABLE "partner_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "website" TEXT,
    "partnerType" TEXT NOT NULL,
    "country" TEXT,
    "customers" TEXT,
    "message" TEXT,
    "locale" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "partner_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_leads_createdAt_idx" ON "partner_leads"("createdAt");

-- Internal data: only server code that runs as the system reads or writes it.
ALTER TABLE "partner_leads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_leads_system ON "partner_leads"
  USING (current_setting('app.rls_bypass', true) = 'on');
