-- Onboarding answers. Additive: the previous release neither reads nor writes these columns.
ALTER TABLE "onboarding_progress" ADD COLUMN "answers" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "spaces" ADD COLUMN "logo" TEXT;
ALTER TABLE "space_members" ADD COLUMN "areas" TEXT[] DEFAULT ARRAY[]::TEXT[];
