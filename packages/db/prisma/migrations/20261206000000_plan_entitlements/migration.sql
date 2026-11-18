-- Plan entitlements. Additive: the previous release neither reads nor writes any of this.
CREATE TABLE "storage_usage" (
  "organizationId" TEXT NOT NULL,
  "bytes" BIGINT NOT NULL DEFAULT 0,
  "alertedPeriod" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "storage_usage_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "storage_usage_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "storage_objects" (
  "key" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "bytes" BIGINT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "storage_objects_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "storage_objects_organizationId_idx" ON "storage_objects"("organizationId");

ALTER TABLE "computers" ADD COLUMN "sizeApplied" TEXT;
ALTER TABLE "notifications" ADD COLUMN "code" TEXT, ADD COLUMN "params" JSONB;

CREATE TABLE "organization_limit_overrides" (
  "organizationId" TEXT NOT NULL,
  "computerSize" TEXT,
  "computers" INTEGER,
  "storageGb" DOUBLE PRECISION,
  "maxSeats" INTEGER,
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_limit_overrides_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "organization_limit_overrides_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
