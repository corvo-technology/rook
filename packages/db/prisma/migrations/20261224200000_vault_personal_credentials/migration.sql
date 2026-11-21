-- Data only: no table or column changes, so the previous release keeps working beside it.
--
-- The vault migration (20261224100000_vault) marked every credential that existed before it as
-- team-wide ("space"), because before the Vault every run of an agent could use that agent's
-- credentials. That over-shared the ones a member saved for themselves.
--
-- Before the Vault a credential's userId was who saved it, and it differed from the agent owner's
-- only for a credential a member saved themselves from a chat card. Settings saved by the owner or
-- by someone with manage_connections were always stored under the agent owner, so those stay team
-- credentials. A credential saved by another member goes back to personal: only runs for that
-- member can use it. It keeps its agent (botId), so that member's runs keep working.
--
-- Only rows created before the vault migration finished are touched; credentials created as team
-- afterwards are untouched. If the vault migration is not recorded, nothing changes.
UPDATE "bot_secrets" AS s
SET "scope" = 'personal'
FROM "bots" AS b
WHERE b."id" = s."botId"
  AND s."scope" = 'space'
  AND s."userId" <> b."userId"
  AND (s."createdAt" AT TIME ZONE 'UTC') < (
    SELECT m."finished_at"
    FROM "_prisma_migrations" AS m
    WHERE m."migration_name" = '20261224100000_vault' AND m."finished_at" IS NOT NULL
  );
