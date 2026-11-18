-- Run error code and params. Additive: the previous release neither reads nor writes this column.
ALTER TABLE "runs" ADD COLUMN "errorInfo" JSONB;
