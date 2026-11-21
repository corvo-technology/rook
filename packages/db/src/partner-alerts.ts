import type { AssistantUnavailableCause, PartnerAlertKind } from "@corvo/contracts";
import { PARTNER_ALERT_CODES, PARTNER_ALERT_KINDS, PARTNER_ALERT_SECTIONS } from "@corvo/contracts";
import { can } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import { resolveSpaceMemberships } from "./space-membership.js";

const isAlertKind = (kind: string): kind is PartnerAlertKind =>
  (PARTNER_ALERT_KINDS as readonly string[]).includes(kind);
const isUnique = (error: unknown) => (error as { code?: unknown })?.code === "P2002";
const BATCH = 500;

/**
 * Keeps a notice for the partner's people, once per partner, customer, kind and key. Kinds that
 * are not alerts are ignored. Returns whether it is new. Call with a client that runs as the system.
 */
export async function recordPartnerAlert(
  prisma: PrismaClient,
  partnerId: string,
  alert: {
    externalTenantId: string;
    kind: string;
    key: string;
    payload: Record<string, unknown>;
  },
): Promise<boolean> {
  if (!isAlertKind(alert.kind)) return false;
  try {
    await prisma.partnerAlert.create({
      data: {
        partnerId,
        externalTenantId: alert.externalTenantId,
        kind: alert.kind,
        key: alert.key,
        payload: alert.payload as never,
      },
    });
    return true;
  } catch (error) {
    if (isUnique(error)) return false;
    throw error;
  }
}

/**
 * Tells the partner of the customer that owns an organization that its assistant could not answer
 * and why, once per day and cause. Nothing happens for an organization that is not a partner's
 * customer. Call with a client that runs as the system.
 */
export async function recordAssistantUnavailable(
  prisma: PrismaClient,
  organizationId: string,
  cause: AssistantUnavailableCause,
  now = new Date(),
): Promise<boolean> {
  const tenant = await prisma.partnerTenant.findUnique({
    where: { organizationId },
    select: { partnerId: true, externalTenantId: true, testMode: true },
  });
  if (!tenant || tenant.testMode) return false;
  const day = now.toISOString().slice(0, 10);
  return recordPartnerAlert(prisma, tenant.partnerId, {
    externalTenantId: tenant.externalTenantId,
    kind: "customer.assistant_unavailable",
    key: `${day}:${cause}`,
    payload: { cause, day },
  });
}

/** A person who runs the partner, and the space the app shows them its alerts in. */
export interface PartnerManager {
  userId: string;
  spaceId: string;
  email: string;
  /** The language of their app, when it has told us. */
  locale: string | null;
}

/**
 * Everyone in the partner's organizations who holds `manage_partner` in a space of that
 * organization: the same people the console lets in. One entry per person.
 */
export async function partnerManagers(
  prisma: PrismaClient,
  partnerId: string,
): Promise<PartnerManager[]> {
  const organizations = await prisma.partnerMember.findMany({
    where: { partnerId },
    select: { organizationId: true },
  });
  if (organizations.length === 0) return [];
  const members = await prisma.spaceMember.findMany({
    where: {
      space: {
        organizationId: { in: organizations.map((row) => row.organizationId) },
        deletingAt: null,
      },
    },
    select: {
      spaceId: true,
      userId: true,
      role: true,
      space: { select: { isDefault: true } },
    },
    take: 2000,
  });
  const resolved = await resolveSpaceMemberships(
    prisma,
    members.map(({ spaceId, userId, role }) => ({ spaceId, userId, role })),
  );
  const chosen = new Map<string, (typeof members)[number]>();
  for (const member of members) {
    if (!can(resolved.get(`${member.spaceId}:${member.userId}`), "manage_partner")) continue;
    const current = chosen.get(member.userId);
    if (!current || (member.space.isDefault && !current.space.isDefault)) {
      chosen.set(member.userId, member);
    }
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...chosen.keys()] } },
    select: { id: true, email: true, pushToken: { select: { locale: true } } },
  });
  const userBy = new Map(users.map((user) => [user.id, user]));
  return [...chosen.values()].flatMap((member) => {
    const user = userBy.get(member.userId);
    return user
      ? [
          {
            userId: member.userId,
            spaceId: member.spaceId,
            email: user.email,
            locale: user.pushToken?.locale ?? null,
          },
        ]
      : [];
  });
}

/** One kind of alert in an email, with the customers it concerns by name. */
export interface PartnerDigestItem {
  kind: PartnerAlertKind;
  count: number;
  /** At most three customer names; only names, never anything a customer wrote. */
  names: string[];
}

export interface PartnerAlertDigest {
  to: string;
  locale: string | null;
  partner: { id: string; name: string; currency: string };
  items: PartnerDigestItem[];
  /** The console screen the one button opens, as a path in the app. */
  path: string;
}

export interface PartnerAlertDispatchResult {
  alerts: number;
  emails: number;
}

const consolePath = (partnerId: string, section: string, tenantId?: string) =>
  `/app/partner/${encodeURIComponent(partnerId)}/${section}${
    tenantId ? `?customer=${encodeURIComponent(tenantId)}` : ""
  }`;

/**
 * Tells the partner's people about each new alert: an inbox entry for every manager, always, and
 * one email per manager for the whole batch, for the kinds the partner has not switched off. An
 * alert is handled once, so a repeated call, or a second process, sends nothing twice. `send` is
 * the email adapter; without it only the inbox is written. Call with a client that runs as the
 * system.
 */
export async function dispatchPartnerAlerts(
  prisma: PrismaClient,
  deps: { send?: (digest: PartnerAlertDigest) => Promise<void>; now?: () => Date },
): Promise<PartnerAlertDispatchResult> {
  const now = deps.now?.() ?? new Date();
  const pending = await prisma.partnerAlert.findMany({
    where: { dispatchedAt: null },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  const result = { alerts: 0, emails: 0 };
  const byPartner = new Map<string, typeof pending>();
  for (const alert of pending) {
    byPartner.set(alert.partnerId, [...(byPartner.get(alert.partnerId) ?? []), alert]);
  }
  for (const [partnerId, found] of byPartner) {
    // Whoever claims an alert handles it; a competing process gets nothing for it.
    const claimed: typeof found = [];
    for (const alert of found) {
      const taken = await prisma.partnerAlert.updateMany({
        where: { id: alert.id, dispatchedAt: null },
        data: { dispatchedAt: now },
      });
      if (taken.count === 1 && isAlertKind(alert.kind)) claimed.push(alert);
    }
    if (claimed.length === 0) continue;
    result.alerts += claimed.length;
    const [partner, managers, preferences, tenants] = await Promise.all([
      prisma.partner.findUnique({
        where: { id: partnerId },
        select: { id: true, name: true, currency: true },
      }),
      partnerManagers(prisma, partnerId),
      prisma.partnerAlertPreference.findMany({ where: { partnerId } }),
      prisma.partnerTenant.findMany({
        where: {
          partnerId,
          externalTenantId: { in: [...new Set(claimed.map((alert) => alert.externalTenantId))] },
        },
        select: { id: true, externalTenantId: true, organization: { select: { name: true } } },
      }),
    ]);
    if (!partner) continue;
    const tenantBy = new Map(tenants.map((tenant) => [tenant.externalTenantId, tenant]));
    const emailOff = new Set(
      preferences.filter((row) => !row.email).map((row) => row.kind as string),
    );
    for (const manager of managers) {
      for (const alert of claimed) {
        const kind = alert.kind as PartnerAlertKind;
        const tenant = tenantBy.get(alert.externalTenantId);
        const name = tenant?.organization.name ?? "";
        const dedupeKey = `partner-alert:${alert.id}`;
        await prisma.notification.upsert({
          where: { userId_dedupeKey: { userId: manager.userId, dedupeKey } },
          create: {
            spaceId: manager.spaceId,
            userId: manager.userId,
            dedupeKey,
            kind: "alert",
            code: PARTNER_ALERT_CODES[kind],
            detail: `${partner.name}: ${kind}${name ? ` (${name})` : ""}`,
            params: {
              partnerId,
              partner: partner.name,
              section: PARTNER_ALERT_SECTIONS[kind],
              ...(tenant ? { tenantId: tenant.id } : {}),
              ...(name ? { name } : {}),
              ...(typeof (alert.payload as { cause?: unknown } | null)?.cause === "string"
                ? { cause: (alert.payload as { cause: string }).cause }
                : {}),
            },
          },
          update: {},
        });
      }
    }
    const emailed = claimed.filter((alert) => !emailOff.has(alert.kind));
    if (!deps.send || emailed.length === 0 || managers.length === 0) continue;
    const items: PartnerDigestItem[] = [];
    for (const alert of emailed) {
      const kind = alert.kind as PartnerAlertKind;
      const name = tenantBy.get(alert.externalTenantId)?.organization.name;
      let item = items.find((entry) => entry.kind === kind);
      if (!item) {
        item = { kind, count: 0, names: [] };
        items.push(item);
      }
      item.count += 1;
      if (name && item.names.length < 3) item.names.push(name);
    }
    // One screen when the batch is about one thing; the overview when it is about several.
    const sections = new Set(
      emailed.map((alert) => PARTNER_ALERT_SECTIONS[alert.kind as PartnerAlertKind]),
    );
    const only =
      emailed.length === 1 ? tenantBy.get(emailed[0]?.externalTenantId ?? "") : undefined;
    const section = sections.size === 1 ? ([...sections][0] ?? "overview") : "overview";
    const path = consolePath(partnerId, section, only?.id);
    let sent = false;
    for (const manager of managers) {
      try {
        await deps.send({ to: manager.email, locale: manager.locale, partner, items, path });
        sent = true;
        result.emails += 1;
      } catch {
        // One mailbox failing must not stop the others; the inbox entry is already there.
      }
    }
    if (sent) {
      await prisma.partnerAlert.updateMany({
        where: { id: { in: emailed.map((alert) => alert.id) } },
        data: { emailedAt: now },
      });
    }
  }
  return result;
}

/**
 * Notes, once per customer and day, each customer whose connector is failing its health check.
 * The state is read live, so nothing else records an outage.
 */
export async function claimConnectorDownAlerts(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  const partners = await prisma.partner.findMany({
    where: { enabled: true },
    select: { id: true, template: true },
    take: 100,
  });
  let made = 0;
  const day = now.toISOString().slice(0, 10);
  for (const partner of partners) {
    const slug = (partner.template as { connector?: { slug?: unknown } } | null)?.connector?.slug;
    if (typeof slug !== "string") continue;
    const tenants = await prisma.partnerTenant.findMany({
      where: { partnerId: partner.id, state: "enabled", testMode: false },
      select: { externalTenantId: true, organizationId: true },
      take: 1000,
    });
    if (tenants.length === 0) continue;
    const down = await prisma.mcpServer.findMany({
      where: {
        slug,
        enabled: true,
        healthStatus: "error",
        spaceId: { in: tenants.map((tenant) => tenant.organizationId) },
      },
      select: { spaceId: true },
    });
    const downSpaces = new Set(down.map((server) => server.spaceId));
    for (const tenant of tenants) {
      if (!downSpaces.has(tenant.organizationId)) continue;
      const added = await recordPartnerAlert(prisma, partner.id, {
        externalTenantId: tenant.externalTenantId,
        kind: "customer.connector_down",
        key: day,
        payload: { day },
      });
      if (added) made += 1;
    }
  }
  return made;
}

/** Whether each alert is also emailed to the partner's people; on unless switched off. */
export async function partnerAlertEmailSettings(prisma: PrismaClient, partnerId: string) {
  const off = new Set(
    (await prisma.partnerAlertPreference.findMany({ where: { partnerId, email: false } })).map(
      (row) => row.kind,
    ),
  );
  return PARTNER_ALERT_KINDS.map((kind) => ({ kind, email: !off.has(kind) }));
}

export async function setPartnerAlertEmail(
  prisma: PrismaClient,
  partnerId: string,
  kind: PartnerAlertKind,
  email: boolean,
): Promise<void> {
  await prisma.partnerAlertPreference.upsert({
    where: { partnerId_kind: { partnerId, kind } },
    create: { partnerId, kind, email },
    update: { email },
  });
}
