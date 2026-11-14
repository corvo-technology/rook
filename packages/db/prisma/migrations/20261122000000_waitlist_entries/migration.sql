-- Additive: the previous release neither reads nor writes this table.
-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "task" TEXT,
    "locale" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_email_key" ON "waitlist_entries"("email");

-- Internal data: only server code that runs as the system reads or writes it.
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY waitlist_entries_system ON "waitlist_entries"
  USING (current_setting('app.rls_bypass', true) = 'on');
