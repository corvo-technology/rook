-- What happened to each action agreed in a consultation. Additive: the previous release neither
-- reads nor writes this table.
CREATE TABLE "consultation_action_runs" (
    "consultationId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_action_runs_pkey" PRIMARY KEY ("consultationId", "actionId")
);

ALTER TABLE "consultation_action_runs" ADD CONSTRAINT "consultation_action_runs_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Health data: only server code that runs as the system reads or writes these rows.
ALTER TABLE "consultation_action_runs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY consultation_action_runs_system ON "consultation_action_runs"
  USING (current_setting('app.rls_bypass', true) = 'on');
