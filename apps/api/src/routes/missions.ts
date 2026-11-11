import { markPartSeen, readMissions, showAllNavigation } from "@corvo/db";
import type { RouterContext } from "./context.js";

export function missionsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    missions: {
      get: authed.missions.get.handler(({ context }) => readMissions(deps.prisma, context.actor)),
      seen: authed.missions.seen.handler(async ({ context, input }) => {
        await markPartSeen(deps.prisma, context.actor, input.part);
        return { ok: true as const };
      }),
      showAll: authed.missions.showAll.handler(async ({ context }) => {
        await showAllNavigation(deps.prisma, context.actor);
        return { ok: true as const };
      }),
    },
  };
}
