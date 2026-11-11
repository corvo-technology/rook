import type { TourMark } from "@corvo/contracts";
import type { PrismaClient } from "./generated/prisma/client.js";

/** Records a mark as done. Safe to repeat and to run in parallel: a mark is stored once. */
export async function markTourDone(
  prisma: PrismaClient,
  userId: string,
  mark: TourMark,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "coach_tours" ("userId", "done")
    VALUES (${userId}, ARRAY[${mark}]::TEXT[])
    ON CONFLICT ("userId") DO UPDATE
    SET "done" = array_append("coach_tours"."done", ${mark})
    WHERE NOT (${mark} = ANY("coach_tours"."done"))`;
}

/** Ends the tour for good. Keeps the marks already done. */
export async function skipTour(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "coach_tours" ("userId", "skipped")
    VALUES (${userId}, true)
    ON CONFLICT ("userId") DO UPDATE SET "skipped" = true`;
}
