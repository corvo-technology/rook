import { randomBytes } from "node:crypto";
import type { Actor } from "@corvo/contracts";
import { runAsSystem } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import type { PartnerConsoleDeps, PartnerScope } from "../partner-console/index.js";
import {
  createPrismaPartnerConsoleStore,
  getCustomer,
  getIntegration,
  getOverview,
  getPricing,
  getRevenue,
  getRevenueCsv,
  listCustomers,
  listPartners,
  openSupportSession,
  PartnerConsoleError,
  rotateIntegrationKey,
  runCustomerAction,
  setIntegrationWebhook,
  setPricing,
} from "../partner-console/index.js";
import { requireSpacePermission } from "../space-owner.js";
import type { RouterContext } from "./context.js";

/** A refusal of the service as the status a client reads; a missing partner is "not found". */
function orpcError(error: unknown): unknown {
  if (!(error instanceof PartnerConsoleError)) return error;
  switch (error.code) {
    case "not_found":
      return new ORPCError("NOT_FOUND");
    case "invalid":
      return new ORPCError("BAD_REQUEST", { message: error.reason });
    case "conflict":
    case "refused":
      return new ORPCError("CONFLICT", { message: error.reason });
  }
}

/**
 * The partner console (docs/partner-commerce.md, section 6): the organization of the person
 * asking, when they hold `manage_partner`, runs the partners it is a member of. The routes only
 * authorize and translate; everything else is the service layer, which agents use too.
 */
export function partnerConsoleRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const store = createPrismaPartnerConsoleStore(deps.prisma);
  const service: PartnerConsoleDeps = {
    store,
    now: () => new Date(),
    webOrigin: deps.env.webOrigin,
    newCode: () => randomBytes(32).toString("base64url"),
  };

  const managed = authed.use(async ({ context, next }) => {
    await requireSpacePermission(deps.prisma, context.actor, "manage_partner");
    return next();
  });

  async function scopeOf(actor: Actor): Promise<PartnerScope> {
    const space = await runAsSystem("partner console organization", () =>
      deps.prisma.space.findUnique({
        where: { id: actor.spaceId },
        select: { organizationId: true },
      }),
    );
    if (!space) throw new ORPCError("FORBIDDEN");
    return { organizationId: space.organizationId, actorUserId: actor.userId };
  }

  const run = async <T>(actor: Actor, call: (scope: PartnerScope) => Promise<T>): Promise<T> => {
    const scope = await scopeOf(actor);
    try {
      return await call(scope);
    } catch (error) {
      throw orpcError(error);
    }
  };

  return {
    partnerConsole: {
      partners: managed.partnerConsole.partners.handler(({ context }) =>
        run(context.actor, (scope) => listPartners(service, scope)),
      ),
      overview: managed.partnerConsole.overview.handler(({ context, input }) =>
        run(context.actor, (scope) => getOverview(service, scope, input)),
      ),
      customers: managed.partnerConsole.customers.handler(({ context, input }) =>
        run(context.actor, (scope) => listCustomers(service, scope, input)),
      ),
      customer: managed.partnerConsole.customer.handler(({ context, input }) =>
        run(context.actor, (scope) => getCustomer(service, scope, input)),
      ),
      customerAction: managed.partnerConsole.customerAction.handler(({ context, input }) =>
        run(context.actor, (scope) => runCustomerAction(service, scope, input)),
      ),
      supportSession: managed.partnerConsole.supportSession.handler(({ context, input }) =>
        run(context.actor, (scope) => openSupportSession(service, scope, input)),
      ),
      pricing: managed.partnerConsole.pricing.handler(({ context, input }) =>
        run(context.actor, (scope) => getPricing(service, scope, input)),
      ),
      setPricing: managed.partnerConsole.setPricing.handler(({ context, input }) =>
        run(context.actor, (scope) => setPricing(service, scope, input)),
      ),
      revenue: managed.partnerConsole.revenue.handler(({ context, input }) =>
        run(context.actor, (scope) => getRevenue(service, scope, input)),
      ),
      revenueCsv: managed.partnerConsole.revenueCsv.handler(({ context, input }) =>
        run(context.actor, (scope) => getRevenueCsv(service, scope, input)),
      ),
      integration: managed.partnerConsole.integration.handler(({ context, input }) =>
        run(context.actor, (scope) => getIntegration(service, scope, input)),
      ),
      rotateKey: managed.partnerConsole.rotateKey.handler(({ context, input }) =>
        run(context.actor, (scope) => rotateIntegrationKey(service, scope, input)),
      ),
      setWebhook: managed.partnerConsole.setWebhook.handler(({ context, input }) =>
        run(context.actor, (scope) => setIntegrationWebhook(service, scope, input)),
      ),
    },
  };
}
