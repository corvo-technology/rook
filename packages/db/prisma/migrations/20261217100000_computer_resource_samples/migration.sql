-- Additive: the previous release never reads or writes this table.
CREATE TABLE "computer_resource_samples" (
    "id" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "spaceId" TEXT,
    "organizationId" TEXT,
    "userId" TEXT,
    "runStartedAt" TIMESTAMP(3),
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "cpuSeconds" DOUBLE PRECISION,
    "memoryBytes" BIGINT,
    "diskBytes" BIGINT,
    "networkRxBytes" BIGINT,
    "networkTxBytes" BIGINT,

    CONSTRAINT "computer_resource_samples_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "computer_resource_samples_computerId_sampledAt_key" ON "computer_resource_samples"("computerId", "sampledAt");
CREATE INDEX "computer_resource_samples_organizationId_sampledAt_idx" ON "computer_resource_samples"("organizationId", "sampledAt");

-- Evidence is never rewritten: no foreign keys, and the application can only add rows.
CREATE FUNCTION computer_resource_samples_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Computer resource samples are append-only'; END $$;
CREATE TRIGGER computer_resource_samples_no_update BEFORE UPDATE ON "computer_resource_samples"
  FOR EACH ROW EXECUTE FUNCTION computer_resource_samples_immutable();

-- Written by the worker and read by platform admins, both as the system.
ALTER TABLE "computer_resource_samples" ENABLE ROW LEVEL SECURITY;
CREATE POLICY computer_resource_samples_system ON "computer_resource_samples"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT ON "computer_resource_samples" TO corvo_app;
