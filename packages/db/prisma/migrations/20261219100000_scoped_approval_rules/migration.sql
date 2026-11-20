-- Additive: the previous release neither reads nor writes these columns. A kept always-allow is a
-- row of kind "agent_tool", which the previous release's rule matching ignores, so it can never
-- read one as a rule for every agent.
ALTER TABLE "action_approval_rules" ADD COLUMN "botId" TEXT;
ALTER TABLE "action_approval_rules" ADD COLUMN "connectionKey" TEXT;
ALTER TABLE "action_approval_rules" ADD COLUMN "toolName" TEXT;
CREATE INDEX "action_approval_rules_botId_idx" ON "action_approval_rules"("botId");
ALTER TABLE "action_approval_rules" ADD CONSTRAINT "action_approval_rules_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "external_effects" ADD COLUMN "callHash" TEXT;
ALTER TABLE "external_effects" ADD COLUMN "alwaysScope" JSONB;
ALTER TABLE "external_effects" ADD COLUMN "approvalRuleId" TEXT;
