-- Additive only: nullable, no default, so existing tickets stay out of the sweep and the
-- previous release (which neither reads nor writes it) keeps working.
ALTER TABLE "tickets" ADD COLUMN "sweepEligibleAt" TIMESTAMP(3);
