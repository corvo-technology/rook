-- Who may talk to an agent, and channels opened to roles. Additive: the previous release neither
-- reads nor writes these columns, and every row keeps today's behavior (everyone may talk to every
-- agent; a channel is the space's unless people are named on it).
ALTER TABLE "bots" ADD COLUMN "audienceRestricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bots" ADD COLUMN "audienceRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "bots" ADD COLUMN "audienceUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "bots" ADD COLUMN "consultable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "chat_groups" ADD COLUMN "accessRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
