-- Agents pick a model tier for each turn unless a model is pinned. Only the default of the column
-- changes, so the previous release, which always sets the value when it inserts, keeps working.
ALTER TABLE "bots" ALTER COLUMN "modelAuto" SET DEFAULT true;

-- Existing agents with no pinned model join them. A pinned model always wins, so those rows are not
-- touched, and running this again changes nothing.
UPDATE "bots"
SET "modelAuto" = true
WHERE "modelAuto" = false
  AND "modelProvider" IS NULL
  AND "modelId" IS NULL;
