-- Additive only. The previous release keeps working: it still writes bot_secrets rows with a botId
-- and reads them by botId, and the new column has a default. It never touches the new tables.

-- A credential added from the Vault is not bound to one agent.
ALTER TABLE "bot_secrets" ALTER COLUMN "botId" DROP NOT NULL;
ALTER TABLE "bot_secrets" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'personal';

-- Credentials saved before the Vault were usable by every run of their agent. "space" keeps that
-- exactly; only credentials saved from now on are personal by default.
UPDATE "bot_secrets" SET "scope" = 'space';

CREATE TABLE "bot_secret_grants" (
  "id" TEXT NOT NULL,
  "secretId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_secret_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_secret_grants_secretId_botId_key" ON "bot_secret_grants"("secretId", "botId");
CREATE INDEX "bot_secret_grants_botId_idx" ON "bot_secret_grants"("botId");
CREATE INDEX "bot_secret_grants_spaceId_idx" ON "bot_secret_grants"("spaceId");
ALTER TABLE "bot_secret_grants" ADD CONSTRAINT "bot_secret_grants_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "bot_secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_secret_grants" ADD CONSTRAINT "bot_secret_grants_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_secret_grants" ADD CONSTRAINT "bot_secret_grants_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bot_secret_uses" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "secretId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "botId" TEXT,
  "runId" TEXT,
  "forUserId" TEXT,
  "destination" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_secret_uses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bot_secret_uses_secretId_createdAt_idx" ON "bot_secret_uses"("secretId", "createdAt");
CREATE INDEX "bot_secret_uses_spaceId_idx" ON "bot_secret_uses"("spaceId");
ALTER TABLE "bot_secret_uses" ADD CONSTRAINT "bot_secret_uses_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_secret_uses" ADD CONSTRAINT "bot_secret_uses_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "bot_secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_secret_uses" ADD CONSTRAINT "bot_secret_uses_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bot_secret_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_secret_grants_tenant ON "bot_secret_grants"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY bot_secret_grants_system ON "bot_secret_grants"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "bot_secret_uses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_secret_uses_tenant ON "bot_secret_uses"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY bot_secret_uses_system ON "bot_secret_uses"
  USING (current_setting('app.rls_bypass', true) = 'on');
