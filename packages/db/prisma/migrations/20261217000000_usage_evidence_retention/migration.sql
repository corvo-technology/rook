-- Usage evidence outlives the rows it describes. Additive for the previous release: it keeps
-- writing computer runs exactly as before; only the delete side effects (SET NULL) are gone.
ALTER TABLE "computer_runs" DROP CONSTRAINT IF EXISTS "computer_runs_spaceId_fkey";
ALTER TABLE "computer_runs" DROP CONSTRAINT IF EXISTS "computer_runs_userId_fkey";
ALTER TABLE "computer_runs" ADD COLUMN "organizationId" TEXT;

UPDATE "computer_runs" AS r SET "organizationId" = s."organizationId"
FROM "spaces" AS s WHERE s."id" = r."spaceId";

-- Every writer (including the previous release and raw SQL) gets the organization from the space.
CREATE FUNCTION computer_runs_set_organization() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."organizationId" IS NULL AND NEW."spaceId" IS NOT NULL THEN
    SELECT "organizationId" INTO NEW."organizationId" FROM public.spaces WHERE id = NEW."spaceId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER computer_runs_organization BEFORE INSERT ON "computer_runs"
  FOR EACH ROW EXECUTE FUNCTION computer_runs_set_organization();

CREATE INDEX "computer_runs_organizationId_startedAt_idx" ON "computer_runs"("organizationId", "startedAt");
