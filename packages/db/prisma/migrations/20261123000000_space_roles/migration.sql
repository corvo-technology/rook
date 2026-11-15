-- Roles that add up. A space defines roles with keys; a member holds any number and may do what
-- any of them allows, on top of the base role "everyone" that every member holds. Additive: the
-- previous release neither reads nor writes these tables or the new invitation column, and
-- space_members.role keeps meaning owner / admin / member, so the two releases agree during a
-- deploy.

CREATE TABLE "space_roles" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "position" INTEGER NOT NULL,
  "keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "systemKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "space_roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "space_roles_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "space_roles_spaceId_systemKey_key" ON "space_roles"("spaceId", "systemKey");
CREATE INDEX "space_roles_spaceId_position_idx" ON "space_roles"("spaceId", "position");

CREATE TABLE "space_member_roles" (
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "space_member_roles_pkey" PRIMARY KEY ("spaceId", "userId", "roleId"),
  CONSTRAINT "space_member_roles_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId")
    REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "space_member_roles_roleId_fkey" FOREIGN KEY ("roleId")
    REFERENCES "space_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "space_member_roles_roleId_idx" ON "space_member_roles"("roleId");

ALTER TABLE "space_invitations" ADD COLUMN "roleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Authorization is checked by the API; the policies keep every query inside the Space it was
-- made for.
ALTER TABLE "space_roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY space_roles_tenant ON "space_roles"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY space_roles_system ON "space_roles"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "space_roles" TO corvo_app;

ALTER TABLE "space_member_roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY space_member_roles_tenant ON "space_member_roles"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY space_member_roles_system ON "space_member_roles"
  USING (current_setting('app.rls_bypass', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "space_member_roles" TO corvo_app;

-- Every existing space starts with the two default roles. "everyone" holds what a member could do
-- before; "Admin" what an admin could do before plus the keys that did not exist yet, except
-- billing and creating spaces, which stay with the owner.
INSERT INTO "space_roles" ("id", "spaceId", "name", "position", "keys", "systemKey", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Everyone', 2147483647,
  ARRAY['post', 'create_channels', 'talk_to_agents', 'assign_work', 'create_agents',
        'edit_wiki', 'upload_files', 'use_computers'],
  'everyone', CURRENT_TIMESTAMP
FROM "spaces";

INSERT INTO "space_roles" ("id", "spaceId", "name", "position", "keys", "systemKey", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'Admin', 0,
  ARRAY['post', 'create_channels', 'manage_channels', 'talk_to_agents', 'assign_work',
        'manage_routines', 'approve_actions', 'create_agents', 'manage_agents', 'use_computers',
        'control_computers', 'manage_connections', 'manage_credentials', 'edit_wiki',
        'upload_files', 'review_memory', 'invite_people', 'view_usage', 'configure',
        'manage_members', 'manage_roles'],
  'admin', CURRENT_TIMESTAMP
FROM "spaces";

-- Existing admins hold "Admin". Their space_members.role stays "admin" for the previous release.
INSERT INTO "space_member_roles" ("spaceId", "userId", "roleId")
SELECT m."spaceId", m."userId", r."id"
FROM "space_members" m
JOIN "space_roles" r ON r."spaceId" = m."spaceId" AND r."systemKey" = 'admin'
WHERE m."role" = 'admin';
