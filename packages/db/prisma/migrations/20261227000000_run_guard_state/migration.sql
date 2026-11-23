-- What the run guards counted across attempts. Additive and nullable: the previous release neither
-- reads nor writes it.
ALTER TABLE "runs" ADD COLUMN "guardState" JSONB;
