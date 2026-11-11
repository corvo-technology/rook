-- A bot's own approval mode (never, auto, ask); null follows the member's default.
ALTER TABLE "bots" ADD COLUMN IF NOT EXISTS "approvalMode" TEXT;
