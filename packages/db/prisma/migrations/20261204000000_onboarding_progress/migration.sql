-- First-run progress per person. Additive: the previous release neither reads nor writes it.
CREATE TABLE "onboarding_progress" (
  "userId" TEXT NOT NULL,
  "done" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "onboarding_progress_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
