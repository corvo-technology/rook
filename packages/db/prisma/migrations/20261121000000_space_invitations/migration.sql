-- Additive: the previous release neither reads nor writes these tables.
-- CreateTable
CREATE TABLE "space_invitations" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inviterId" TEXT NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_invite_links" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "space_invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_join_requests" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "space_invitations_spaceId_status_idx" ON "space_invitations"("spaceId", "status");

-- CreateIndex
CREATE INDEX "space_invitations_email_status_idx" ON "space_invitations"("email", "status");

-- CreateIndex
CREATE INDEX "space_invite_links_spaceId_revokedAt_idx" ON "space_invite_links"("spaceId", "revokedAt");

-- CreateIndex
CREATE INDEX "space_join_requests_spaceId_status_idx" ON "space_join_requests"("spaceId", "status");

-- CreateIndex
CREATE INDEX "space_join_requests_userId_status_idx" ON "space_join_requests"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "space_join_requests_spaceId_userId_key" ON "space_join_requests"("spaceId", "userId");

-- AddForeignKey
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_invitations" ADD CONSTRAINT "space_invitations_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_invite_links" ADD CONSTRAINT "space_invite_links_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_invite_links" ADD CONSTRAINT "space_invite_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_join_requests" ADD CONSTRAINT "space_join_requests_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_join_requests" ADD CONSTRAINT "space_join_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Members of the Space read and manage these rows. A person who is not a member yet reaches them
-- only through the audited system context, after the server has checked the link token.
ALTER TABLE "space_invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY space_invitations_tenant ON "space_invitations"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY space_invitations_system ON "space_invitations"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "space_invite_links" ENABLE ROW LEVEL SECURITY;
CREATE POLICY space_invite_links_tenant ON "space_invite_links"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY space_invite_links_system ON "space_invite_links"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "space_join_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY space_join_requests_tenant ON "space_join_requests"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY space_join_requests_system ON "space_join_requests"
  USING (current_setting('app.rls_bypass', true) = 'on');
