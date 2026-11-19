import { randomBytes } from "node:crypto";
import type { Actor } from "@corvo/contracts";
import { runAsSystem } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { assertMcpRemoteEndpoint } from "../mcp-servers.js";
import type { PartnerConsoleDeps, PartnerScope } from "../partner-console/index.js";
import {
  createPrismaPartnerConsoleStore,
  getCredits,
  getCustomer,
  getIntegration,
  getOverview,
  getPricing,
  getRevenue,
  getRevenueCsv,
  getTemplate,
  listCustomers,
  listInvoices,
  listPartners,
  openSupportSession,
  PartnerConsoleError,
  rotateIntegrationKey,
  runCustomerAction,
  setAllowedModels,
  setAutoTopup,
  setCustomerCreditLimit,
  setIntegrationAlertEmail,
  setIntegrationWebhook,
  setPricing,
  setTemplate,
  startTopup,
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

  const run = async <T>(
    actor: Actor,
    call: (scope: PartnerScope, deps: PartnerConsoleDeps) => Promise<T>,
  ): Promise<T> => {
    const scope = await scopeOf(actor);
    // A top-up goes through the caller's own billing: the fund is the credit of their account.
    const billing = deps.billing;
    const withBilling: PartnerConsoleDeps = billing
      ? {
          ...service,
          topupCheckout: (_partner, amountMinor) =>
            billing.purchaseCredits(actor, { amountCents: amountMinor, monthly: false }),
        }
      : service;
    try {
      return await call(scope, withBilling);
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
      credits: managed.partnerConsole.credits.handler(({ context, input }) =>
        run(context.actor, (scope) => getCredits(service, scope, input)),
      ),
      setCustomerLimit: managed.partnerConsole.setCustomerLimit.handler(({ context, input }) =>
        run(context.actor, (scope) => setCustomerCreditLimit(service, scope, input)),
      ),
      setAllowedModels: managed.partnerConsole.setAllowedModels.handler(({ context, input }) =>
        run(context.actor, (scope) => setAllowedModels(service, scope, input)),
      ),
      setAutoTopup: managed.partnerConsole.setAutoTopup.handler(({ context, input }) =>
        run(context.actor, (scope) => setAutoTopup(service, scope, input)),
      ),
      topup: managed.partnerConsole.topup.handler(({ context, input }) =>
        run(context.actor, (scope, withBilling) => startTopup(withBilling, scope, input)),
      ),
      invoices: managed.partnerConsole.invoices.handler(({ context, input }) =>
        run(context.actor, (scope) => listInvoices(service, scope, input)),
      ),
      template: managed.partnerConsole.template.handler(({ context, input }) =>
        run(context.actor, (scope) => getTemplate(service, scope, input)),
      ),
      setTemplate: managed.partnerConsole.setTemplate.handler(async ({ context, input }) => {
        // The same network policy as any other connector, checked when it is saved.
        if (input.template?.connector) {
          await assertMcpRemoteEndpoint(input.template.connector.endpoint, deps);
        }
        return run(context.actor, (scope) => setTemplate(service, scope, input));
      }),
      setWebhook: managed.partnerConsole.setWebhook.handler(({ context, input }) =>
        run(context.actor, (scope) => setIntegrationWebhook(service, scope, input)),
      ),
      setAlertEmail: managed.partnerConsole.setAlertEmail.handler(({ context, input }) =>
        run(context.actor, (scope) => setIntegrationAlertEmail(service, scope, input)),
      ),
    },
  };
}
