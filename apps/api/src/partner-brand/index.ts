import type { DomainProvider, EmailDomainProvider, ObjectStorage } from "@corvo/adapter-kit";
import type { BrandingStore, PrismaClient } from "@corvo/db";
import { createPrismaBrandingStore, runAsSystem } from "@corvo/db";
import { BrandAssetStore } from "./assets.js";
import type { HostBrandResolver } from "./host-brand.js";
import { createHostBrandResolver } from "./host-brand.js";
import { createPartnerMail } from "./mail.js";

export * from "./assets.js";
export * from "./host-brand.js";
export * from "./mail.js";
export * from "./routes.js";
export * from "./service.js";

/** Everything the API needs for white label, built once where the app is composed. */
export interface PartnerBranding {
  store: BrandingStore;
  resolver: HostBrandResolver;
  assets: BrandAssetStore;
  domains: DomainProvider | undefined;
  senderDomains: EmailDomainProvider | undefined;
  /** Hosts the deployment itself serves, which no partner may claim. */
  reservedHosts: string[];
  mail: ReturnType<typeof createPartnerMail>;
}

export function createPartnerBranding(deps: {
  prisma: PrismaClient;
  storage: ObjectStorage | undefined;
  dataDir: string;
  webOrigin: string;
  emailFrom: string | undefined;
  domains: DomainProvider | undefined;
  senderDomains: EmailDomainProvider | undefined;
  store?: BrandingStore;
}): PartnerBranding {
  const store = deps.store ?? createPrismaBrandingStore(deps.prisma);
  const resolver = createHostBrandResolver(store);
  const system = <T>(fn: () => Promise<T>) => runAsSystem("partner mail brand", fn);
  const mail = createPartnerMail({
    store,
    resolver,
    webOrigin: deps.webOrigin,
    rookFrom: deps.emailFrom,
    organizationOfEmail: (email) =>
      system(async () => {
        const customer = await deps.prisma.partnerCustomer.findFirst({
          where: { organization: { members: { some: { user: { email: email.toLowerCase() } } } } },
          select: { organizationId: true },
        });
        return customer?.organizationId ?? null;
      }),
    organizationOfSpace: (spaceId) =>
      system(async () => {
        const space = await deps.prisma.space.findUnique({
          where: { id: spaceId },
          select: { organizationId: true },
        });
        return space?.organizationId ?? null;
      }),
  });
  return {
    store,
    resolver,
    assets: new BrandAssetStore(deps.storage, deps.dataDir),
    domains: deps.domains,
    senderDomains: deps.senderDomains,
    reservedHosts: [new URL(deps.webOrigin).hostname],
    mail,
  };
}
