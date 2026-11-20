import { ADMINISTRATOR, can, findInApp } from "@corvo/core";
import { getSpaceMembershipFor, runAsSystem } from "@corvo/db";
import type { RunContext } from "./run-context.js";
import type { ToolHandlers } from "./run-tool-gate.js";

/** Who is asking, from their standing in the space: a failed lookup shows them the member's view. */
async function viewerOf(ctx: RunContext) {
  try {
    const { prisma } = ctx.deps;
    const input = { spaceId: ctx.run.spaceId, userId: ctx.run.userId };
    const membership = await runAsSystem("read the asker's standing for find_in_app", () =>
      getSpaceMembershipFor(prisma, input),
    );
    const owner = can(membership, ADMINISTRATOR);
    if (!owner) return { owner, partner: false };
    const space = await runAsSystem("read the space's organization for find_in_app", () =>
      prisma.space.findUnique({ where: { id: input.spaceId }, select: { organizationId: true } }),
    );
    const partners = space
      ? await runAsSystem("read whether the organization is a partner for find_in_app", () =>
          prisma.partnerMember.count({ where: { organizationId: space.organizationId } }),
        )
      : 0;
    return { owner, partner: partners > 0 };
  } catch {
    return { owner: false, partner: false };
  }
}

/**
 * The app's own map of screens and settings, read only. It returns the product's fixed catalog,
 * so what comes back is not outside text and does not taint the run.
 */
export const appMapTools: ToolHandlers = {
  async find_in_app(ctx, call) {
    const query = typeof call.args.query === "string" ? call.args.query.trim() : "";
    if (!query) return call.finish({ error: "find_in_app needs a query." });
    const { matches, locked } = findInApp({
      query,
      language: call.args.language,
      viewer: await viewerOf(ctx),
    });
    if (matches.length === 0 && locked.length === 0) {
      return call.finish({
        matches: [],
        note: "Nothing in the app matches. Say you do not know instead of guessing a screen.",
      });
    }
    return call.finish({
      matches,
      ...(locked.length > 0 ? { locked } : {}),
      note: "Link each match as a markdown link to its link. Never point to a locked screen as if the person could open it; say who can.",
    });
  },
};
