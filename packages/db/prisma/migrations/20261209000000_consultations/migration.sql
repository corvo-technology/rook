-- Per-partner default for how long a consultation's audio and transcript are kept.
ALTER TABLE "partners" ADD COLUMN "scribeRetentionDays" INTEGER;

-- CreateTable
CREATE TABLE "consultations" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "consent" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'recording',
    "retentionDays" INTEGER NOT NULL,
    "resultArtifactId" TEXT,
    "draftEntryId" TEXT,
    "errorCode" TEXT,
    "purgedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_chunks" (
    "consultationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "artifactId" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_chunks_pkey" PRIMARY KEY ("consultationId", "seq")
);

-- CreateIndex
CREATE INDEX "consultations_tenantId_idx" ON "consultations"("tenantId");

-- CreateIndex
CREATE INDEX "consultations_state_createdAt_idx" ON "consultations"("state", "createdAt");

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "partner_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_chunks" ADD CONSTRAINT "consultation_chunks_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "consultations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Health data: only server code that runs as the system reads or writes these rows, never a
-- request in a customer's context.
ALTER TABLE "consultations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY consultations_system ON "consultations"
  USING (current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "consultation_chunks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY consultation_chunks_system ON "consultation_chunks"
  USING (current_setting('app.rls_bypass', true) = 'on');
