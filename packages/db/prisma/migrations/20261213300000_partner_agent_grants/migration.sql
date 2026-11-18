-- Which agents may work their organization's partner portfolio, and how far. Additive: a new
-- table the previous release never reads.
CREATE TABLE "bot_partner_grants" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'read',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_partner_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bot_partner_grants_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bot_partner_grants_botId_fkey" FOREIGN KEY ("botId")
    REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "bot_partner_grants_botId_key" ON "bot_partner_grants"("botId");
CREATE INDEX "bot_partner_grants_spaceId_idx" ON "bot_partner_grants"("spaceId");

ALTER TABLE "bot_partner_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bot_partner_grants_tenant" ON "bot_partner_grants"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY "bot_partner_grants_system" ON "bot_partner_grants"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "bot_partner_grants" TO corvo_app;
