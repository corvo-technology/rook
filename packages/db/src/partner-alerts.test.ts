import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import type { PartnerAlertDigest } from "./partner-alerts.js";
import { dispatchPartnerAlerts, recordPartnerAlert } from "./partner-alerts.js";

const NOW = new Date("2026-11-18T12:00:00Z");

interface AlertRow {
  id: string;
  partnerId: string;
  externalTenantId: string;
  kind: string;
  key: string;
  payload: unknown;
  createdAt: Date;
  dispatchedAt: Date | null;
  emailedAt: Date | null;
}

/**
 * Two partners in two organizations. Org A has an owner and a plain member (who may not manage
 * partners); org B has its own owner. Only what the dispatch reads is modelled.
 */
function world(options: { emailOff?: string[] } = {}) {
  const alerts: AlertRow[] = [];
  const notifications = new Map<string, { userId: string; spaceId: string; code: string }>();
  const members = [
    { spaceId: "space-a", userId: "owner-a", role: "owner", email: "owner-a@example.test" },
    { spaceId: "space-a", userId: "member-a", role: "member", email: "member-a@example.test" },
    { spaceId: "space-b", userId: "owner-b", role: "owner", email: "owner-b@example.test" },
  ].map((member) => ({
    ...member,
    space: { isDefault: true, organizationId: member.spaceId === "space-a" ? "org-a" : "org-b" },
  }));
  const partnerMembers = [
    { partnerId: "partner-a", organizationId: "org-a" },
    { partnerId: "partner-b", organizationId: "org-b" },
  ];
  const tenants = [
    {
      id: "t1",
      partnerId: "partner-a",
      externalTenantId: "shop-1",
      organization: { name: "Shop 1" },
    },
    {
      id: "t2",
      partnerId: "partner-a",
      externalTenantId: "shop-2",
      organization: { name: "Shop 2" },
    },
    {
      id: "t3",
      partnerId: "partner-a",
      externalTenantId: "shop-3",
      organization: { name: "Shop 3" },
    },
    {
      id: "t4",
      partnerId: "partner-a",
      externalTenantId: "shop-4",
      organization: { name: "Shop 4" },
    },
  ];
  const prisma = {
    partnerAlert: {
      create: async ({ data }: { data: Omit<AlertRow, "id" | "createdAt"> }) => {
        const duplicate = alerts.some(
          (row) =>
            row.partnerId === data.partnerId &&
            row.externalTenantId === data.externalTenantId &&
            row.kind === data.kind &&
            row.key === data.key,
        );
        if (duplicate) throw Object.assign(new Error("unique"), { code: "P2002" });
        alerts.push({
          ...data,
          id: `alert-${alerts.length + 1}`,
          createdAt: NOW,
          dispatchedAt: null,
          emailedAt: null,
        });
      },
      findMany: async () => alerts.filter((row) => row.dispatchedAt === null),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string | { in: string[] }; dispatchedAt?: null };
        data: Partial<AlertRow>;
      }) => {
        const ids = typeof where.id === "string" ? [where.id] : where.id.in;
        const rows = alerts.filter(
          (row) =>
            ids.includes(row.id) && (where.dispatchedAt !== null || row.dispatchedAt === null),
        );
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
    },
    partner: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: where.id === "partner-a" ? "Acme" : "Other",
        currency: "BRL",
      }),
    },
    partnerMember: {
      findMany: async ({ where }: { where: { partnerId: string } }) =>
        partnerMembers.filter((row) => row.partnerId === where.partnerId),
    },
    spaceMember: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const space = where.space as { organizationId: { in: string[] } } | undefined;
        if (space) {
          return members.filter((member) =>
            space.organizationId.in.includes(member.space.organizationId),
          );
        }
        return members.map((member) => ({ ...member, roles: [] }));
      },
    },
    spaceRole: { findMany: async () => [] },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        members
          .filter((member) => where.id.in.includes(member.userId))
          .map((member) => ({ id: member.userId, email: member.email, pushToken: null })),
    },
    partnerAlertPreference: {
      findMany: async () => (options.emailOff ?? []).map((kind) => ({ kind, email: false })),
    },
    partnerTenant: {
      findMany: async ({
        where,
      }: {
        where: { partnerId: string; externalTenantId: { in: string[] } };
      }) =>
        tenants.filter(
          (tenant) =>
            tenant.partnerId === where.partnerId &&
            where.externalTenantId.in.includes(tenant.externalTenantId),
        ),
    },
    notification: {
      upsert: async ({
        where,
        create,
      }: {
        where: { userId_dedupeKey: { userId: string; dedupeKey: string } };
        create: { userId: string; spaceId: string; code: string };
      }) => {
        const key = `${where.userId_dedupeKey.userId}:${where.userId_dedupeKey.dedupeKey}`;
        if (!notifications.has(key)) notifications.set(key, create);
      },
    },
  } as unknown as PrismaClient;
  const record = (
    partnerId: string,
    kind: string,
    externalTenantId: string,
    key = "2026-11",
    payload: Record<string, unknown> = {},
  ) => recordPartnerAlert(prisma, partnerId, { externalTenantId, kind, key, payload });
  return { prisma, alerts, notifications, record };
}

describe("partner alerts", () => {
  it("keeps one alert per partner, customer, kind and key, and ignores kinds that are not alerts", async () => {
    const { record, alerts } = world();
    expect(await record("partner-a", "customer.credit_limit_reached", "shop-1")).toBe(true);
    expect(await record("partner-a", "customer.credit_limit_reached", "shop-1")).toBe(false);
    expect(await record("partner-a", "customer.credit_limit_reached", "shop-1", "2026-12")).toBe(
      true,
    );
    expect(await record("partner-a", "credit.granted", "shop-1")).toBe(false);
    expect(alerts).toHaveLength(2);
  });

  it("reaches only the people who manage that partner, in the app and by email", async () => {
    const { prisma, record, notifications } = world();
    await record("partner-a", "partner.balance_low", "", "low:1");
    const sent: PartnerAlertDigest[] = [];
    const result = await dispatchPartnerAlerts(prisma, {
      now: () => NOW,
      send: async (digest) => void sent.push(digest),
    });
    expect(result).toEqual({ alerts: 1, emails: 1 });
    // The owner of org A, not a plain member of org A, and nobody from org B.
    expect(sent.map((digest) => digest.to)).toEqual(["owner-a@example.test"]);
    expect([...notifications.values()].map((row) => row.userId)).toEqual(["owner-a"]);
    expect([...notifications.values()][0]).toMatchObject({
      spaceId: "space-a",
      code: "partner_balance_low",
    });
  });

  it("handles an alert once, however often or from however many processes it runs", async () => {
    const { prisma, record, notifications } = world();
    await record("partner-a", "partner.balance_low", "", "low:1");
    const send = vi.fn(async () => undefined);
    await Promise.all([
      dispatchPartnerAlerts(prisma, { now: () => NOW, send }),
      dispatchPartnerAlerts(prisma, { now: () => NOW, send }),
    ]);
    await dispatchPartnerAlerts(prisma, { now: () => NOW, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(notifications.size).toBe(1);
  });

  it("turns a burst into one email per person, with the customers by name", async () => {
    const { prisma, record, notifications } = world();
    for (const shop of ["shop-1", "shop-2", "shop-3", "shop-4"]) {
      await record("partner-a", "customer.credit_limit_reached", shop);
    }
    const sent: PartnerAlertDigest[] = [];
    await dispatchPartnerAlerts(prisma, { now: () => NOW, send: async (d) => void sent.push(d) });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.items).toEqual([
      {
        kind: "customer.credit_limit_reached",
        count: 4,
        names: ["Shop 1", "Shop 2", "Shop 3"],
      },
    ]);
    expect(sent[0]?.path).toBe("/app/partner/partner-a/customers");
    // The inbox keeps one entry for each, so nothing is hidden by the digest.
    expect(notifications.size).toBe(4);
  });

  it("never carries what a customer wrote, even when the alert's data holds it", async () => {
    const { prisma, record, notifications } = world();
    await record("partner-a", "customer.credit_limit_reached", "shop-1", "2026-11", {
      message: "PRIVATE customer conversation",
    });
    const sent: PartnerAlertDigest[] = [];
    await dispatchPartnerAlerts(prisma, { now: () => NOW, send: async (d) => void sent.push(d) });
    expect(JSON.stringify([sent, [...notifications.values()]])).not.toContain("PRIVATE");
  });

  it("opens the customer when the email is about one", async () => {
    const { prisma, record } = world();
    await record("partner-a", "customer.credit_limit_reached", "shop-2");
    const sent: PartnerAlertDigest[] = [];
    await dispatchPartnerAlerts(prisma, { now: () => NOW, send: async (d) => void sent.push(d) });
    expect(sent[0]?.path).toBe("/app/partner/partner-a/customers?customer=t2");
  });

  it("falls back to the overview when one email covers several screens", async () => {
    const { prisma, record } = world();
    await record("partner-a", "partner.balance_low", "", "low:1");
    await record("partner-a", "invoice.issued", "", "2026-11:inv-1");
    const sent: PartnerAlertDigest[] = [];
    await dispatchPartnerAlerts(prisma, { now: () => NOW, send: async (d) => void sent.push(d) });
    expect(sent[0]?.path).toBe("/app/partner/partner-a/overview");
  });

  it("keeps the inbox entry but sends no email for a kind switched off", async () => {
    const { prisma, record, notifications } = world({ emailOff: ["partner.balance_low"] });
    await record("partner-a", "partner.balance_low", "", "low:1");
    await record("partner-a", "invoice.issued", "", "2026-11:inv-1");
    const sent: PartnerAlertDigest[] = [];
    await dispatchPartnerAlerts(prisma, { now: () => NOW, send: async (d) => void sent.push(d) });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.items.map((item) => item.kind)).toEqual(["invoice.issued"]);
    expect([...notifications.values()].map((row) => row.code).sort()).toEqual([
      "partner_balance_low",
      "partner_invoice_issued",
    ]);
  });

  it("writes only the inbox where no email is configured", async () => {
    const { prisma, record, notifications } = world();
    await record("partner-a", "partner.balance_low", "", "low:1");
    expect(await dispatchPartnerAlerts(prisma, { now: () => NOW })).toEqual({
      alerts: 1,
      emails: 0,
    });
    expect(notifications.size).toBe(1);
  });

  it("does not let one failing mailbox stop the inbox or the other emails", async () => {
    const { prisma, record, notifications } = world();
    await record("partner-a", "partner.balance_low", "", "low:1");
    const result = await dispatchPartnerAlerts(prisma, {
      now: () => NOW,
      send: async () => {
        throw new Error("mail is down");
      },
    });
    expect(result.emails).toBe(0);
    expect(notifications.size).toBe(1);
  });
});
