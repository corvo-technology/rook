-- Additive: the previous release neither reads nor writes this column; a null means 30 days from creation.
ALTER TABLE "space_invite_links" ADD COLUMN "expiresAt" TIMESTAMP(3);
