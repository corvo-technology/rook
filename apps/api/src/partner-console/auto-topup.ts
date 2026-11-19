import type { Actor } from "@corvo/contracts";
import type { AutoTopupDue, PrismaClient } from "@corvo/db";
import {
  claimAutoTopups,
  failAutoTopup,
  MAX_TOPUP_ATTEMPTS,
  partnerWalletOrganization,
  recordPartnerAlert,
  runAsSystem,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { AuditKind } from "./types.js";

/** Everything the runner needs, so the rules are tested without a database or a payment provider. */
export interface AutoTopupDeps {
  now(): Date;
  claim(now: Date): Promise<AutoTopupDue[]>;
  fail(attemptId: string, now: Date): Promise<void>;
  /** Opens Rook's checkout for the top-up; throws when it cannot. */
  start(due: AutoTopupDue): Promise<void>;
  audit(event: {
    partnerId: string;
    kind: AuditKind;
    detail: Record<string, unknown>;
  }): Promise<void>;
  /** Tells the partner's people: a top-up started, or one gave up after its last attempt. */
  alert(event: {
    partnerId: string;
    kind: "partner.autotopup_started" | "partner.autotopup_failed";
    key: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Starts the top-ups owed now: one per time a fund falls under its threshold, retried with a
 * growing delay when billing fails, with an audit event for each start and failure. Returns how
 * many top-ups were started.
 */
export async function runAutoTopups(deps: AutoTopupDeps): Promise<number> {
  const now = deps.now();
  let started = 0;
  for (const due of await deps.claim(now)) {
    try {
      await deps.start(due);
      started += 1;
      await deps.audit({
        partnerId: due.partnerId,
        kind: "credit.autotopup_started",
        detail: { amountMinor: due.amountMinor, attempt: due.attempt },
      });
      await deps.alert({
        partnerId: due.partnerId,
        kind: "partner.autotopup_started",
        key: due.attemptId,
        payload: { amountMinor: due.amountMinor },
      });
    } catch (error) {
      getLogger().error("partner auto top-up failed", error);
      await deps.fail(due.attemptId, now);
      await deps.audit({
        partnerId: due.partnerId,
        kind: "credit.autotopup_failed",
        detail: {
          amountMinor: due.amountMinor,
          attempt: due.attempt,
          final: due.attempt >= MAX_TOPUP_ATTEMPTS,
        },
      });
      // A retry follows on its own; only the last failure needs a person.
      if (due.attempt >= MAX_TOPUP_ATTEMPTS) {
        await deps.alert({
          partnerId: due.partnerId,
          kind: "partner.autotopup_failed",
          key: due.attemptId,
          payload: { amountMinor: due.amountMinor },
        });
      }
    }
  }
  return started;
}

/** The billing path a top-up goes through; the partner's own account is the one charged. */
export interface TopupBilling {
  purchaseCredits(
    actor: Actor,
    input: { amountCents: number; monthly: boolean },
  ): Promise<{ url: string }>;
}

/**
 * The production wiring: claims from the database and starts the top-up through the same billing
 * call the console's top-up uses, as the person whose account holds the partner's fund. A
 * deployment with no billing has no runner, so nothing is claimed and nothing is attempted.
 */
export function createAutoTopupRunner(prisma: PrismaClient, billing: TopupBilling) {
  const system = <T>(fn: () => Promise<T>) => runAsSystem("partner auto top-up", fn);
  return () =>
    runAutoTopups({
      now: () => new Date(),
      claim: (now) => system(() => claimAutoTopups(prisma, now)),
      fail: (id, now) => system(() => failAutoTopup(prisma, id, now)),
      start: async (due) => {
        const actor = await system(async () => {
          const organizationId = await partnerWalletOrganization(prisma, due.partnerId);
          if (!organizationId) throw new Error("The partner has no fund to top up");
          const [owner, space] = await Promise.all([
            prisma.member.findFirst({
              where: { organizationId, role: "owner" },
              orderBy: { createdAt: "asc" },
              select: { user: { select: { id: true, email: true } } },
            }),
            prisma.space.findFirst({
              where: { organizationId },
              orderBy: { createdAt: "asc" },
              select: { id: true },
            }),
          ]);
          if (!owner || !space) throw new Error("The partner's account cannot be charged");
          return {
            userId: owner.user.id,
            spaceId: space.id,
            email: owner.user.email,
            isDeploymentOwner: false,
          } satisfies Actor;
        });
        await billing.purchaseCredits(actor, { amountCents: due.amountMinor, monthly: false });
      },
      alert: (event) =>
        system(async () => {
          await recordPartnerAlert(prisma, event.partnerId, { ...event, externalTenantId: "" });
        }),
      audit: (event) =>
        system(async () => {
          await prisma.partnerAuditEvent.create({
            data: { ...event, actorUserId: null, detail: event.detail as never },
          });
        }),
    });
}
