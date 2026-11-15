-- Agent mailboxes: email accounts an agent reads and sends from. Additive: the previous release
-- neither reads nor writes these tables.
CREATE TABLE "mailboxes" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'imap',
  "config" JSONB NOT NULL DEFAULT '{}',
  "secretId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailboxes_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "mailboxes_spaceId_userId_idx" ON "mailboxes"("spaceId", "userId");

CREATE TABLE "bot_mailboxes" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_mailboxes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bot_mailboxes_spaceId_fkey" FOREIGN KEY ("spaceId")
    REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bot_mailboxes_botId_fkey" FOREIGN KEY ("botId")
    REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bot_mailboxes_mailboxId_fkey" FOREIGN KEY ("mailboxId")
    REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "bot_mailboxes_botId_mailboxId_key" ON "bot_mailboxes"("botId", "mailboxId");
CREATE INDEX "bot_mailboxes_mailboxId_idx" ON "bot_mailboxes"("mailboxId");

CREATE TABLE "mailbox_sends" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  "botId" TEXT,
  "executionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mailbox_sends_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mailbox_sends_mailboxId_fkey" FOREIGN KEY ("mailboxId")
    REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mailbox_sends_mailboxId_executionId_key"
  ON "mailbox_sends"("mailboxId", "executionId");
CREATE INDEX "mailbox_sends_mailboxId_botId_createdAt_idx"
  ON "mailbox_sends"("mailboxId", "botId", "createdAt");

-- Scoped by space like the other tenant tables; ownership is checked in the queries.
DO $$
DECLARE
  protected text;
BEGIN
  FOREACH protected IN ARRAY ARRAY['mailboxes', 'bot_mailboxes', 'mailbox_sends'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', protected);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("spaceId" = NULLIF(current_setting(''app.space_id'', true), ''''))',
      protected || '_tenant', protected);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (current_setting(''app.rls_bypass'', true) = ''on'')',
      protected || '_system', protected);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO corvo_app', protected);
  END LOOP;
END $$;
