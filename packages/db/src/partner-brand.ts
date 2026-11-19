import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { attachWhiteLabelCustomer } from "./commerce-connect.js";
import { runAsSystem } from "./row-security.js";

/**
 * White label storage (docs/partner-commerce.md, section 8): a partner's brand, its hostnames and
 * the customers who signed up on them. Everything runs as the system, because the host that picks
 * a brand is read before anyone is signed in. The interface lets the service, the resolver and
 * the reconciler run against memory in tests and Postgres in production.
 */

export type HostState = "pending" | "verified" | "active" | "failed";
export type SenderStateValue = "none" | "pending" | "verified" | "failed";

export interface SenderRecord {
  type: string;
  name: string;
  value: string;
  status: string;
}

export interface BrandRecord {
  partnerId: string;
  appName: string;
  logoKey: string | null;
  iconKey: string | null;
  accent: string | null;
  supportEmail: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  senderDomain: string | null;
  senderState: SenderStateValue;
  senderProviderId: string | null;
  senderRecords: SenderRecord[];
  senderError: string | null;
  senderCheckedAt: Date | null;
}

export type BrandFields = Pick<
  BrandRecord,
  "appName" | "accent" | "supportEmail" | "termsUrl" | "privacyUrl"
> &
  Partial<Pick<BrandRecord, "logoKey" | "iconKey">>;

export type SenderFields = Pick<
  BrandRecord,
  "senderDomain" | "senderState" | "senderProviderId" | "senderRecords" | "senderError"
>;

export interface DomainRecord {
  id: string;
  partnerId: string;
  hostname: string;
  state: HostState;
  providerId: string | null;
  lastError: string | null;
  lastCheckedAt: Date | null;
  activatedAt: Date | null;
}

export type DomainPatch = Partial<
  Pick<DomainRecord, "state" | "providerId" | "lastError" | "lastCheckedAt" | "activatedAt">
>;

/** A brand together with the partner it belongs to. */
export interface PartnerBrandView {
  partnerId: string;
  brand: BrandRecord;
}

export class HostnameTakenError extends Error {
  constructor() {
    super("hostname_taken");
    this.name = "HostnameTakenError";
  }
}

export interface BrandingStore {
  brand(partnerId: string): Promise<BrandRecord | null>;
  /** Creates or replaces the brand's look; the sender domain is never touched here. */
  saveBrand(partnerId: string, fields: BrandFields): Promise<BrandRecord>;
  saveSender(partnerId: string, sender: SenderFields & { checkedAt: Date }): Promise<void>;
  domains(partnerId: string): Promise<DomainRecord[]>;
  /** Throws `HostnameTakenError` when any partner already holds the hostname. */
  createDomain(input: {
    partnerId: string;
    hostname: string;
    providerId: string | null;
  }): Promise<DomainRecord>;
  hostnameTaken(hostname: string): Promise<boolean>;
  updateDomain(id: string, patch: DomainPatch): Promise<void>;
  deleteDomain(id: string): Promise<void>;
  /** Every hostname, for the reconciler; the caller decides which are due. */
  allDomains(): Promise<DomainRecord[]>;
  /** Brands whose sender domain is not settled, for the reconciler. */
  openSenders(): Promise<BrandRecord[]>;
  /**
   * The brand of a host: only an `active` hostname of an enabled white label partner with a brand.
   * Any other host, registered or not, has none.
   */
  hostBrand(hostname: string): Promise<(PartnerBrandView & { hostname: string }) | null>;
  /** The brand of the partner an organization signed up through, and a host that serves it. */
  customerBrand(
    organizationId: string,
  ): Promise<(PartnerBrandView & { hostname: string | null }) | null>;
  /** Writes the link once; false when the organization is already linked, to any partner. */
  linkCustomer(input: {
    partnerId: string;
    organizationId: string;
    hostname: string;
  }): Promise<boolean>;
  customerCount(partnerId: string): Promise<number>;
  isWhiteLabel(partnerId: string): Promise<boolean>;
}

export function createPrismaBrandingStore(prisma: PrismaClient): BrandingStore {
  const system = <T>(fn: () => Promise<T>) => runAsSystem("partner branding", fn);
  const eligible = { enabled: true, mode: "white_label" } as const;
  return {
    brand: (partnerId) =>
      system(async () => {
        const row = await prisma.partnerBrand.findUnique({ where: { partnerId } });
        return row ? toBrand(row) : null;
      }),
    saveBrand: (partnerId, fields) =>
      system(async () => {
        const data = {
          appName: fields.appName,
          accent: fields.accent,
          supportEmail: fields.supportEmail,
          termsUrl: fields.termsUrl,
          privacyUrl: fields.privacyUrl,
          ...(fields.logoKey !== undefined ? { logoKey: fields.logoKey } : {}),
          ...(fields.iconKey !== undefined ? { iconKey: fields.iconKey } : {}),
        };
        return toBrand(
          await prisma.partnerBrand.upsert({
            where: { partnerId },
            create: { partnerId, ...data },
            update: data,
          }),
        );
      }),
    saveSender: (partnerId, sender) =>
      system(async () => {
        await prisma.partnerBrand.update({
          where: { partnerId },
          data: {
            senderDomain: sender.senderDomain,
            senderState: sender.senderState,
            senderProviderId: sender.senderProviderId,
            senderRecords: sender.senderRecords as unknown as Prisma.InputJsonValue,
            senderError: sender.senderError,
            senderCheckedAt: sender.checkedAt,
          },
        });
      }),
    domains: (partnerId) =>
      system(async () =>
        (
          await prisma.partnerDomain.findMany({
            where: { partnerId },
            orderBy: { createdAt: "asc" },
          })
        ).map(toDomain),
      ),
    createDomain: (input) =>
      system(async () => {
        try {
          return toDomain(await prisma.partnerDomain.create({ data: input }));
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new HostnameTakenError();
          }
          throw error;
        }
      }),
    hostnameTaken: (hostname) =>
      system(async () => Boolean(await prisma.partnerDomain.findUnique({ where: { hostname } }))),
    updateDomain: (id, patch) =>
      system(async () => {
        await prisma.partnerDomain.update({ where: { id }, data: patch });
      }),
    deleteDomain: (id) =>
      system(async () => {
        await prisma.partnerDomain.deleteMany({ where: { id } });
      }),
    allDomains: () =>
      system(async () => (await prisma.partnerDomain.findMany({ take: 500 })).map(toDomain)),
    openSenders: () =>
      system(async () =>
        (
          await prisma.partnerBrand.findMany({
            where: { senderState: { in: ["pending", "failed"] }, senderProviderId: { not: null } },
            take: 200,
          })
        ).map(toBrand),
      ),
    hostBrand: (hostname) =>
      system(async () => {
        const domain = await prisma.partnerDomain.findFirst({
          where: { hostname, state: "active", partner: eligible },
          select: { hostname: true, partner: { select: { id: true, brand: true } } },
        });
        const brand = domain?.partner.brand;
        return domain && brand
          ? { partnerId: domain.partner.id, hostname: domain.hostname, brand: toBrand(brand) }
          : null;
      }),
    customerBrand: (organizationId) =>
      system(async () => {
        const link = await prisma.partnerCustomer.findUnique({
          where: { organizationId },
          select: {
            partner: {
              select: {
                id: true,
                enabled: true,
                mode: true,
                brand: true,
                domains: { where: { state: "active" }, select: { hostname: true }, take: 1 },
              },
            },
          },
        });
        const partner = link?.partner;
        if (!partner?.brand || !partner.enabled || partner.mode !== "white_label") return null;
        return {
          partnerId: partner.id,
          brand: toBrand(partner.brand),
          hostname: partner.domains[0]?.hostname ?? null,
        };
      }),
    linkCustomer: (input) =>
      system(async () => {
        const result = await prisma.partnerCustomer.createMany({
          data: input,
          skipDuplicates: true,
        });
        if (result.count === 1) {
          // A white label customer is read-only until it has a plan: it needs its ledger row now.
          const partner = await prisma.partner.findUnique({ where: { id: input.partnerId } });
          if (partner?.mode === "white_label" && partner.billingModel === "commerce") {
            await attachWhiteLabelCustomer(prisma, input.partnerId, {
              organizationId: input.organizationId,
            });
          }
        }
        return result.count === 1;
      }),
    customerCount: (partnerId) =>
      system(() => prisma.partnerCustomer.count({ where: { partnerId } })),
    isWhiteLabel: (partnerId) =>
      system(async () =>
        Boolean(await prisma.partner.findFirst({ where: { id: partnerId, mode: "white_label" } })),
      ),
  };
}

function toBrand(row: {
  partnerId: string;
  appName: string;
  logoKey: string | null;
  iconKey: string | null;
  accent: string | null;
  supportEmail: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  senderDomain: string | null;
  senderState: string;
  senderProviderId: string | null;
  senderRecords: unknown;
  senderError: string | null;
  senderCheckedAt: Date | null;
}): BrandRecord {
  return {
    partnerId: row.partnerId,
    appName: row.appName,
    logoKey: row.logoKey,
    iconKey: row.iconKey,
    accent: row.accent,
    supportEmail: row.supportEmail,
    termsUrl: row.termsUrl,
    privacyUrl: row.privacyUrl,
    senderDomain: row.senderDomain,
    senderState: row.senderState as SenderStateValue,
    senderProviderId: row.senderProviderId,
    senderRecords: Array.isArray(row.senderRecords) ? (row.senderRecords as SenderRecord[]) : [],
    senderError: row.senderError,
    senderCheckedAt: row.senderCheckedAt,
  };
}

function toDomain(row: {
  id: string;
  partnerId: string;
  hostname: string;
  state: string;
  providerId: string | null;
  lastError: string | null;
  lastCheckedAt: Date | null;
  activatedAt: Date | null;
}): DomainRecord {
  return {
    id: row.id,
    partnerId: row.partnerId,
    hostname: row.hostname,
    state: row.state as HostState,
    providerId: row.providerId,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt,
    activatedAt: row.activatedAt,
  };
}

/** An in-memory store with the same rules, for tests that must stay offline. */
export function createMemoryBrandingStore(
  partners: Map<string, { enabled: boolean; mode: "embedded" | "white_label" }> = new Map(),
): BrandingStore & {
  partners: typeof partners;
  customers: Map<string, { partnerId: string; hostname: string }>;
} {
  const brands = new Map<string, BrandRecord>();
  const domains = new Map<string, DomainRecord>();
  const customers = new Map<string, { partnerId: string; hostname: string }>();
  let next = 1;
  const eligible = (partnerId: string) => {
    const partner = partners.get(partnerId);
    return Boolean(partner?.enabled && partner.mode === "white_label");
  };
  return {
    partners,
    customers,
    async brand(partnerId) {
      return brands.get(partnerId) ?? null;
    },
    async saveBrand(partnerId, fields) {
      const current = brands.get(partnerId);
      const saved: BrandRecord = {
        senderDomain: null,
        senderState: "none",
        senderProviderId: null,
        senderRecords: [],
        senderError: null,
        senderCheckedAt: null,
        logoKey: null,
        iconKey: null,
        ...current,
        partnerId,
        appName: fields.appName,
        accent: fields.accent,
        supportEmail: fields.supportEmail,
        termsUrl: fields.termsUrl,
        privacyUrl: fields.privacyUrl,
        ...(fields.logoKey !== undefined ? { logoKey: fields.logoKey } : {}),
        ...(fields.iconKey !== undefined ? { iconKey: fields.iconKey } : {}),
      };
      brands.set(partnerId, saved);
      return { ...saved };
    },
    async saveSender(partnerId, sender) {
      const current = brands.get(partnerId);
      if (!current) throw new Error("No brand");
      const { checkedAt, ...fields } = sender;
      brands.set(partnerId, { ...current, ...fields, senderCheckedAt: checkedAt });
    },
    async domains(partnerId) {
      return [...domains.values()]
        .filter((row) => row.partnerId === partnerId)
        .map((row) => ({ ...row }));
    },
    async createDomain(input) {
      if ([...domains.values()].some((row) => row.hostname === input.hostname))
        throw new HostnameTakenError();
      const row: DomainRecord = {
        id: `domain-${next++}`,
        ...input,
        state: "pending",
        lastError: null,
        lastCheckedAt: null,
        activatedAt: null,
      };
      domains.set(row.id, row);
      return { ...row };
    },
    async hostnameTaken(hostname) {
      return [...domains.values()].some((row) => row.hostname === hostname);
    },
    async updateDomain(id, patch) {
      const row = domains.get(id);
      if (row) domains.set(id, { ...row, ...patch });
    },
    async deleteDomain(id) {
      domains.delete(id);
    },
    async allDomains() {
      return [...domains.values()].map((row) => ({ ...row }));
    },
    async openSenders() {
      return [...brands.values()].filter(
        (brand) =>
          (brand.senderState === "pending" || brand.senderState === "failed") &&
          brand.senderProviderId,
      );
    },
    async hostBrand(hostname) {
      const domain = [...domains.values()].find(
        (row) => row.hostname === hostname && row.state === "active",
      );
      const brand = domain && eligible(domain.partnerId) ? brands.get(domain.partnerId) : undefined;
      return domain && brand
        ? { partnerId: domain.partnerId, hostname, brand: { ...brand } }
        : null;
    },
    async customerBrand(organizationId) {
      const link = customers.get(organizationId);
      const brand = link && eligible(link.partnerId) ? brands.get(link.partnerId) : undefined;
      if (!link || !brand) return null;
      const active = [...domains.values()].find(
        (row) => row.partnerId === link.partnerId && row.state === "active",
      );
      return { partnerId: link.partnerId, hostname: active?.hostname ?? null, brand: { ...brand } };
    },
    async linkCustomer(input) {
      if (customers.has(input.organizationId)) return false;
      customers.set(input.organizationId, { partnerId: input.partnerId, hostname: input.hostname });
      return true;
    },
    async customerCount(partnerId) {
      return [...customers.values()].filter((row) => row.partnerId === partnerId).length;
    },
    async isWhiteLabel(partnerId) {
      return partners.get(partnerId)?.mode === "white_label";
    },
  };
}
