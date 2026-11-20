-- Additive: the previous release neither reads nor writes these tables.
-- CreateTable
CREATE TABLE "research_jobs" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "operationKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "scope" TEXT,
    "depth" TEXT NOT NULL DEFAULT 'quick',
    "queryKey" TEXT NOT NULL,
    "watch" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'running',
    "stopReason" TEXT,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "maxSteps" INTEGER NOT NULL,
    "maxTokens" INTEGER NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "report" TEXT,
    "changed" BOOLEAN,
    "error" TEXT,
    "previousId" TEXT,
    "wakeDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_sources" (
    "id" TEXT NOT NULL,
    "researchId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excerpt" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "research_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_jobs_operationKey_key" ON "research_jobs"("operationKey");
CREATE INDEX "research_jobs_spaceId_botId_queryKey_status_idx" ON "research_jobs"("spaceId", "botId", "queryKey", "status");
CREATE INDEX "research_jobs_spaceId_userId_id_idx" ON "research_jobs"("spaceId", "userId", "id");
CREATE UNIQUE INDEX "research_sources_researchId_url_key" ON "research_sources"("researchId", "url");
CREATE INDEX "research_sources_spaceId_researchId_idx" ON "research_sources"("spaceId", "researchId");

-- AddForeignKey
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same policies as wiki_imports: any member of the Space reaches its rows.
ALTER TABLE "research_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_jobs_tenant ON "research_jobs"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY research_jobs_system ON "research_jobs"
  USING (current_setting('app.rls_bypass', true) = 'on');
ALTER TABLE "research_sources" ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_sources_tenant ON "research_sources"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY research_sources_system ON "research_sources"
  USING (current_setting('app.rls_bypass', true) = 'on');
