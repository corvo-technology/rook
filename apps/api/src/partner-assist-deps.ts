import type { PrismaClient } from "@corvo/db";
import {
  CHIEF_SPAWN_KEY,
  isPartnerTestOrganization,
  partnerSpaceState,
  recordSecurityEvent,
  runAsTenant,
  spaceHasModelAccess,
} from "@corvo/db";
import type { PartnerAssistDeps } from "./partner-assist.js";
import { runSideModel, type SideModelDeps } from "./side-model.js";

/** Who a signed-in embed session is: the partner and the customer it belongs to, if still enabled. */
export function embedSessionCaller(deps: {
  prisma: PrismaClient;
  session(request: Request): Promise<{ actor: { spaceId: string; userId: string } } | null>;
}): (request: Request) => Promise<{
  partner: { id: string; template?: unknown; scribeRetentionDays?: number | null };
  tenant: { id: string; organizationId: string; state: string };
} | null> {
  return async (request) => {
    const session = await deps.session(request);
    if (!session) return null;
    const tenant = await deps.prisma.partnerTenant.findUnique({
      where: { organizationId: session.actor.spaceId },
      include: { partner: { select: { id: true, template: true, scribeRetentionDays: true } } },
    });
    // Only the customer's own session counts, and only while the customer is in good standing.
    if (!tenant || tenant.ownerUserId !== session.actor.userId || tenant.state !== "enabled") {
      return null;
    }
    if ((await partnerSpaceState(deps.prisma, tenant.organizationId)) !== "enabled") return null;
    return {
      partner: tenant.partner,
      tenant: { id: tenant.id, organizationId: tenant.organizationId, state: tenant.state },
    };
  };
}

/**
 * The model call behind `ask`: the customer's Chief lends its owner, space and model routing, so the
 * run is metered against the customer's credit exactly like any other. `side` carries the strong
 * tier as its first choice, since the answers fill a professional's record.
 */
export function partnerAssistDeps(
  deps: {
    prisma: PrismaClient;
    side: SideModelDeps;
  } & Pick<PartnerAssistDeps, "allowRequest" | "authenticate" | "findTenant" | "session">,
): PartnerAssistDeps {
  const { prisma, side } = deps;
  return {
    allowRequest: deps.allowRequest,
    authenticate: deps.authenticate,
    findTenant: deps.findTenant,
    session: deps.session,
    hasAccess: async (organizationId) =>
      (await partnerSpaceState(prisma, organizationId)) === "enabled",
    hasCredit: async (organizationId) =>
      (await isPartnerTestOrganization(prisma, organizationId)) ||
      spaceHasModelAccess(prisma, organizationId),
    complete: async (call) => {
      const bot =
        (await prisma.bot.findFirst({
          where: { spaceId: call.organizationId, spawnKey: CHIEF_SPAWN_KEY },
        })) ??
        (await prisma.bot.findFirst({
          where: { spaceId: call.organizationId },
          orderBy: { createdAt: "asc" },
        }));
      if (!bot) return undefined;
      return runAsTenant({ spaceId: bot.spaceId, userId: bot.userId }, () =>
        runSideModel(
          side,
          {
            id: bot.id,
            spaceId: bot.spaceId,
            userId: bot.userId,
            modelProvider: bot.modelProvider,
            modelId: bot.modelId,
          },
          {
            operation: call.operation,
            prompt: call.prompt,
            instructions: call.instructions,
            timeoutMs: call.timeoutMs,
            ...(call.onText ? { onText: call.onText } : {}),
          },
        ),
      );
    },
    audit: ({ partnerId, organizationId, via, task, outcome, attempts }) =>
      void recordSecurityEvent({
        type: "partner.assist",
        spaceId: organizationId,
        metadata: { partnerId, via, task, outcome, attempts },
      }),
  };
}
