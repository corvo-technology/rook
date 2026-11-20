-- Additive: the previous release neither reads nor writes these columns or this table. A null
-- money cap is no limit, and classifyTools false keeps today's asking for unknown tool names.
ALTER TABLE "bots" ADD COLUMN "moneyCapPerCall" DOUBLE PRECISION;
ALTER TABLE "bots" ADD COLUMN "moneyCapPerMonth" DOUBLE PRECISION;
ALTER TABLE "action_auto_review_preferences" ADD COLUMN "classifyTools" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_action_auto_review_preferences" ADD COLUMN "classifyTools" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "tool_classifications" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "connection" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "descriptionHash" TEXT NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_classifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tool_classifications_key" ON "tool_classifications"("spaceId", "connection", "toolName", "descriptionHash", "rubricVersion");
CREATE INDEX "tool_classifications_spaceId_connection_idx" ON "tool_classifications"("spaceId", "connection");
ALTER TABLE "tool_classifications" ADD CONSTRAINT "tool_classifications_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
