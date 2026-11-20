import type { Actor, PlanUsage } from "@corvo/contracts";
import { PLAN_IDS, planConfigFromEnv } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  organizationComputerCount,
  organizationEntitlements,
  organizationForMember,
  organizationSeats,
  storageUsedBytes,
} from "@corvo/db";
import { ORPCError } from "@orpc/server";
import type { BillingService } from "./billing.js";

/**
 * What the actor's organization may have under its plan and what it uses, or null where the
 * deployment has no plans (self-hosted: nothing is limited, so there is nothing to show).
 */
export async function planUsage(
  prisma: PrismaClient,
  actor: Actor,
  billing?: Pick<BillingService, "extraSeatPriceFor" | "extraComputerPriceFor">,
): Promise<PlanUsage | null> {
  const config = planConfigFromEnv();
  if (!config) return null;
  const member = await organizationForMember(prisma, actor);
  if (!member) throw new ORPCError("FORBIDDEN");
  const limits = await organizationEntitlements(prisma, config, member.organizationId);
  if (!limits) return null;
  const extraComputers =
    (
      await prisma.billingAccount.findUnique({
        where: { organizationId: member.organizationId },
        select: { extraComputers: true },
      })
    )?.extraComputers ?? 0;
  const [usedBytes, computers, seats, extra, extraComputer] = await Promise.all([
    storageUsedBytes(prisma, member.organizationId),
    organizationComputerCount(prisma, member.organizationId),
    organizationSeats(prisma, member.organizationId),
    limits.maxSeats > limits.seatsIncluded
      ? billing?.extraSeatPriceFor(member.organizationId, limits.extraSeatPriceId)
      : null,
    billing?.extraComputerPriceFor(member.organizationId, limits.extraComputerPriceId),
  ]);
  const included = config.plans[limits.plan].computers;
  return {
    plan: limits.plan,
    computerSize: limits.computerSize,
    computers: {
      used: computers,
      limit: limits.computers,
      included,
      extra: extraComputers,
      extraPrice: extraComputer
        ? {
            amount: extraComputer.amount,
            currency: extraComputer.currency,
            interval: extraComputer.interval,
          }
        : null,
    },
    storage: { usedBytes, limitBytes: limits.storageBytes },
    seats: {
      used: seats.total,
      included: limits.seatsIncluded,
      max: limits.maxSeats,
      extraPrice: extra
        ? { amount: extra.amount, currency: extra.currency, interval: extra.interval }
        : null,
    },
    // Price ids stay on the server.
    plans: PLAN_IDS.map((id) => {
      const {
        extraSeatPriceId: _seat,
        extraComputerPriceId: _computer,
        ...plan
      } = config.plans[id];
      return plan;
    }),
    canManage: member.isOwner,
  };
}
