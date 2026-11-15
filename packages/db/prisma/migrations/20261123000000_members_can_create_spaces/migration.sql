-- Only the owner of an organization decides whether its members may create spaces; off by default.
-- Additive: the previous release neither reads nor writes the column.
ALTER TABLE "organization" ADD COLUMN "membersCanCreateSpaces" BOOLEAN NOT NULL DEFAULT false;
