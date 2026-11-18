import type { PrismaClient } from "./client.js";
import { commerceSettings } from "./commerce-config.js";
import { recordCommerceEvent } from "./commerce-ledger.js";
import { periodLabel } from "./commerce-money.js";

/**
 * Drafts the monthly invoice of Rook's share to each embedded commerce partner: one per partner,
 * period and currency, with a line for every ledger row not on an invoice yet (so a refund after an
 * issued invoice lands on the next one as a credit line). The total is the sum of the lines.
 * Safe to repeat: a draft takes only the rows it does not have; an issued invoice is never changed.
 * Returns the invoices drafted or extended. Call with a client that runs as the system.
 */
export async function draftPartnerInvoices(
  prisma: PrismaClient,
  period: string,
): Promise<string[]> {
  const partners = await prisma.partner.findMany({
    where: { billingModel: "commerce", mode: "embedded", enabled: true },
    select: { id: true },
  });
  const touched: string[] = [];
  for (const partner of partners) {
    const entries = await prisma.revenueShareEntry.findMany({
      where: { partnerId: partner.id, period: { lte: period } },
      select: { id: true, partnerTenantId: true, kind: true, currency: true, rookShareMinor: true },
      orderBy: { createdAt: "asc" },
    });
    const taken = new Set(
      (
        await prisma.partnerInvoiceLine.findMany({
          where: { entryId: { in: entries.map((entry) => entry.id) } },
          select: { entryId: true },
        })
      ).map((line) => line.entryId),
    );
    const open = entries.filter((entry) => !taken.has(entry.id));
    for (const currency of new Set(open.map((entry) => entry.currency))) {
      const lines = open.filter((entry) => entry.currency === currency);
      const invoice = await prisma.partnerInvoice.upsert({
        where: { partnerId_period_currency: { partnerId: partner.id, period, currency } },
        create: { partnerId: partner.id, period, currency, totalMinor: 0 },
        update: {},
      });
      if (invoice.state !== "draft") continue;
      await prisma.partnerInvoiceLine.createMany({
        data: lines.map((entry) => ({
          invoiceId: invoice.id,
          partnerTenantId: entry.partnerTenantId,
          kind: entry.kind,
          entryId: entry.id,
          rookShareMinor: entry.rookShareMinor,
        })),
        skipDuplicates: true,
      });
      const total = await prisma.partnerInvoiceLine.aggregate({
        _sum: { rookShareMinor: true },
        where: { invoiceId: invoice.id },
      });
      await prisma.partnerInvoice.update({
        where: { id: invoice.id },
        data: { totalMinor: total._sum.rookShareMinor ?? 0 },
      });
      touched.push(invoice.id);
    }
  }
  return touched;
}

/** The month before `now`, which is the one a draft is made for. */
export function previousPeriod(now: Date): string {
  return periodLabel(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

export type InvoiceState = "draft" | "issued" | "paid" | "void";
const NEXT: Record<InvoiceState, InvoiceState[]> = {
  draft: ["issued", "void"],
  issued: ["paid", "void"],
  paid: [],
  void: [],
};

/**
 * Moves an invoice along draft, issued, paid or void. Issuing sets the due date and queues the
 * partner's `invoice.issued` notice; voiding frees its lines for the next draft. `externalRef` is
 * the fiscal document number, marked by hand. Returns the notice to queue, if any.
 */
export async function setPartnerInvoiceState(
  prisma: PrismaClient,
  id: string,
  state: InvoiceState,
  options: { externalRef?: string; now?: Date } = {},
): Promise<{ eventId: string | null }> {
  const now = options.now ?? new Date();
  const invoice = await prisma.partnerInvoice.findUnique({
    where: { id },
    include: { partner: { select: { id: true, webhookUrl: true } } },
  });
  if (!invoice) throw new Error("Not found");
  if (!NEXT[invoice.state as InvoiceState]?.includes(state)) throw new Error("Invalid transition");
  if (state === "void") await prisma.partnerInvoiceLine.deleteMany({ where: { invoiceId: id } });
  await prisma.partnerInvoice.update({
    where: { id },
    data: {
      state,
      ...(options.externalRef ? { externalRef: options.externalRef } : {}),
      ...(state === "issued"
        ? {
            issuedAt: now,
            dueAt: new Date(
              now.getTime() + (await commerceSettings(prisma)).invoiceDueDays * 86_400_000,
            ),
          }
        : {}),
      ...(state === "void" ? { totalMinor: 0 } : {}),
    },
  });
  if (state !== "issued") return { eventId: null };
  const eventId = await recordCommerceEvent(prisma, invoice.partner, {
    externalTenantId: "",
    kind: "invoice.issued",
    key: `${invoice.period}:${invoice.id}`,
    payload: {
      invoiceId: invoice.id,
      period: invoice.period,
      currency: invoice.currency,
      totalMinor: invoice.totalMinor,
    },
  });
  return { eventId };
}

export function listPartnerInvoices(prisma: PrismaClient, period?: string) {
  return prisma.partnerInvoice.findMany({
    where: period ? { period } : {},
    orderBy: [{ period: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      partner: { select: { slug: true, name: true } },
      _count: { select: { lines: true } },
    },
  });
}
