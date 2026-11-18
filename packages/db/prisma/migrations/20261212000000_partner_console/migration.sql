-- Additive: the previous release neither reads nor writes these tables, and Partner.ownerUserId
-- stays as it is. Nothing is dropped or renamed.

-- CreateTable
CREATE TABLE "partner_members" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'manager',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_markups" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "itemKind" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_markups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_audit_events" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "kind" TEXT NOT NULL,
    "tenantId" TEXT,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_members_partnerId_organizationId_key" ON "partner_members"("partnerId", "organizationId");

-- CreateIndex
CREATE INDEX "partner_members_organizationId_idx" ON "partner_members"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_markups_partnerId_itemKind_itemKey_key" ON "partner_markups"("partnerId", "itemKind", "itemKey");

-- CreateIndex
CREATE INDEX "partner_audit_events_partnerId_createdAt_idx" ON "partner_audit_events"("partnerId", "createdAt");

-- AddForeignKey
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_members" ADD CONSTRAINT "partner_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_markups" ADD CONSTRAINT "partner_markups_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_audit_events" ADD CONSTRAINT "partner_audit_events_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing partner is managed by the organization of the account that owns it, or whose
-- credit pays for it: the same organization its credit wallet already lives in.
INSERT INTO "partner_members" ("id", "partnerId", "organizationId", "role")
SELECT gen_random_uuid()::text, p."id", m."organizationId", 'manager'
FROM "partners" p
JOIN LATERAL (
  SELECT "organizationId" FROM "member"
  WHERE "userId" = COALESCE(p."ownerUserId", p."walletOwnerUserId") AND "role" = 'owner'
  ORDER BY "createdAt" ASC
  LIMIT 1
) m ON TRUE
ON CONFLICT ("partnerId", "organizationId") DO NOTHING;

-- The new permission "manage_partner" goes to the default Admin role of every existing space; the
-- previous release ignores keys it does not know.
UPDATE "space_roles"
SET "keys" = array_append("keys", 'manage_partner')
WHERE "systemKey" = 'admin' AND NOT ('manage_partner' = ANY("keys"));

-- System-only, like the other partner tables.
ALTER TABLE "partner_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_members_system ON "partner_members"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "partner_markups" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_markups_system ON "partner_markups"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "partner_audit_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_audit_events_system ON "partner_audit_events"
  USING (current_setting('app.rls_bypass', true) = 'on');
