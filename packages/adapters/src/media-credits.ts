import { imageCatalogUsd, imageWorstCaseUsd } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  creditAccount,
  organizationForMember,
  reserveModelCredits,
  settleModelCredits,
} from "@corvo/db";

/** A refusal the person can act on; its text is what the agent tells them. */
export class MediaCreditsError extends Error {}

export interface MediaCreditHold {
  /** Charge what the images cost: the reported cost, else the catalog price, else the hold. */
  settle(costUsd: number | undefined, produced?: number): Promise<void>;
  /** Give the whole hold back: nothing was generated. */
  release(): Promise<void>;
}

export interface MediaCredits {
  hold(input: {
    jobId: string;
    provider: string;
    model: string | undefined;
    /** How many pictures the call asks for. */
    count: number;
  }): Promise<MediaCreditHold>;
}

/**
 * Images are paid from the credit of the organization the person acts for. The hold is the
 * model's worst case for every picture asked for, since the price is only known afterwards; the
 * difference goes back at once.
 */
export function mediaCredits(
  prisma: PrismaClient,
  scope: { userId: string; spaceId: string; runId: string },
): MediaCredits {
  return {
    async hold({ jobId, provider, model, count }) {
      const membership = await organizationForMember(prisma, scope);
      const account = membership && (await creditAccount(prisma, membership.organizationId));
      if (!membership || account?.mode !== "credits")
        throw new MediaCreditsError("Image generation needs credits. Add credits in Billing.");
      const worstCaseUsd = imageWorstCaseUsd(model, count);
      let entryId: string;
      try {
        // One hold per job, so a retry of the same image is never charged twice.
        entryId = await reserveModelCredits(prisma, membership.organizationId, worstCaseUsd, {
          callId: `media:${jobId}`,
          ...scope,
          provider,
          ...(model ? { model } : {}),
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Not enough model credits"))
          throw new MediaCreditsError("Not enough credit for an image. Add credits in Billing.");
        throw error;
      }
      return {
        settle: (costUsd, produced = count) =>
          settleModelCredits(
            prisma,
            entryId,
            costUsd ?? imageCatalogUsd(model, produced) ?? worstCaseUsd,
          ),
        release: () => settleModelCredits(prisma, entryId, 0),
      };
    },
  };
}
