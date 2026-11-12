-- Additive: the previous release neither reads nor writes this column.
ALTER TABLE "runs" ADD COLUMN "ticketId" TEXT;
