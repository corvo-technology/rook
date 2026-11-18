import type { PlanEntitlements } from "@corvo/contracts";
import { PLAN_ERROR_CODES, planConfigFromEnv } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import { organizationEntitlements } from "./plans.js";
import { runAsSystem } from "./row-security.js";

type Db = Pick<
  PrismaClient,
  "member" | "spaceInvitation" | "billingAccount" | "organizationLimitOverride"
>;

export interface SeatUsage {
  /** People who belong to the organization. Agents never count. */
  members: number;
  /** Addresses with a pending invitation to any of its spaces that are not members yet. */
  invited: number;
  /** Each person once, however many spaces they belong to or were invited to. */
  total: number;
  /** Lowercased addresses of everyone counted. */
  people: ReadonlySet<string>;
}

/**
 * The organization's seats: members plus people invited and not yet joined. A person counts once
 * across all its spaces, whether they are a member of several or invited to several.
 */
export async function organizationSeats(
  prisma: Pick<PrismaClient, "member" | "spaceInvitation">,
  organizationId: string,
  now = new Date(),
): Promise<SeatUsage> {
  return runAsSystem("organization seat count for plan limits", async () => {
    const [members, invitations] = await Promise.all([
      prisma.member.findMany({
        where: { organizationId },
        select: { user: { select: { email: true } } },
      }),
      prisma.spaceInvitation.findMany({
        where: {
          space: { organizationId },
          status: "pending",
          expiresAt: { gt: now },
        },
        select: { email: true },
      }),
    ]);
    const joined = new Set(members.map((member) => member.user.email.trim().toLowerCase()));
    const invited = new Set(
      invitations
        .map((row) => row.email.trim().toLowerCase())
        .filter((email) => !joined.has(email)),
    );
    // A one-person organization always has its owner.
    return {
      members: members.length,
      invited: invited.size,
      total: Math.max(1, members.length + invited.size),
      people: new Set([...joined, ...invited]),
    };
  });
}

/** An invitation or join that the plan has no seat for. `plan` tells which plan to upgrade from. */
export class SeatLimitError extends Error {
  readonly code = PLAN_ERROR_CODES.seatLimit;
  constructor(
    readonly maxSeats: number,
    readonly plan: PlanEntitlements["plan"],
  ) {
    super(`Your plan allows ${maxSeats} ${maxSeats === 1 ? "person" : "people"}`);
    this.name = "SeatLimitError";
  }
}

/**
 * Refuses adding `adds` more people when the organization would pass its plan's maximum. Existing
 * members are never touched: after a downgrade the count may sit above the maximum and every new
 * invite is refused until it fits. Does nothing where the deployment has no plans.
 */
export async function assertSeatRoom(
  prisma: Db,
  organizationId: string,
  adds: number,
  options: { converts?: boolean } = {},
): Promise<PlanEntitlements | null> {
  const plans = planConfigFromEnv();
  if (!plans) return null;
  const limits = await organizationEntitlements(prisma, plans, organizationId);
  if (!limits || adds <= 0) return limits;
  const seats = await organizationSeats(prisma, organizationId);
  // Someone who joins on a pending invitation already has a seat in the total.
  const after = options.converts ? seats.members + adds : seats.total + adds;
  if (after > limits.maxSeats) throw new SeatLimitError(limits.maxSeats, limits.plan);
  return limits;
}

/**
 * `assertSeatRoom` for invitations by address: only addresses that hold no seat yet need one, so
 * inviting someone already a member, or already invited to another space, adds nothing.
 */
export async function assertSeatRoomForAddresses(
  prisma: Db,
  organizationId: string,
  addresses: readonly string[],
): Promise<void> {
  if (!planConfigFromEnv()) return;
  const { people } = await organizationSeats(prisma, organizationId);
  const wanted = new Set(addresses.map((address) => address.trim().toLowerCase()));
  await assertSeatRoom(
    prisma,
    organizationId,
    [...wanted].filter((address) => !people.has(address)).length,
  );
}

/** Seats above the plan's included ones, which the extra seat price bills. */
export function extraSeats(limits: Pick<PlanEntitlements, "seatsIncluded">, total: number): number {
  return Math.max(0, total - limits.seatsIncluded);
}
