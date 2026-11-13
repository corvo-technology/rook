-- A Space's owner can lend the models they connected to the Space's members, and set a monthly
-- token limit per member. Additive: the previous release neither reads nor writes these tables.

CREATE TABLE "space_model_connections" (
  "spaceId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "space_model_connections_pkey" PRIMARY KEY ("spaceId"),
  CONSTRAINT "space_model_connections_spaceId_ownerUserId_fkey" FOREIGN KEY ("spaceId", "ownerUserId")
    REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "space_member_model_settings" (
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "useOwnModel" BOOLEAN NOT NULL DEFAULT false,
  "monthlyTokenLimit" BIGINT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "space_member_model_settings_pkey" PRIMARY KEY ("spaceId", "userId"),
  CONSTRAINT "space_member_model_settings_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId")
    REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Authorization (owner-only writes, a member reads their own row) is checked by the API; the
-- policies keep every query inside the Space it was made for.
ALTER TABLE "space_model_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY space_model_connections_tenant ON "space_model_connections"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY space_model_connections_system ON "space_model_connections"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "space_model_connections" TO corvo_app;

ALTER TABLE "space_member_model_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY space_member_model_settings_tenant ON "space_member_model_settings"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY space_member_model_settings_system ON "space_member_model_settings"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "space_member_model_settings" TO corvo_app;
