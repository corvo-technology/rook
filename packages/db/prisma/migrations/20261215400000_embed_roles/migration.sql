-- The role and scope a partner sends with a session. Both are optional: a session without them
-- opens the customer's owner, exactly as before.
ALTER TABLE "partner_entry_codes" ADD COLUMN "role" TEXT;
ALTER TABLE "partner_entry_codes" ADD COLUMN "scope" JSONB;

-- CreateTable
CREATE TABLE "partner_tenant_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalEmail" TEXT,
    "role" TEXT NOT NULL,
    "scope" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_tenant_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_tenant_members_tenantId_externalUserId_key" ON "partner_tenant_members"("tenantId", "externalUserId");

-- CreateIndex
CREATE INDEX "partner_tenant_members_userId_idx" ON "partner_tenant_members"("userId");

-- AddForeignKey
ALTER TABLE "partner_tenant_members" ADD CONSTRAINT "partner_tenant_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "partner_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partner_tenant_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_tenant_members_system ON "partner_tenant_members"
  USING (current_setting('app.rls_bypass', true) = 'on');
