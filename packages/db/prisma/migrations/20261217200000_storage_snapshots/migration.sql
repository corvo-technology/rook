-- Additive: the previous release never reads or writes this table.
CREATE TABLE "storage_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storage_snapshots_organizationId_day_key" ON "storage_snapshots"("organizationId", "day");

-- Evidence is never rewritten: no foreign keys, and the application can only add rows.
CREATE FUNCTION storage_snapshots_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Storage snapshots are append-only'; END $$;
CREATE TRIGGER storage_snapshots_no_update BEFORE UPDATE ON "storage_snapshots"
  FOR EACH ROW EXECUTE FUNCTION storage_snapshots_immutable();

ALTER TABLE "storage_snapshots" ENABLE ROW LEVEL SECURITY;
CREATE POLICY storage_snapshots_system ON "storage_snapshots"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT ON "storage_snapshots" TO corvo_app;
