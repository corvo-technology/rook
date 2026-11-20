-- Additive: the previous release never reads or writes this table.
CREATE TABLE "action_evidence" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "organizationId" TEXT,
    "botId" TEXT NOT NULL,
    "computerId" TEXT,
    "runId" TEXT,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "executionId" TEXT,
    "detail" TEXT,
    "cwd" TEXT,
    "status" TEXT,
    "exitCode" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "action_evidence_organizationId_occurredAt_idx" ON "action_evidence"("organizationId", "occurredAt");

-- Evidence is never rewritten: no foreign keys, and the application can only add rows.
CREATE FUNCTION action_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Action evidence is append-only'; END $$;
CREATE TRIGGER action_evidence_no_update BEFORE UPDATE ON "action_evidence"
  FOR EACH ROW EXECUTE FUNCTION action_evidence_immutable();

ALTER TABLE "action_evidence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY action_evidence_system ON "action_evidence"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT ON "action_evidence" TO corvo_app;
