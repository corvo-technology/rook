-- Additive: the previous release neither reads nor writes these columns; existing rows are pending.
ALTER TABLE "waitlist_entries"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decidedByUserId" TEXT,
  ADD COLUMN "invitationId" TEXT;

ALTER TABLE "partner_leads"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "decidedByUserId" TEXT,
  ADD COLUMN "declineReason" TEXT,
  ADD COLUMN "partnerId" TEXT;

ALTER TABLE "partners" ADD COLUMN "planKey" TEXT;

-- A pricing version applies from `effectiveAt`; versions written before this existed started when
-- they were created.
ALTER TABLE "partner_pricing_versions" ADD COLUMN "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "partner_pricing_versions" SET "effectiveAt" = "createdAt";
