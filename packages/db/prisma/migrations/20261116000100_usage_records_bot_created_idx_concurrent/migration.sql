-- Sole statement so CREATE INDEX CONCURRENTLY runs outside an implicit
-- transaction. Serves a bot's token sum over a month.
CREATE INDEX CONCURRENTLY "usage_records_bot_created_idx" ON "usage_records" ("botId", "createdAt");
