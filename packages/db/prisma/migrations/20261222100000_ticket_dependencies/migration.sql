-- Additive only: new columns carry defaults and the join table is new, so the previous release keeps working.
ALTER TABLE "tickets" ADD COLUMN "remaining" TEXT;
ALTER TABLE "tickets" ADD COLUMN "continuations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tickets" ADD COLUMN "acceptanceCriteria" TEXT;
ALTER TABLE "tickets" ADD COLUMN "reviewRounds" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ticket_dependencies" (
    "ticketId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_dependencies_pkey" PRIMARY KEY ("ticketId","blockerId")
);

CREATE INDEX "ticket_dependencies_blockerId_idx" ON "ticket_dependencies"("blockerId");

ALTER TABLE "ticket_dependencies" ADD CONSTRAINT "ticket_dependencies_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_dependencies" ADD CONSTRAINT "ticket_dependencies_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
