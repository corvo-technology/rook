-- Read-only database connections and the agents granted them. Additive: the previous release
-- neither reads nor writes these tables.
CREATE TABLE "database_connections" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "database" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "sslMode" TEXT NOT NULL,
  "secretId" TEXT NOT NULL,
  "testedOk" BOOLEAN,
  "testedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "database_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "database_connections_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "database_connections_secretId_fkey" FOREIGN KEY ("secretId")
    REFERENCES "secrets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "database_connections_secretId_key" ON "database_connections"("secretId");
CREATE UNIQUE INDEX "database_connections_spaceId_name_key" ON "database_connections"("spaceId", "name");

CREATE TABLE "bot_database_grants" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_database_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bot_database_grants_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bot_database_grants_botId_fkey" FOREIGN KEY ("botId")
    REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bot_database_grants_connectionId_fkey" FOREIGN KEY ("connectionId")
    REFERENCES "database_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "bot_database_grants_botId_connectionId_key"
  ON "bot_database_grants"("botId", "connectionId");
CREATE INDEX "bot_database_grants_spaceId_botId_idx" ON "bot_database_grants"("spaceId", "botId");

-- Scoped by space like the other tenant tables.
ALTER TABLE "database_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY database_connections_tenant ON "database_connections"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY database_connections_system ON "database_connections"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "database_connections" TO corvo_app;

ALTER TABLE "bot_database_grants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY bot_database_grants_tenant ON "bot_database_grants"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY bot_database_grants_system ON "bot_database_grants"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "bot_database_grants" TO corvo_app;
