import type { ConnectedAccountStatus, NormalizedPaymentEvent } from "@corvo/adapter-kit";
import type { PrismaClient } from "./client.js";
import {
  commerceSettings,
  findCatalogPack,
  findCatalogPlan,
  readCatalog,
} from "./commerce-config.js";
import type { CommerceTenant } from "./commerce-ledger.js";
import {
  addTenantTopup,
  CommerceError,
  recordCommerceEvent,
  refundTenantPayment,
  setTenantSubscription,
} from "./commerce-ledger.js";
import { periodLabel, splitRevenue } from "./commerce-money.js";
import { markupMinor, readPartnerMarkups } from "./partner-markup.js";

/**
 * White label collection (docs/partner-commerce.md, 4.2, 7.2, 9 and 12): what a customer on a
 * partner's domain pays, the fee Rook takes, and how the payment provider's verified events change
 * the ledger, the credit and the customer's access. Nothing here knows a vendor: events arrive
 * normalized. Credit is granted only from `applyPaymentEvent`, never from a redirect. Call with a
 * client that runs as the system.
 */

export interface WhiteLabelPartner {
  id: string;
  currency: string;
  commissionBps: number;
  webhookUrl: string | null;
  mode: string;
  billingModel: string;
  connectAccountId: string | null;
  connectState: string;
}

/** What one item costs on the partner's list, and how that charge splits. */
export interface WhiteLabelPrice {
  key: string;
  name: string;
  currency: string;
  creditMinor: number;
  baseMinor: number;
  markupMinor: number;
  /** What the customer pays: the catalog price plus the partner's markup. */
  priceMinor: number;
  /** What Rook keeps, as the application fee; the rest, commission and markup, is the partner's. */
  applicationFeeMinor: number;
}

function priced(
  partner: Pick<WhiteLabelPartner, "commissionBps" | "currency">,
  item: { key: string; name: string; baseMinor: number; creditMinor: number },
  rule: Parameters<typeof markupMinor>[1],
  quantity = 1,
): WhiteLabelPrice {
  const markup = markupMinor(item.baseMinor, rule);
  const base = item.baseMinor * quantity;
  const split = splitRevenue(base, partner.commissionBps);
  return {
    key: item.key,
    name: item.name,
    currency: partner.currency,
    creditMinor: item.creditMinor * quantity,
    baseMinor: base,
    markupMinor: markup * quantity,
    priceMinor: base + markup * quantity,
    applicationFeeMinor: split.rookShareMinor,
  };
}

/** The partner's price list: the catalog in its currency, each item with the partner's markup. */
export async function whiteLabelCatalog(
  prisma: PrismaClient,
  partner: Pick<WhiteLabelPartner, "id" | "commissionBps" | "currency">,
): Promise<{ currency: string; plans: WhiteLabelPrice[]; packs: WhiteLabelPrice[] }> {
  const [catalog, markups] = await Promise.all([
    readCatalog(prisma, partner.currency),
    readPartnerMarkups(prisma, partner.id),
  ]);
  return {
    currency: partner.currency,
    plans: catalog.plans.map((plan) => priced(partner, plan, markups.get(`plan:${plan.key}`))),
    packs: catalog.packs.map((pack) => priced(partner, pack, markups.get(`pack:${pack.key}`))),
  };
}

export async function priceWhiteLabelPlan(
  prisma: PrismaClient,
  partner: Pick<WhiteLabelPartner, "id" | "commissionBps" | "currency">,
  key: string,
): Promise<WhiteLabelPrice | null> {
  const plan = await findCatalogPlan(prisma, key, partner.currency);
  if (!plan) return null;
  const markups = await readPartnerMarkups(prisma, partner.id);
  return priced(partner, plan, markups.get(`plan:${key}`));
}

export async function priceWhiteLabelPack(
  prisma: PrismaClient,
  partner: Pick<WhiteLabelPartner, "id" | "commissionBps" | "currency">,
  key: string,
  quantity: number,
): Promise<WhiteLabelPrice | null> {
  const pack = await findCatalogPack(prisma, key, partner.currency);
  if (!pack) return null;
  const markups = await readPartnerMarkups(prisma, partner.id);
  return priced(partner, pack, markups.get(`pack:${key}`), quantity);
}

/**
 * Makes an organization that signed up on the partner's domain the partner's customer, once. A
 * customer belongs to one partner: an organization that is already another partner's is refused,
 * never moved. The customer pays with its own account and always runs on the platform's AI.
 */
export async function attachWhiteLabelCustomer(
  prisma: PrismaClient,
  partnerId: string,
  input: { organizationId: string; ownerUserId?: string },
) {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (partner?.mode !== "white_label" || partner.billingModel !== "commerce") {
    throw new CommerceError("not_white_label");
  }
  // The signup link (PartnerCustomer) is the one record of whose customer this is.
  const link = await prisma.partnerCustomer.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (link && link.partnerId !== partnerId) throw new CommerceError("customer_of_another_partner");
  const existing = await prisma.partnerTenant.findUnique({
    where: { organizationId: input.organizationId },
  });
  if (existing) {
    if (existing.partnerId !== partnerId) throw new CommerceError("customer_of_another_partner");
    return existing;
  }
  const ownerUserId =
    input.ownerUserId ??
    (
      await prisma.member.findFirst({
        where: { organizationId: input.organizationId, role: "owner" },
        orderBy: { createdAt: "asc" },
        select: { userId: true },
      })
    )?.userId;
  if (!ownerUserId) throw new CommerceError("no_owner");
  await prisma.modelCreditAccount.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId, mode: "credits" },
    update: { mode: "credits" },
  });
  return prisma.partnerTenant.create({
    data: {
      partnerId,
      externalTenantId: input.organizationId,
      organizationId: input.organizationId,
      ownerUserId,
    },
  });
}

export interface ConnectEventResult {
  /** `ignored` for an event that is not Rook's to act on; `refused` for one it must not apply. */
  status: "applied" | "ignored" | "refused";
  reason?: string;
  /** Partner notices recorded by the event, to queue for delivery. */
  notices: string[];
  /** Rook's exact fee for a renewal invoice that is still a draft. */
  invoiceFee?: { account: string; invoiceRef: string; applicationFeeMinor: number };
  /** Mail owed to the customer, in the partner's brand; the API sends it. */
  customerNotices?: Array<{
    kind: "payment_failed" | "refunded";
    organizationId: string;
    amountMinor?: number;
    currency: string;
  }>;
  /** The fee Rook should net on a payment, once refunds and disputes are counted. */
  feeTrim?: { account: string; paymentRef: string; targetFeeMinor: number };
  /** A refund the partner made on its own: Rook's fee should follow it. */
  feeRefund?: { applicationFeeRef: string; chargeAmountMinor: number; refundedMinor: number };
}

const ignored = (reason: string): ConnectEventResult => ({
  status: "ignored",
  reason,
  notices: [],
});

type PartnerRow = Awaited<ReturnType<typeof partnerOfAccount>>;
async function partnerOfAccount(prisma: PrismaClient, account: string | null) {
  return account ? prisma.partner.findUnique({ where: { connectAccountId: account } }) : null;
}

/** The partner's customer an event is about: named in the payment's metadata, else by subscription. */
async function tenantOf(
  prisma: PrismaClient,
  partner: NonNullable<PartnerRow>,
  input: { metadata?: Record<string, string>; subscriptionRef?: string; entryTenantId?: string },
) {
  const metadata = input.metadata ?? {};
  // The payment says which partner it was for; one that names another is never applied.
  if (metadata.corvo_partner && metadata.corvo_partner !== partner.id) return null;
  const tenantId = input.entryTenantId ?? metadata.corvo_tenant;
  const tenant = tenantId
    ? await prisma.partnerTenant.findFirst({ where: { id: tenantId, partnerId: partner.id } })
    : input.subscriptionRef
      ? await prisma.partnerTenant.findFirst({
          where: {
            partnerId: partner.id,
            subscription: { providerSubscriptionRef: input.subscriptionRef },
          },
        })
      : null;
  return tenant;
}

const asTenant = (tenant: {
  id: string;
  organizationId: string;
  externalTenantId: string;
  state: string;
}): CommerceTenant => tenant;

/** Applies one verified, normalized event from a connected account. Safe to repeat. */
export async function applyPaymentEvent(
  prisma: PrismaClient,
  event: NormalizedPaymentEvent,
  now = new Date(),
): Promise<ConnectEventResult> {
  const partner = await partnerOfAccount(prisma, event.account);
  if (!partner) return ignored("unknown_account");
  if (partner.mode !== "white_label") return ignored("not_white_label");
  const notices: string[] = [];
  const notify = async (
    externalTenantId: string,
    kind: string,
    key: string,
    payload: Record<string, unknown>,
  ) => {
    const id = await recordCommerceEvent(prisma, partner, {
      externalTenantId,
      kind,
      key,
      payload,
    });
    if (id) notices.push(id);
  };

  try {
    switch (event.type) {
      case "account.updated": {
        await prisma.partner.update({
          where: { id: partner.id },
          data: { connectState: event.status.state },
        });
        return { status: "applied", notices };
      }

      case "subscription.paid": {
        const tenant = await tenantOf(prisma, partner, event);
        if (!tenant) return ignored("unknown_customer");
        const existing = await prisma.tenantSubscription.findUnique({
          where: { partnerTenantId: tenant.id },
        });
        const plan = event.metadata.corvo_plan ?? existing?.planKey;
        if (!plan) return ignored("unknown_plan");
        // A plan change is paid inside the period it changes: that period and its credit stay.
        const inPeriod = event.reason === "update" && existing;
        const result = await setTenantSubscription(
          prisma,
          partner,
          asTenant(tenant),
          {
            plan,
            status: "active",
            currentPeriodStart: inPeriod ? existing.periodStart : event.periodStart,
            currentPeriodEnd: inPeriod ? existing.periodEnd : event.periodEnd,
            ...(inPeriod ? {} : { chargedMinor: event.amountMinor }),
            externalPaymentId: event.paymentRefs[0],
            idempotencyKey: `stripe:${event.invoiceRef}`,
          },
          now,
        );
        await prisma.tenantSubscription.update({
          where: { partnerTenantId: tenant.id },
          data: {
            source: "stripe",
            providerSubscriptionRef: event.subscriptionRef,
            ...(event.customerRef ? { providerCustomerRef: event.customerRef } : {}),
            // A scheduled downgrade is applied once the new plan is the one being charged.
            ...(existing?.pendingPlanKey === plan ? { pendingPlanKey: null } : {}),
          },
        });
        notices.push(...result.events);
        const paymentRef = event.paymentRefs[0];
        const entry =
          paymentRef && event.account && !inPeriod
            ? await findPayment(prisma, partner.id, [paymentRef])
            : null;
        return {
          status: "applied",
          notices,
          ...(entry && paymentRef && event.account
            ? {
                feeTrim: {
                  account: event.account,
                  paymentRef,
                  targetFeeMinor: await netRookShare(prisma, entry),
                },
              }
            : {}),
        };
      }

      case "subscription.payment_failed": {
        const tenant = await tenantOf(prisma, partner, event);
        if (!tenant) return ignored("unknown_customer");
        const before = await prisma.tenantSubscription.findUnique({
          where: { partnerTenantId: tenant.id },
        });
        const sub = await markSubscription(prisma, tenant.id, "past_due", now);
        const firstFailure = before?.status !== "past_due";
        if (sub) {
          await notify(tenant.externalTenantId, "payment.failed", `${event.invoiceRef}`, {
            currency: partner.currency,
            invoice: event.invoiceRef,
          });
          await notify(
            tenant.externalTenantId,
            "subscription.updated",
            `${periodLabel(sub.periodStart)}:past_due:${event.invoiceRef}`,
            {
              period: periodLabel(sub.periodStart),
              currency: partner.currency,
              plan: sub.planKey,
              status: "past_due",
              currentPeriodEnd: sub.periodEnd.toISOString(),
            },
          );
        }
        return {
          status: "applied",
          notices,
          // One email for a failure, not one for each retry.
          ...(sub && firstFailure
            ? {
                customerNotices: [
                  {
                    kind: "payment_failed" as const,
                    organizationId: tenant.organizationId,
                    currency: partner.currency,
                  },
                ],
              }
            : {}),
        };
      }

      case "subscription.updated": {
        const tenant = await tenantOf(prisma, partner, event);
        if (!tenant) return ignored("unknown_customer");
        const existing = await prisma.tenantSubscription.findUnique({
          where: { partnerTenantId: tenant.id },
        });
        if (!existing) return ignored("no_subscription");
        const status =
          event.status === "past_due"
            ? "past_due"
            : event.status === "unpaid"
              ? "unpaid"
              : event.status === "canceled"
                ? "canceled"
                : event.status === "active" && existing.status === "past_due"
                  ? "active"
                  : null;
        if (!status) return ignored("no_change");
        const before = existing.status;
        const sub = await markSubscription(prisma, tenant.id, status, now);
        if (sub && sub.status !== before) {
          await notify(
            tenant.externalTenantId,
            "subscription.updated",
            `${periodLabel(sub.periodStart)}:${status}:${event.eventRef}`,
            {
              period: periodLabel(sub.periodStart),
              currency: partner.currency,
              plan: sub.planKey,
              status: sub.status,
              currentPeriodEnd: sub.periodEnd.toISOString(),
            },
          );
        }
        return { status: "applied", notices };
      }

      case "invoice.draft": {
        const tenant = await tenantOf(prisma, partner, event);
        const sub = tenant
          ? await prisma.tenantSubscription.findUnique({ where: { partnerTenantId: tenant.id } })
          : null;
        if (!tenant || !sub || !event.account) return ignored("unknown_customer");
        // The renewal charges the plan the subscription is on by then (a downgrade is waiting).
        const planKey = event.metadata.corvo_plan ?? sub.planKey;
        const plan = await findCatalogPlan(prisma, planKey, partner.currency);
        if (!plan) return ignored("unknown_plan");
        const fee = splitRevenue(plan.baseMinor, partner.commissionBps).rookShareMinor;
        return {
          status: "applied",
          notices,
          invoiceFee: {
            account: event.account,
            invoiceRef: event.invoiceRef,
            applicationFeeMinor: Math.min(fee, event.amountDueMinor),
          },
        };
      }

      case "topup.paid": {
        const tenant = await tenantOf(prisma, partner, event);
        if (!tenant) return ignored("unknown_customer");
        const pack = event.metadata.corvo_pack;
        if (!pack) return ignored("not_a_top_up");
        const paymentRef = event.paymentRefs[0];
        if (!paymentRef) return ignored("no_payment");
        const result = await addTenantTopup(
          prisma,
          partner,
          asTenant(tenant),
          {
            pack,
            quantity: Math.max(1, Number(event.metadata.corvo_quantity) || 1),
            paidMinor: event.amountMinor,
            externalPaymentId: paymentRef,
            idempotencyKey: `stripe:${paymentRef}`,
          },
          now,
        );
        notices.push(...result.events);
        return { status: "applied", notices };
      }

      case "payment.refunded": {
        const original = await findPayment(prisma, partner.id, event.paymentRefs);
        if (!original) return ignored("unknown_payment");
        const tenant = await tenantOf(prisma, partner, { entryTenantId: original.partnerTenantId });
        if (!tenant) return ignored("unknown_customer");
        const reversals = await prisma.revenueShareEntry.findMany({
          where: { reverses: original.id },
          select: { paidMinor: true },
        });
        const refundedBefore = reversals.reduce((sum, row) => sum - row.paidMinor, 0);
        const amount = event.refundedMinor - refundedBefore;
        // A repeated or older event finds the refund already in the ledger.
        if (amount > 0) {
          await refundTenantPayment(
            prisma,
            partner,
            asTenant(tenant),
            {
              externalPaymentId: original.externalRef ?? event.paymentRefs[0]!,
              amountMinor: amount,
              idempotencyKey: `stripe-refund:${original.id}:${event.refundedMinor}`,
            },
            now,
          );
          await notify(
            tenant.externalTenantId,
            "payment.refunded",
            `${original.id}:${event.refundedMinor}`,
            {
              period: periodLabel(now),
              currency: original.currency,
              refundedMinor: amount,
              totalRefundedMinor: event.refundedMinor,
            },
          );
        }
        return {
          status: "applied",
          notices,
          ...(amount > 0
            ? {
                customerNotices: [
                  {
                    kind: "refunded" as const,
                    organizationId: tenant.organizationId,
                    amountMinor: amount,
                    currency: original.currency,
                  },
                ],
              }
            : {}),
          ...(event.applicationFeeRef
            ? {
                feeRefund: {
                  applicationFeeRef: event.applicationFeeRef,
                  chargeAmountMinor: event.chargeAmountMinor,
                  refundedMinor: event.refundedMinor,
                },
              }
            : {}),
        };
      }

      case "payment.disputed": {
        const original = await findPayment(prisma, partner.id, event.paymentRefs);
        const row = await prisma.partnerDispute.upsert({
          where: { providerRef: event.disputeRef },
          create: {
            partnerId: partner.id,
            partnerTenantId: original?.partnerTenantId ?? null,
            providerRef: event.disputeRef,
            paymentRef: event.paymentRefs[0] ?? null,
            currency: event.currency,
            amountMinor: event.amountMinor,
            reason: event.reason,
            status: event.status,
          },
          update: { status: event.status },
        });
        const tenant = original
          ? await tenantOf(prisma, partner, { entryTenantId: original.partnerTenantId })
          : null;
        await notify(
          tenant?.externalTenantId ?? "",
          "payment.disputed",
          `${event.disputeRef}:${event.status}`,
          {
            period: periodLabel(now),
            currency: event.currency,
            amountMinor: event.amountMinor,
            reason: event.reason,
            status: event.status,
            disputeId: row.id,
          },
        );
        // A lost dispute takes the money back: it follows the refund path.
        if (event.status === "lost" && original && tenant) {
          const reversals = await prisma.revenueShareEntry.findMany({
            where: { reverses: original.id },
            select: { paidMinor: true },
          });
          const paid = original.paidMinor > 0 ? original.paidMinor : original.baseMinor;
          const open = paid + reversals.reduce((sum, r) => sum + r.paidMinor, 0);
          const amount = Math.min(event.amountMinor, open);
          if (amount > 0) {
            await refundTenantPayment(
              prisma,
              partner,
              asTenant(tenant),
              {
                externalPaymentId: original.externalRef ?? event.paymentRefs[0]!,
                amountMinor: amount,
                idempotencyKey: `stripe-dispute:${event.disputeRef}`,
              },
              now,
            );
          }
          const paymentRef = event.paymentRefs[0];
          if (paymentRef && event.account) {
            return {
              status: "applied",
              notices,
              // The money is gone, so Rook's fee on it goes back in the same proportion.
              feeTrim: {
                account: event.account,
                paymentRef,
                targetFeeMinor: await netRookShare(prisma, original),
              },
            };
          }
        }
        return { status: "applied", notices };
      }

      case "payout.paid":
      case "payout.failed": {
        await prisma.partnerPayout.upsert({
          where: { providerRef: event.payoutRef },
          create: {
            partnerId: partner.id,
            providerRef: event.payoutRef,
            currency: event.currency,
            amountMinor: event.amountMinor,
            status: event.type === "payout.paid" ? "paid" : "failed",
            arrivedAt: event.arrivedAt,
          },
          update: {
            status: event.type === "payout.paid" ? "paid" : "failed",
            arrivedAt: event.arrivedAt,
          },
        });
        if (event.type === "payout.paid") {
          await notify("", "payout.paid", event.payoutRef, {
            period: periodLabel(now),
            currency: event.currency,
            amountMinor: event.amountMinor,
          });
        }
        return { status: "applied", notices };
      }
    }
  } catch (error) {
    // A refusal the event can never get past (a customer gone, a plan no longer sold) is recorded
    // as one; a transient failure is thrown so the provider delivers it again.
    if (error instanceof CommerceError && error.code !== "fx_unavailable") {
      return { status: "refused", reason: error.code, notices };
    }
    throw error;
  }
}

/** What the ledger says Rook keeps of one payment: its share less every reversal. */
async function netRookShare(
  prisma: PrismaClient,
  original: { id: string; rookShareMinor: number },
): Promise<number> {
  const reversals = await prisma.revenueShareEntry.aggregate({
    _sum: { rookShareMinor: true },
    where: { reverses: original.id },
  });
  return original.rookShareMinor + (reversals._sum.rookShareMinor ?? 0);
}

async function findPayment(prisma: PrismaClient, partnerId: string, refs: string[]) {
  return prisma.revenueShareEntry.findFirst({
    where: {
      partnerId,
      kind: { in: ["subscription", "topup"] },
      reverses: null,
      externalRef: { in: refs },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Mirrors the provider's state of a subscription. `past_due` starts the grace period (kept from
 * the first failure), `unpaid` and `canceled` end access at once: a customer whose payments gave
 * up is read-only, and what it already owns stays readable. `active` restores it.
 */
async function markSubscription(
  prisma: PrismaClient,
  partnerTenantId: string,
  status: "past_due" | "unpaid" | "canceled" | "active",
  now: Date,
) {
  const existing = await prisma.tenantSubscription.findUnique({ where: { partnerTenantId } });
  if (!existing) return null;
  if (status === "past_due") {
    return prisma.tenantSubscription.update({
      where: { partnerTenantId },
      data: { status: "past_due", pastDueSince: existing.pastDueSince ?? now },
    });
  }
  if (status === "active") {
    return prisma.tenantSubscription.update({
      where: { partnerTenantId },
      data: { status: "active", pastDueSince: null, lapsedAt: null },
    });
  }
  // Canceled keeps the paid period; unpaid gives up now.
  return prisma.tenantSubscription.update({
    where: { partnerTenantId },
    data: {
      status: "canceled",
      pastDueSince: null,
      ...(status === "unpaid" && existing.periodEnd > now ? { periodEnd: now } : {}),
    },
  });
}

/** Saves the connected account a partner was given and where onboarding stands. */
export async function setPartnerConnectAccount(
  prisma: PrismaClient,
  partnerId: string,
  status: Pick<ConnectedAccountStatus, "account" | "state">,
) {
  return prisma.partner.update({
    where: { id: partnerId },
    data: { connectAccountId: status.account, connectState: status.state },
  });
}

export async function setPartnerConnectState(
  prisma: PrismaClient,
  partnerId: string,
  state: ConnectedAccountStatus["state"],
) {
  await prisma.partner.update({ where: { id: partnerId }, data: { connectState: state } });
}

export interface ReconciliationRow {
  partnerId: string;
  partnerName: string;
  currency: string;
  /** What the ledger says Rook is owed from white label payments in the period, net of refunds. */
  ledgerMinor: number;
  /** What the provider says Rook took, net of fees handed back. */
  providerMinor: number;
  differenceMinor: number;
}

/**
 * Compares the revenue-share ledger with the application fees the provider took, per partner and
 * currency, for one month. A difference is shown, never hidden: a first invoice rounds its fee to
 * a percentage, a plan change prorates, and a lost dispute is not handed back.
 */
export async function reconcileApplicationFees(
  prisma: PrismaClient,
  period: string,
  fees: Array<{ account: string; currency: string; amountMinor: number; refundedMinor: number }>,
): Promise<ReconciliationRow[]> {
  const partners = await prisma.partner.findMany({
    where: { mode: "white_label", connectAccountId: { not: null } },
    select: { id: true, name: true, currency: true, connectAccountId: true },
  });
  const rows: ReconciliationRow[] = [];
  for (const partner of partners) {
    const ledger = await prisma.revenueShareEntry.aggregate({
      _sum: { rookShareMinor: true },
      where: { partnerId: partner.id, period, kind: { in: ["subscription", "topup", "refund"] } },
    });
    const providerMinor = fees
      .filter((fee) => fee.account === partner.connectAccountId)
      .reduce((sum, fee) => sum + fee.amountMinor - fee.refundedMinor, 0);
    const ledgerMinor = ledger._sum.rookShareMinor ?? 0;
    if (ledgerMinor === 0 && providerMinor === 0) continue;
    rows.push({
      partnerId: partner.id,
      partnerName: partner.name,
      currency: partner.currency,
      ledgerMinor,
      providerMinor,
      differenceMinor: providerMinor - ledgerMinor,
    });
  }
  return rows;
}

/** The limits a top-up checkout must respect before money is taken, as the grant will enforce them. */
export async function topupLimit(prisma: PrismaClient): Promise<number> {
  return (await commerceSettings(prisma)).maxTopupMinorPerCall;
}
