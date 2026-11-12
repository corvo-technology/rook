-- Thread lookups read one root's replies on active threads, so build the index without blocking writes.
CREATE INDEX CONCURRENTLY "messages_threadRootId_idx"
ON "messages"("threadRootId");
