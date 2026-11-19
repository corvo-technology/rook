import type { JobPublisher, PaymentsProvider } from "@corvo/adapter-kit";
import { enqueuePartnerWebhook } from "@corvo/adapters";
import type { Actor, WhiteLabelCatalogSchema } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  applyPaymentEvent,
  commerceSettings,
  priceWhiteLabelPack,
  priceWhiteLabelPlan,
  runAsSystem,
  stateAllowsAccess,
  subscriptionState,
  whiteLabelCatalog,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { Hono } from "hono";
import type { z } from "zod";
import { readBoundedBody } from "./http-body.js";

export const PAYMENTS_WEBHOOK_PATH = "/api/v1/billing/connect-webhook";
const PAYMENTS_WEBHOOK_MAX_BODY_BYTES = 512 * 1024;

/** A refusal the customer can act on; the route turns the code into a status. */
export class WhiteLabelError extends Error {
  constructor(readonly code: "not_customer" | "unavailable" | "conflict" | "unknown_item") {
    super(code);
    this.name = "WhiteLabelError";
  }
}

export interface WhiteLabelDeps {
  prisma: PrismaClient;
  provider: PaymentsProvider;
  /** Where the customer lands after paying, until the partner's own domain decides it. */
  webOrigin: string;
  jobs: Pick<JobPublisher, "enqueue">;
  now?: () => Date;
}

type Catalog = z.infer<typeof WhiteLabelCatalogSchema>;

/**
 * What a customer of a white-label partner does about money: read the partner's price list, buy a
 * plan or a top-up on the partner's connected account (Rook takes its share as the application
 * fee), change plan, and manage its card. Nothing here grants credit: that happens only when the
 * payment provider's verified event arrives (`handlePaymentsWebhook`).
 */
export function createWhiteLabelPayments(deps: WhiteLabelDeps) {
  const now = () => deps.now?.() ?? new Date();

  /** The customer's own organization and the white-label partner it belongs to. */
  async function customerOf(actor: Actor) {
    const space = await deps.prisma.space.findUnique({
      where: { id: actor.spaceId },
      select: { organizationId: true },
    });
    if (!space) return null;
    const tenant = await deps.prisma.partnerTenant.findUnique({
      where: { organizationId: space.organizationId },
      include: { partner: true, subscription: true },
    });
    if (tenant?.partner.mode !== "white_label" || tenant.partner.billingModel !== "commerce") {
      return null;
    }
    return tenant;
  }
  const asSystem = <T>(fn: () => Promise<T>) => runAsSystem("white label customer payments", fn);
  const mustCustomer = async (actor: Actor) => {
    const customer = await customerOf(actor);
    if (!customer) throw new WhiteLabelError("not_customer");
    return customer;
  };
  const ready = (customer: NonNullable<Awaited<ReturnType<typeof customerOf>>>) => {
    const { connectAccountId, connectState } = customer.partner;
    if (!connectAccountId || connectState !== "active") throw new WhiteLabelError("unavailable");
    return connectAccountId;
  };
  const returnUrl = (result: string) => `${deps.webOrigin}/app/plans?checkout=${result}`;

  return {
    catalog: (actor: Actor): Promise<Catalog | null> =>
      asSystem(async () => {
        const customer = await customerOf(actor);
        if (!customer) return null;
        const list = await whiteLabelCatalog(deps.prisma, customer.partner);
        const { graceDays } = await commerceSettings(deps.prisma);
        const sub = customer.subscription;
        const state = subscriptionState(sub, now(), graceDays);
        const item = (price: (typeof list.plans)[number]) => ({
          key: price.key,
          name: price.name,
          creditMinor: price.creditMinor,
          priceMinor: price.priceMinor,
        });
        return {
          currency: customer.partner.currency === "BRL" ? "BRL" : "USD",
          plans: list.plans.map(item),
          packs: list.packs.map(item),
          subscription:
            sub && state !== "none"
              ? {
                  planKey: sub.planKey,
                  pendingPlanKey: sub.pendingPlanKey,
                  state,
                  periodEnd: sub.periodEnd.toISOString(),
                }
              : null,
          canPay:
            customer.partner.connectState === "active" &&
            Boolean(customer.partner.connectAccountId),
        };
      }),

    /** The checkout of a plan or a pack: the customer pays the partner's price, Rook's share is the fee. */
    checkout: (
      actor: Actor,
      input: { kind: "plan"; key: string } | { kind: "pack"; key: string; quantity: number },
    ): Promise<{ url: string }> =>
      asSystem(async () => {
        const customer = await mustCustomer(actor);
        const account = ready(customer);
        const { partner, subscription } = customer;
        const metadata: Record<string, string> = {
          corvo_partner: partner.id,
          corvo_tenant: customer.id,
        };
        const base = {
          account,
          customerEmail: actor.email,
          successUrl: returnUrl("success"),
          cancelUrl: returnUrl("canceled"),
          ...(subscription?.providerCustomerRef
            ? { customerRef: subscription.providerCustomerRef }
            : {}),
        };
        if (input.kind === "plan") {
          const { graceDays } = await commerceSettings(deps.prisma);
          // A plan that is still in force is changed, not bought again.
          if (
            subscription?.providerSubscriptionRef &&
            stateAllowsAccess(subscriptionState(subscription, now(), graceDays))
          ) {
            throw new WhiteLabelError("conflict");
          }
          const price = await priceWhiteLabelPlan(deps.prisma, partner, input.key);
          if (!price) throw new WhiteLabelError("unknown_item");
          return deps.provider.createSubscriptionCheckout({
            ...base,
            currency: price.currency,
            amountMinor: price.priceMinor,
            applicationFeeMinor: price.applicationFeeMinor,
            productName: price.name,
            metadata: { ...metadata, corvo_plan: price.key },
          });
        }
        const { graceDays, maxTopupMinorPerCall } = await commerceSettings(deps.prisma);
        if (!stateAllowsAccess(subscriptionState(subscription, now(), graceDays))) {
          throw new WhiteLabelError("conflict");
        }
        const price = await priceWhiteLabelPack(deps.prisma, partner, input.key, input.quantity);
        if (!price) throw new WhiteLabelError("unknown_item");
        if (price.priceMinor > maxTopupMinorPerCall) throw new WhiteLabelError("conflict");
        return deps.provider.createTopUpCheckout({
          ...base,
          currency: price.currency,
          amountMinor: price.priceMinor,
          applicationFeeMinor: price.applicationFeeMinor,
          productName: price.name,
          metadata: {
            ...metadata,
            corvo_pack: price.key,
            corvo_quantity: String(input.quantity),
          },
        });
      }),

    /**
     * An upgrade is charged now (the difference for the rest of the period) and its credit comes
     * from that payment; a downgrade changes what the next period charges and waits for it. Both go
     * through Rook so the price, the fee and the credit stay consistent.
     */
    changePlan: (
      actor: Actor,
      key: string,
    ): Promise<{ effective: "now" | "period_end" | "unchanged" }> =>
      asSystem(async () => {
        const customer = await mustCustomer(actor);
        const account = ready(customer);
        const { partner, subscription } = customer;
        if (!subscription?.providerSubscriptionRef) throw new WhiteLabelError("conflict");
        const { graceDays } = await commerceSettings(deps.prisma);
        if (subscriptionState(subscription, now(), graceDays) !== "active") {
          throw new WhiteLabelError("conflict");
        }
        const price = await priceWhiteLabelPlan(deps.prisma, partner, key);
        if (!price) throw new WhiteLabelError("unknown_item");
        const current = subscription.pendingPlanKey ?? subscription.planKey;
        if (key === current) return { effective: "unchanged" as const };
        // Going back to the plan in force undoes a waiting downgrade; it charges nothing.
        const revert = key === subscription.planKey;
        const upgrade = !revert && price.baseMinor > subscription.baseMinor;
        await deps.provider.changeSubscriptionPlan({
          account,
          subscriptionRef: subscription.providerSubscriptionRef,
          currency: price.currency,
          amountMinor: price.priceMinor,
          applicationFeeMinor: price.applicationFeeMinor,
          productName: price.name,
          metadata: {
            corvo_partner: partner.id,
            corvo_tenant: customer.id,
            corvo_plan: price.key,
          },
          proration: upgrade ? "now" : "none",
        });
        await deps.prisma.tenantSubscription.update({
          where: { partnerTenantId: customer.id },
          data: { pendingPlanKey: upgrade || revert ? null : key },
        });
        return {
          effective: revert
            ? ("unchanged" as const)
            : upgrade
              ? ("now" as const)
              : ("period_end" as const),
        };
      }),

    portal: (actor: Actor): Promise<{ url: string }> =>
      asSystem(async () => {
        const customer = await mustCustomer(actor);
        const account = ready(customer);
        const customerRef = customer.subscription?.providerCustomerRef;
        if (!customerRef) throw new WhiteLabelError("conflict");
        return deps.provider.createCustomerPortal({
          account,
          customerRef,
          returnUrl: `${deps.webOrigin}/app/plans`,
        });
      }),
  };
}

export type WhiteLabelPayments = ReturnType<typeof createWhiteLabelPayments>;

/**
 * Takes a connected account's events. The signature is verified before anything else; credit,
 * refunds, failed payments and disputes change the ledger only from here, and a repeated delivery
 * changes nothing. A failure answers 5xx so the provider delivers the event again.
 */
export function mountPaymentsWebhook(
  app: Hono,
  deps: Pick<WhiteLabelDeps, "prisma" | "provider" | "jobs" | "now">,
): void {
  app.post(PAYMENTS_WEBHOOK_PATH, async (c) => {
    const raw = await readBoundedBody(c.req.raw, PAYMENTS_WEBHOOK_MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    const event = deps.provider.parseWebhook(raw, c.req.raw.headers);
    if (event === null) return c.json({ error: "Invalid signature" }, 400);
    if (event === "ignored") return c.json({ ok: true });
    try {
      const result = await runAsSystem("apply a payment event", async () => {
        const applied = await applyPaymentEvent(deps.prisma, event, deps.now?.() ?? new Date());
        if (applied.invoiceFee) {
          await deps.provider.setInvoiceApplicationFee(applied.invoiceFee);
        }
        if (applied.feeRefund) await deps.provider.refundApplicationFee(applied.feeRefund);
        if (applied.feeTrim) await deps.provider.trimApplicationFee(applied.feeTrim);
        return applied;
      });
      if (result.status === "refused") {
        // Money may have moved without credit; support needs to see it.
        getLogger().error("payment event refused", { type: event.type, reason: result.reason });
      }
      for (const id of result.notices) {
        await enqueuePartnerWebhook(deps.jobs, id).catch(() => undefined);
      }
    } catch (error) {
      getLogger().error("payment webhook failed", error);
      return c.json({ error: "Failed" }, 500);
    }
    return c.json({ ok: true });
  });
}
