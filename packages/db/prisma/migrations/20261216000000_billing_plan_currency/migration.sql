-- Which catalog price a subscription is on, and the currency and interval it is billed in.
-- Columns only, all nullable: the previous release never reads or writes them, and existing
-- subscriptions keep resolving by their price id.
ALTER TABLE "billing_accounts" ADD COLUMN "priceLookupKey" TEXT;
ALTER TABLE "billing_accounts" ADD COLUMN "currency" TEXT;
ALTER TABLE "billing_accounts" ADD COLUMN "interval" TEXT;
