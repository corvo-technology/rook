-- Additive: the previous release neither reads nor writes these columns and keeps treating a row
-- with neither flag set as asking. A row with none set is Only what's risky in this release.
ALTER TABLE "action_auto_review_preferences" ADD COLUMN "alwaysAsk" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_action_auto_review_preferences" ADD COLUMN "alwaysAsk" BOOLEAN NOT NULL DEFAULT false;
