import { PartnerTemplate } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  addPartnerAllowance,
  addTenantCredit,
  CommerceError,
  CREDIT_MICROS,
  commerceBalance,
  commerceSettings,
  configurePartnerCommerce,
  listOwnedPartnerTenants,
  PartnerAllowanceRefused,
  partnerWalletOrganization,
  periodLabel,
  purgeExpiredEntryCodes,
  readCatalog,
  readPartnerMarkups,
  rotatePartnerKey,
  runAsSystem,
  runIdempotent,
  setPartnerTemplateById,
  setPartnerTenantState,
  setPartnerWebhookUrl,
} from "@corvo/db";
import type {
  ConnectorState,
  CustomerRow,
  CustomerState,
  PartnerConsoleStore,
  PartnerRecord,
} from "./types.js";
import { PartnerConsoleError } from "./types.js";

/** Most customers one partner's console reads at once; the lists are paged on top of this. */
const MAX_CUSTOMERS = 1000;
const BALANCE_BATCH = 8;

const system = <T>(fn: () => Promise<T>) => runAsSystem("partner console", fn);

function toRecord(partner: {
  id: string;
  slug: string;
  name: string;
  mode: string;
  currency: string;
  billingModel: string;
  commissionBps: number;
  checkoutUrl: string | null;
  keyPrefix: string;
  webhookUrl: string | null;
  template: unknown;
  createdAt: Date;
}): PartnerRecord {
  const template = PartnerTemplate.safeParse(partner.template).data;
  return {
    id: partner.id,
    slug: partner.slug,
    name: partner.name,
    mode: partner.mode === "white_label" ? "white_label" : "embedded",
    currency: partner.currency === "BRL" ? "BRL" : "USD",
    billingModel: partner.billingModel === "commerce" ? "commerce" : "wallet",
    commissionBps: partner.commissionBps,
    checkoutUrl: partner.checkoutUrl,
    keyPrefix: partner.keyPrefix,
    webhookUrl: partner.webhookUrl,
    accent: template?.accent ?? null,
    chiefName: template?.chiefName ?? null,
    template: template ?? null,
    createdAt: partner.createdAt,
  };
}

const MS_PER_DAY = 86_400_000;

/**
 * The console's storage on the database. Each call runs as the system, because partner tables
 * belong to the platform; what keeps one organization out of another's partner is `findPartner`
 * and the rows being read by the partner's id only.
 */
export function createPrismaPartnerConsoleStore(prisma: PrismaClient): PartnerConsoleStore {
  async function balanceFor(
    partner: PartnerRecord,
    row: Pick<CustomerRow, "tenantId" | "organizationId">,
    now: Date,
  ) {
    return commerceBalance(
      prisma,
      { currency: partner.currency },
      { id: row.tenantId, organizationId: row.organizationId },
      now,
    );
  }

  return {
    listPartners: (organizationId) =>
      system(async () => {
        const members = await prisma.partnerMember.findMany({
          where: { organizationId },
          include: { partner: true },
          orderBy: { createdAt: "asc" },
        });
        return members.map((member) => toRecord(member.partner));
      }),

    findPartner: (organizationId, partnerId) =>
      system(async () => {
        const member = await prisma.partnerMember.findUnique({
          where: { partnerId_organizationId: { partnerId, organizationId } },
          include: { partner: true },
        });
        return member ? toRecord(member.partner) : null;
      }),

    customerRows: (partner, now) =>
      system(async () => {
        const [tenants, settings, template] = await Promise.all([
          prisma.partnerTenant.findMany({
            where: { partnerId: partner.id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: MAX_CUSTOMERS,
            include: {
              organization: { select: { name: true } },
              subscription: true,
            },
          }),
          commerceSettings(prisma),
          prisma.partner.findUnique({ where: { id: partner.id }, select: { template: true } }),
        ]);
        const connectorSlug = PartnerTemplate.safeParse(template?.template).data?.connector?.slug;
        const servers = connectorSlug
          ? await prisma.mcpServer.findMany({
              where: {
                slug: connectorSlug,
                enabled: true,
                spaceId: { in: tenants.map((tenant) => tenant.organizationId) },
              },
              select: { spaceId: true, healthStatus: true, healthCheckedAt: true },
            })
          : [];
        const connectorOf = (spaceId: string) => {
          const mine = servers.filter((server) => server.spaceId === spaceId);
          const down = mine.find((server) => server.healthStatus === "error");
          const state: ConnectorState = mine.length === 0 ? "none" : down ? "down" : "ok";
          return { state, checkedAt: (down ?? mine[0])?.healthCheckedAt ?? null };
        };

        const wallet =
          partner.billingModel === "commerce"
            ? null
            : new Map(
                (await listOwnedPartnerTenants(prisma, partner.id, now)).map((row) => [
                  row.externalTenantId,
                  row,
                ]),
              );
        const rows: CustomerRow[] = [];
        for (let start = 0; start < tenants.length; start += BALANCE_BATCH) {
          const batch = tenants.slice(start, start + BALANCE_BATCH);
          rows.push(
            ...(await Promise.all(
              batch.map(async (tenant): Promise<CustomerRow> => {
                const connector = connectorOf(tenant.organizationId);
                const base = {
                  tenantId: tenant.id,
                  externalTenantId: tenant.externalTenantId,
                  organizationId: tenant.organizationId,
                  name: tenant.organization.name,
                  since: tenant.createdAt,
                  connector: connector.state,
                  connectorCheckedAt: connector.checkedAt,
                  pastDueSince: tenant.subscription?.pastDueSince ?? null,
                  subscription: tenant.subscription
                    ? {
                        baseMinor: tenant.subscription.baseMinor,
                        markupMinor: tenant.subscription.markupMinor,
                        periodEnd: tenant.subscription.periodEnd,
                      }
                    : null,
                };
                const paused = tenant.state === "suspended";
                if (wallet) {
                  const usage = wallet.get(tenant.externalTenantId);
                  const used = Math.round((usage?.usedUsd ?? 0) * 100);
                  const remaining = Math.round((usage?.balanceUsd ?? 0) * 100);
                  const pct =
                    used + remaining > 0 ? Math.floor((used * 100) / (used + remaining)) : null;
                  return {
                    ...base,
                    plan: null,
                    planKey: null,
                    creditUsedPct: pct,
                    creditRemaining: remaining,
                    state: paused ? "paused" : "active",
                    lowCredit: pct !== null && pct * 100 >= settings.lowCreditBps,
                  };
                }
                const balance = await balanceFor(partner, base, now);
                const granted = balance.plan.grantedMinor;
                const state: CustomerState = paused
                  ? "paused"
                  : balance.state === "canceled"
                    ? "active"
                    : balance.state === "none"
                      ? "lapsed"
                      : balance.state;
                return {
                  ...base,
                  plan: balance.planName,
                  planKey: balance.planKey,
                  creditUsedPct:
                    granted > 0
                      ? Math.min(100, Math.floor((balance.plan.usedMinor * 100) / granted))
                      : null,
                  creditRemaining: balance.remainingMinor,
                  state,
                  lowCredit: balance.lowThresholdReached,
                };
              }),
            )),
          );
        }
        return rows;
      }),

    customerDetail: (partner, row, now) =>
      system(async () => {
        const since = new Date(now.getTime() - 30 * MS_PER_DAY);
        const [bots, runs, balance] = await Promise.all([
          prisma.bot.findMany({
            where: { spaceId: row.organizationId, archivedAt: null },
            select: { name: true },
            orderBy: { createdAt: "asc" },
            take: 50,
          }),
          prisma.run.count({ where: { spaceId: row.organizationId, createdAt: { gte: since } } }),
          partner.billingModel === "commerce" ? balanceFor(partner, row, now) : null,
        ]);
        return {
          agents: bots.map((bot) => bot.name),
          runs30d: runs,
          planRemaining: balance?.plan.remainingMinor ?? row.creditRemaining,
          topupRemaining: balance?.topup.remainingMinor ?? 0,
          periodEnd: balance?.periodEnd ?? null,
        };
      }),

    setTenantState: (partner, row, state) =>
      system(async () => {
        await setPartnerTenantState(prisma, partner.id, row.externalTenantId, state);
      }),

    addCredit: (partner, row, input, now) =>
      system(async () => {
        try {
          if (partner.billingModel === "commerce") {
            await addTenantCredit(
              prisma,
              { id: partner.id, currency: partner.currency, commissionBps: partner.commissionBps },
              {
                id: row.tenantId,
                organizationId: row.organizationId,
                externalTenantId: row.externalTenantId,
                state: row.state === "paused" ? "suspended" : "enabled",
              },
              { amountMinor: input.amountMinor, idempotencyKey: input.key },
              now,
            );
          } else {
            await addPartnerAllowance(
              prisma,
              {
                organizationId: row.organizationId,
                partnerId: partner.id,
                externalTenantId: row.externalTenantId,
              },
              { amountCents: input.amountMinor, period: periodLabel(now), key: input.key },
            );
          }
        } catch (error) {
          if (error instanceof CommerceError) throw new PartnerConsoleError("refused", error.code);
          if (error instanceof PartnerAllowanceRefused) {
            throw new PartnerConsoleError("refused", `allowance_${error.reason}`);
          }
          throw error;
        }
      }),

    createEntryCode: (input) =>
      system(async () => {
        await purgeExpiredEntryCodes(prisma);
        await prisma.partnerEntryCode.create({
          data: {
            codeHash: input.codeHash,
            partnerId: input.partnerId,
            tenantId: input.tenantId,
            // Marks the code as made by a person in the console, for audit; never an address.
            externalUserId: `console:${input.actorUserId ?? "agent"}`,
            expiresAt: input.expiresAt,
          },
        });
      }),

    idempotent: (partnerId, key, hash, run) =>
      system(() => runIdempotent(prisma, partnerId, key, hash, run)),

    catalog: (partner) => system(() => readCatalog(prisma, partner.currency)),

    markups: (partnerId) => system(() => readPartnerMarkups(prisma, partnerId)),

    replaceMarkups: (partnerId, changes) =>
      system(async () => {
        await prisma.$transaction(
          changes.map((change) =>
            change.value === 0
              ? prisma.partnerMarkup.deleteMany({
                  where: { partnerId, itemKind: change.itemKind, itemKey: change.itemKey },
                })
              : prisma.partnerMarkup.upsert({
                  where: {
                    partnerId_itemKind_itemKey: {
                      partnerId,
                      itemKind: change.itemKind,
                      itemKey: change.itemKey,
                    },
                  },
                  create: {
                    partnerId,
                    itemKind: change.itemKind,
                    itemKey: change.itemKey,
                    kind: change.kind,
                    value: change.value,
                  },
                  update: { kind: change.kind, value: change.value },
                }),
          ),
        );
      }),

    setCheckoutUrl: (partner, url) =>
      system(async () => {
        await configurePartnerCommerce(prisma, partner.slug, { checkoutUrl: url });
      }),

    revenueEntries: (partnerId, period) =>
      system(async () => {
        const entries = await prisma.revenueShareEntry.findMany({
          where: { partnerId, period },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 5000,
        });
        const tenants = await prisma.partnerTenant.findMany({
          where: {
            partnerId,
            id: { in: [...new Set(entries.map((entry) => entry.partnerTenantId))] },
          },
          select: { id: true, organization: { select: { name: true } } },
        });
        const names = new Map(tenants.map((tenant) => [tenant.id, tenant.organization.name]));
        return entries.map((entry) => ({
          id: entry.id,
          createdAt: entry.createdAt,
          tenantId: entry.partnerTenantId,
          tenantName: names.get(entry.partnerTenantId) ?? "",
          kind: entry.kind,
          baseMinor: entry.baseMinor,
          rookShareMinor: entry.rookShareMinor,
          partnerCommissionMinor: entry.partnerCommissionMinor,
          markupMinor: entry.markupMinor,
          paidMinor: entry.paidMinor,
        }));
      }),

    monthlyRevenue: (partnerId, periods) =>
      system(async () => {
        const rows = await prisma.revenueShareEntry.groupBy({
          by: ["period"],
          where: { partnerId, period: { in: periods } },
          _sum: { partnerCommissionMinor: true, markupMinor: true },
        });
        return new Map(
          rows.map((row) => [
            row.period,
            {
              commissionMinor: row._sum.partnerCommissionMinor ?? 0,
              markupMinor: row._sum.markupMinor ?? 0,
            },
          ]),
        );
      }),

    invoices: (partnerId, limit) =>
      system(async () => {
        const rows = await prisma.partnerInvoice.findMany({
          where: { partnerId },
          orderBy: [{ period: "desc" }, { createdAt: "desc" }],
          take: limit,
        });
        return rows.map((row) => ({
          id: row.id,
          period: row.period,
          state: row.state as "draft" | "issued" | "paid" | "void",
          totalMinor: row.totalMinor,
          issuedAt: row.issuedAt,
        }));
      }),

    creditUsage: (partner, now) =>
      system(async () => {
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const [row, tenants, walletOrganization] = await Promise.all([
          prisma.partner.findUniqueOrThrow({
            where: { id: partner.id },
            select: {
              creditAllowedModels: true,
              autoTopupEnabled: true,
              autoTopupThresholdCredits: true,
              autoTopupAmountMinor: true,
            },
          }),
          prisma.partnerTenant.findMany({
            where: { partnerId: partner.id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: MAX_CUSTOMERS,
            select: {
              id: true,
              organizationId: true,
              creditLimitCredits: true,
              organization: { select: { name: true } },
            },
          }),
          partnerWalletOrganization(prisma, partner.id),
        ]);
        const [spent, account] = await Promise.all([
          prisma.modelCreditEntry.groupBy({
            by: ["organizationId", "model"],
            where: {
              organizationId: { in: tenants.map((tenant) => tenant.organizationId) },
              amountMicros: { lt: 0n },
              createdAt: { gte: monthStart },
            },
            _sum: { amountMicros: true },
          }),
          walletOrganization
            ? prisma.modelCreditAccount.findUnique({
                where: { organizationId: walletOrganization },
                select: { balanceMicros: true },
              })
            : null,
        ]);
        const credits = (micros: bigint) => Number(micros / CREDIT_MICROS);
        return {
          // The fund is one wallet: plan credits and top-ups are told apart once a partner plan is billed.
          planCredits: 0,
          topupCredits: credits(account?.balanceMicros ?? 0n),
          customers: tenants.map((tenant) => {
            const byResource: Record<string, number> = {};
            let used = 0;
            for (const entry of spent) {
              if (entry.organizationId !== tenant.organizationId) continue;
              const amount = credits(-(entry._sum.amountMicros ?? 0n));
              byResource[entry.model ?? "other"] =
                (byResource[entry.model ?? "other"] ?? 0) + amount;
              used += amount;
            }
            return {
              tenantId: tenant.id,
              name: tenant.organization.name,
              usedCredits: used,
              limitCredits: tenant.creditLimitCredits,
              byResource,
            };
          }),
          autoTopup: {
            enabled: row.autoTopupEnabled,
            thresholdCredits: row.autoTopupThresholdCredits,
            amountMinor: row.autoTopupAmountMinor,
          },
          allowedModels: row.creditAllowedModels,
        };
      }),

    setCustomerLimit: (partner, row, limit) =>
      system(async () => {
        await prisma.partnerTenant.updateMany({
          where: { id: row.tenantId, partnerId: partner.id },
          data: { creditLimitCredits: limit },
        });
      }),

    setAllowedModels: (partner, models) =>
      system(async () => {
        await prisma.partner.update({
          where: { id: partner.id },
          data: { creditAllowedModels: { set: models } },
        });
      }),

    setAutoTopup: (partner, input) =>
      system(async () => {
        await prisma.partner.update({
          where: { id: partner.id },
          data: {
            autoTopupEnabled: input.enabled,
            autoTopupThresholdCredits: input.thresholdCredits,
            autoTopupAmountMinor: input.amountMinor,
          },
        });
      }),

    keyIssuedAt: (partner) =>
      system(async () => {
        const last = await prisma.partnerAuditEvent.findFirst({
          where: { partnerId: partner.id, kind: "key.rotated" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        return last?.createdAt ?? partner.createdAt;
      }),

    rotateKey: (partner) =>
      system(async () => {
        const { key, partner: updated } = await rotatePartnerKey(prisma, partner.slug);
        return { key, prefix: updated.keyPrefix };
      }),

    setWebhookUrl: (partner, url) =>
      system(async () => {
        await setPartnerWebhookUrl(prisma, partner.slug, url);
      }),

    setTemplate: (partner, template) =>
      system(() => setPartnerTemplateById(prisma, partner.id, template)),

    audit: (event) =>
      system(async () => {
        await prisma.partnerAuditEvent.create({
          data: {
            partnerId: event.partnerId,
            actorUserId: event.actorUserId,
            kind: event.kind,
            tenantId: event.tenantId ?? null,
            detail: event.detail as never,
          },
        });
      }),
  };
}
