import type { AssistantUnavailableCause, RunErrorInfo } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { recordAssistantUnavailable, runAsSystem } from "@corvo/db";
import { getLogger } from "@corvo/logging";

/** The setup failures a run can end in, and what the partner's administrators are told for each. */
const CAUSE_BY_RUN_ERROR: Partial<Record<RunErrorInfo["code"], AssistantUnavailableCause>> = {
  no_model_access: "no_model",
  model_credits_empty: "credits_empty",
  model_unpriced: "model_unpriced",
  model_not_allowed: "model_not_allowed",
};

/** The cause to tell the partner for a failed model call, when it is the account's own setup. */
export function setupCauseOf(info: RunErrorInfo): AssistantUnavailableCause | undefined {
  return CAUSE_BY_RUN_ERROR[info.code];
}

/**
 * Notes, for the partner's administrators, that a customer's assistant could not work and why,
 * when the customer's space belongs to a partner. The person in the product is shown a neutral
 * line by the client. Never throws: failure handling must not depend on it.
 */
export async function alertPartnerOfCause(
  deps: { prisma: PrismaClient },
  spaceId: string,
  cause: AssistantUnavailableCause,
): Promise<void> {
  try {
    await runAsSystem("tell a partner its customer's assistant is unavailable", async () => {
      const space = await deps.prisma.space.findUnique({
        where: { id: spaceId },
        select: { organizationId: true },
      });
      if (!space) return;
      const added = await recordAssistantUnavailable(deps.prisma, space.organizationId, cause);
      if (added) getLogger().warn("partner.assistant_unavailable", { "assistant.cause": cause });
    });
  } catch (error) {
    getLogger().error("partner assistant alert failed", error);
  }
}

/** A run that failed for the account's own setup, in a partner's customer's space. */
export async function alertPartnerOfSetupFailure(
  deps: { prisma: PrismaClient },
  spaceId: string,
  info: RunErrorInfo,
): Promise<void> {
  const cause = setupCauseOf(info);
  if (cause) await alertPartnerOfCause(deps, spaceId, cause);
}
