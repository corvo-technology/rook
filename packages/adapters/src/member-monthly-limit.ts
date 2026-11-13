import { monthlyCeiling, replyCap, utcMonthStart } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { memberTokensSince, modelScope } from "@corvo/db";

/**
 * Whether a member may start a run on the models the owner lent to the Space. Each run in flight
 * may still spend its share of the limit (the reply cap), so runs that start together cannot
 * all pass on the same unspent tokens. Own connections, the owner, and no limit pass untouched.
 */
export async function memberMonthlyLimitReached(
  prisma: PrismaClient,
  run: { id: string; userId: string; spaceId: string },
  now = new Date(),
): Promise<boolean> {
  const lent = await modelScope(prisma, run);
  if (!lent.delegated) return false;
  const setting = await prisma.spaceMemberModelSetting.findUnique({
    where: { spaceId_userId: { spaceId: run.spaceId, userId: run.userId } },
    select: { monthlyTokenLimit: true },
  });
  const limit = monthlyCeiling(
    setting?.monthlyTokenLimit == null ? null : Number(setting.monthlyTokenLimit),
  );
  if (!Number.isFinite(limit)) return false;
  const [used, inFlight] = await Promise.all([
    memberTokensSince(prisma, run, utcMonthStart(now)),
    prisma.run.count({
      where: {
        spaceId: run.spaceId,
        userId: run.userId,
        status: "running",
        id: { not: run.id },
      },
    }),
  ]);
  return used + inFlight * replyCap(limit) >= limit;
}
