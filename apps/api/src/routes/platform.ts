import { enqueuePartnerWebhook } from "@corvo/adapters";
import { planConfigFromEnv } from "@corvo/contracts";
import {
  approvePartnerLead,
  createPlatformPartner,
  decideWaitlistEntry,
  declinePartnerLead,
  draftPartnerInvoices,
  listPartnerInvoices,
  listPartnerLeads,
  listWaitlist,
  livePartnerPricing,
  type NewInvitation,
  OnboardingError,
  organizationEntitlements,
  organizationOverride,
  PartnerPlanError,
  PartnerPricingError,
  partnerPricingHistory,
  platformPartnerOverview,
  publishPartnerPricing,
  runAsSystem,
  setOrganizationOverride,
  setPartnerInvoiceState,
  setPartnerPlan,
  simulatePartnerPricing,
} from "@corvo/db";
import { ORPCError } from "@orpc/server";
import type { PartnerBranding } from "../partner-brand/index.js";
import { brandingView } from "../partner-brand/index.js";
import { sendInvitationEmail } from "../team.js";
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
  const asSystem = <T>(fn: () => Promise<T>) =>
    runAsSystem("platform limit overrides", fn).catch((error) => {
      if (error instanceof OnboardingError) {
        const code = {
          not_found: "NOT_FOUND",
          invalid: "BAD_REQUEST",
          conflict: "CONFLICT",
        } as const;
        throw new ORPCError(code[error.code]);
      }
      throw error;
    });
  /** Mails the invitation just made, in the operator's name; false where mail is not set up. */
  async function mail(actorUserId: string, invitation: NewInvitation | null): Promise<boolean> {
    if (!invitation || !deps.team) return false;
    const inviter = await deps.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { name: true },
    });
    return sendInvitationEmail(deps.team, {
      id: invitation.id,
      email: invitation.email,
      inviterName: inviter?.name ?? "",
      spaceName: invitation.spaceName,
    });
  }
  const dated = <T extends { createdAt: Date }>(rows: T[]) =>
    rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  return {
    platform: {
      partnerPricing: {
        get: admin.platform.partnerPricing.get.handler(() =>
          asSystem(async () => {
            const live = await livePartnerPricing(deps.prisma);
            return live
              ? {
                  version: live.version,
                  config: live.config,
                  createdAt: live.createdAt.toISOString(),
                  effectiveAt: live.effectiveAt.toISOString(),
                }
              : null;
          }),
        ),
        history: admin.platform.partnerPricing.history.handler(() =>
          asSystem(async () =>
            (await partnerPricingHistory(deps.prisma)).map((row) => ({
              ...row,
              createdAt: row.createdAt.toISOString(),
              effectiveAt: row.effectiveAt.toISOString(),
            })),
          ),
        ),
        publish: admin.platform.partnerPricing.publish.handler(({ context, input }) =>
          asSystem(async () => {
            try {
              return await publishPartnerPricing(deps.prisma, input.config, context.actor.userId, {
                effectiveOn: input.effectiveOn,
              });
            } catch (error) {
              if (error instanceof PartnerPricingError) {
                throw new ORPCError("BAD_REQUEST", { message: error.code });
              }
              throw error;
            }
          }),
        ),
        simulate: admin.platform.partnerPricing.simulate.handler(({ input }) =>
          asSystem(async () => {
            const config = input.config ?? (await livePartnerPricing(deps.prisma))?.config;
            if (!config) throw new ORPCError("PRECONDITION_FAILED");
            try {
              return simulatePartnerPricing(config, input);
            } catch (error) {
              if (error instanceof PartnerPricingError) {
                throw new ORPCError("BAD_REQUEST", { message: error.code });
              }
              throw error;
            }
          }),
        ),
      },
      partnerPlan: {
        set: admin.platform.partnerPlan.set.handler(({ input }) =>
          asSystem(async () => {
            try {
              await setPartnerPlan(deps.prisma, input.partnerId, input.tierKey);
            } catch (error) {
              if (error instanceof PartnerPlanError) {
                throw new ORPCError("BAD_REQUEST", { message: error.code });
              }
              throw error;
            }
            return { ok: true as const };
          }),
        ),
      },
      partners: {
        list: admin.platform.partners.list.handler(({ input }) =>
          asSystem(() => platformPartnerOverview(deps.prisma, input.period)),
        ),
        create: admin.platform.partners.create.handler(({ context, input }) =>
          asSystem(async () => {
            const { ownerEmail, ...partner } = input;
            const created = await createPlatformPartner(deps.prisma, {
              ...partner,
              ownerEmail,
              actorUserId: context.actor.userId,
            });
            return {
              partnerId: created.partnerId,
              emailed: await mail(context.actor.userId, created.invitation),
            };
          }),
        ),
      },
      waitlist: {
        list: admin.platform.waitlist.list.handler(() =>
          asSystem(async () => dated(await listWaitlist(deps.prisma)) as never),
        ),
        decide: admin.platform.waitlist.decide.handler(({ context, input }) =>
          asSystem(async () => {
            const { invitation } = await decideWaitlistEntry(deps.prisma, {
              ...input,
              actorUserId: context.actor.userId,
            });
            return { emailed: await mail(context.actor.userId, invitation) };
          }),
        ),
      },
      partnerLeads: {
        list: admin.platform.partnerLeads.list.handler(() =>
          asSystem(async () => dated(await listPartnerLeads(deps.prisma)) as never),
        ),
        approve: admin.platform.partnerLeads.approve.handler(({ context, input }) =>
          asSystem(async () => {
            const result = await approvePartnerLead(deps.prisma, {
              id: input.id,
              actorUserId: context.actor.userId,
              partner: input.partner,
            });
            return {
              partnerId: result.partnerId,
              emailed: await mail(context.actor.userId, result.invitation),
            };
          }),
        ),
        decline: admin.platform.partnerLeads.decline.handler(({ context, input }) =>
          asSystem(async () => {
            await declinePartnerLead(deps.prisma, { ...input, actorUserId: context.actor.userId });
            return { ok: true as const };
          }),
        ),
      },
      partnerBranding: {
        get: admin.platform.partnerBranding.get.handler(({ input }) =>
          asSystem(async () => {
            const branding = deps.branding;
            if (!branding) throw new ORPCError("NOT_FOUND");
            const [view, domains, customers] = await Promise.all([
              brandingView(brandingReadDeps(branding), input.partnerId),
              branding.store.domains(input.partnerId),
              branding.store.customerCount(input.partnerId),
            ]);
            return {
              brand: view.brand,
              domains: domains.map((host) => ({
                hostname: host.hostname,
                state: host.state,
                error: host.lastError,
              })),
              sender: view.sender,
              customers,
            };
          }),
        ),
      },
      invoices: {
        list: admin.platform.invoices.list.handler(({ input }) =>
          asSystem(async () => invoiceViews(await listPartnerInvoices(deps.prisma, input.period))),
        ),
        draft: admin.platform.invoices.draft.handler(({ input }) =>
          asSystem(async () => {
            await draftPartnerInvoices(deps.prisma, input.period);
            return invoiceViews(await listPartnerInvoices(deps.prisma, input.period));
          }),
        ),
        setState: admin.platform.invoices.setState.handler(({ input }) =>
          asSystem(async () => {
            try {
              const { eventId } = await setPartnerInvoiceState(deps.prisma, input.id, input.state, {
                externalRef: input.externalRef,
              });
              if (eventId) await enqueuePartnerWebhook(deps.jobs, eventId).catch(() => undefined);
            } catch (error) {
              if (error instanceof Error && error.message === "Not found") {
                throw new ORPCError("NOT_FOUND");
              }
              if (error instanceof Error && error.message === "Invalid transition") {
                throw new ORPCError("CONFLICT");
              }
              throw error;
            }
            return { ok: true as const };
          }),
        ),
      },
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

function invoiceViews(rows: Awaited<ReturnType<typeof listPartnerInvoices>>) {
  return rows.map((row) => ({
    id: row.id,
    partner: row.partner.slug,
    period: row.period,
    currency: row.currency,
    state: row.state as "draft" | "issued" | "paid" | "void",
    totalMinor: row.totalMinor,
    lines: row._count.lines,
    dueAt: row.dueAt?.toISOString() ?? null,
    externalRef: row.externalRef,
  }));
}

/** A read-only view needs no console store: nothing is written. */
function brandingReadDeps(branding: PartnerBranding) {
  return {
    store: branding.store,
    console: { findPartner: async () => null, audit: async () => undefined },
    assets: branding.assets,
    domains: branding.domains,
    senderDomains: branding.senderDomains,
    reservedHosts: branding.reservedHosts,
    now: () => new Date(),
  };
}
