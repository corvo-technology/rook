-- A direct conversation between two people has no agent, channel or external conversation, so
-- its thread owns none of them. Loosening a check cannot break the previous release, which
-- never writes such a thread.
ALTER TABLE "threads" DROP CONSTRAINT "threads_owner_chk";
ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_chk" CHECK (
  num_nonnulls("botId", "groupId", "externalConversationId") <= 1
) NOT VALID;
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_owner_chk";
