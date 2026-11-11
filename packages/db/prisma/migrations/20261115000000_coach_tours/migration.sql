CREATE TABLE "coach_tours" (
    "userId" TEXT NOT NULL,
    "done" TEXT[] NOT NULL DEFAULT '{}',
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coach_tours_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "coach_tours" ADD CONSTRAINT "coach_tours_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only accounts created from here on get the tour; existing users count as skipped.
INSERT INTO "coach_tours" ("userId", "skipped") SELECT "id", true FROM "user";
