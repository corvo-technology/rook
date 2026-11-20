-- Computers bought above the plan's own; added with a default so the previous release keeps working.
ALTER TABLE "billing_accounts" ADD COLUMN "extraComputers" INTEGER NOT NULL DEFAULT 0;
