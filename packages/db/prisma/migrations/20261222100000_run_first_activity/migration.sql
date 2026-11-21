-- When the run first showed activity, before any reply text; nullable so the previous release keeps working.
ALTER TABLE "runs" ADD COLUMN "firstActivityAt" TIMESTAMP(3);
