import { planConfigFromEnv } from "@corvo/contracts";
import {
  organizationEntitlements,
  organizationOverride,
  runAsSystem,
  setOrganizationOverride,
} from "@corvo/db";
import { ORPCError } from "@orpc/server";
import type { RouterContext } from "./context.js";
import { isPartnerAdmin } from "./partner.js";

/**
 * Custom limits for one organization, set by the platform owner (the people named in
 * PARTNER_ADMIN_EMAILS, the deployment's operator list). What is set replaces the plan's value for
 * that organization only; anyone else gets the same answer as for a route that does not exist.
 */
export function platformRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const admin = authed.use(async ({ context, next }) => {
    if (!isPartnerAdmin(deps.env, context.actor.email)) throw new ORPCError("NOT_FOUND");
    return next();
  });
  const asSystem = <T>(fn: () => Promise<T>) => runAsSystem("platform limit overrides", fn);
  return {
    platform: {
      limits: {
        get: admin.platform.limits.get.handler(({ input }) =>
          asSystem(async () => {
            const plans = planConfigFromEnv();
            const [override, limits] = await Promise.all([
              organizationOverride(deps.prisma, input.organizationId),
              organizationEntitlements(deps.prisma, plans, input.organizationId),
            ]);
            return { override: override ?? {}, plan: limits?.plan ?? null };
          }),
        ),
        set: admin.platform.limits.set.handler(({ context, input }) =>
          asSystem(async () => {
            const organization = await deps.prisma.organization.findUnique({
              where: { id: input.organizationId },
              select: { id: true },
            });
            if (!organization) throw new ORPCError("NOT_FOUND");
            await setOrganizationOverride(deps.prisma, {
              organizationId: input.organizationId,
              override: input.override,
              updatedByUserId: context.actor.userId,
            });
            return { ok: true as const };
          }),
        ),
      },
    },
  };
}
