-- Additive only: the previous release neither reads nor writes this table.
CREATE TABLE "run_tool_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "totalChars" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_tool_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "run_tool_results_runId_toolCallId_key" ON "run_tool_results"("runId", "toolCallId");
CREATE INDEX "run_tool_results_spaceId_idx" ON "run_tool_results"("spaceId");

ALTER TABLE "run_tool_results" ADD CONSTRAINT "run_tool_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "run_tool_results" ADD CONSTRAINT "run_tool_results_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "run_tool_results" ENABLE ROW LEVEL SECURITY;
CREATE POLICY run_tool_results_tenant ON "run_tool_results"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY run_tool_results_system ON "run_tool_results"
  USING (current_setting('app.rls_bypass', true) = 'on');
