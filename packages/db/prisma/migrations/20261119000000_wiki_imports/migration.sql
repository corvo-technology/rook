-- Additive: the previous release neither reads nor writes this table.
-- CreateTable
CREATE TABLE "wiki_imports" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'reading',
    "parts" INTEGER NOT NULL DEFAULT 0,
    "readParts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wiki_imports_spaceId_state_idx" ON "wiki_imports"("spaceId", "state");

-- AddForeignKey
ALTER TABLE "wiki_imports" ADD CONSTRAINT "wiki_imports_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same policies as wiki_changes: any member of the Space reaches its wiki rows.
ALTER TABLE "wiki_imports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiki_imports_tenant ON "wiki_imports"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY wiki_imports_system ON "wiki_imports"
  USING (current_setting('app.rls_bypass', true) = 'on');
