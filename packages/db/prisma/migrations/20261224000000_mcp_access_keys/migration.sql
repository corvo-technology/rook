-- Additive: the previous release neither reads nor writes this table.
-- CreateTable
CREATE TABLE "mcp_access_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "spaceId" TEXT,
    "secretHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "mcp_access_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_access_keys_secretHash_key" ON "mcp_access_keys"("secretHash");
CREATE INDEX "mcp_access_keys_userId_createdAt_idx" ON "mcp_access_keys"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "mcp_access_keys" ADD CONSTRAINT "mcp_access_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_access_keys" ADD CONSTRAINT "mcp_access_keys_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A key belongs to its owner alone, whichever space they are working in. The server finds a key by
-- its digest before it knows whose it is, which is a named system bypass.
ALTER TABLE "mcp_access_keys" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcp_access_keys_tenant ON "mcp_access_keys"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY mcp_access_keys_system ON "mcp_access_keys"
  USING (current_setting('app.rls_bypass', true) = 'on');
