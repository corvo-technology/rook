-- How far an agent may use a connection: read or write. Additive: the previous release neither
-- reads nor writes these columns, and every existing grant keeps its full access ("write").
ALTER TABLE "bot_mcp_servers" ADD COLUMN "level" TEXT NOT NULL DEFAULT 'write';
ALTER TABLE "bot_mailboxes" ADD COLUMN "level" TEXT NOT NULL DEFAULT 'write';
