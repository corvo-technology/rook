import type { MailBrand } from "@corvo/auth";
import type { BrandingStore, BrandRecord } from "@corvo/db";
import type { HostBrandResolver } from "./host-brand.js";
import { assetPath } from "./service.js";

/** A display name that cannot break out of the header it is put in. */
function displayName(name: string): string {
  return name
    .replace(/["<>\r\n,;\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The bare address of a configured sender, `Name <a@b>` or `a@b`; undefined when there is none. */
export function senderAddress(from: string | undefined): string | undefined {
  const value = from?.trim();
  if (!value) return undefined;
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(value)?.[1];
  const bare = /^[^<>\s]+@[^<>\s]+$/.test(value) ? value : undefined;
  return angle ?? bare;
}

/**
 * Who a partner's mail comes from. Once the partner's own mail domain is verified it is that
 * domain; until then it is Rook's address under the partner's display name, so the customer
 * never sees Rook's name and the receiving server never sees a domain nobody proved.
 */
export function partnerSender(
  brand: Pick<BrandRecord, "appName" | "senderDomain" | "senderState">,
  rookFrom: string | undefined,
): string | undefined {
  const name = displayName(brand.appName);
  if (brand.senderState === "verified" && brand.senderDomain)
    return `${name} <noreply@${brand.senderDomain}>`;
  const address = senderAddress(rookFrom);
  return address ? `${name} <${address}>` : undefined;
}

export interface PartnerMailDeps {
  store: Pick<BrandingStore, "customerBrand" | "linkCustomer">;
  resolver: HostBrandResolver;
  webOrigin: string;
  /** The deployment's own sender, whose address partners borrow until their domain is verified. */
  rookFrom: string | undefined;
  /** The organization of the account with this address, if any. */
  organizationOfEmail(email: string): Promise<string | null>;
  /** The organization a space belongs to. */
  organizationOfSpace(spaceId: string): Promise<string | null>;
}

/** The pieces of the sign-in and mail flows that know about partners; the auth package knows none. */
export function createPartnerMail(deps: PartnerMailDeps) {
  const build = (partnerId: string, brand: BrandRecord, hostname: string | null): MailBrand => {
    const origin = hostname ? `https://${hostname}` : deps.webOrigin;
    const logo = assetPath(partnerId, brand.logoKey);
    const from = partnerSender(brand, deps.rookFrom);
    return {
      brand: {
        name: brand.appName,
        logoUrl: logo ? new URL(logo, origin).href : null,
        accent: brand.accent,
        supportEmail: brand.supportEmail,
        termsUrl: brand.termsUrl,
        privacyUrl: brand.privacyUrl,
      },
      origin,
      ...(from ? { from } : {}),
    };
  };
  const forOrganization = async (organizationId: string | null) => {
    if (!organizationId) return undefined;
    const found = await deps.store.customerBrand(organizationId);
    return found ? build(found.partnerId, found.brand, found.hostname) : undefined;
  };
  return {
    /** The host decides first; otherwise the customer's own partner, when asked by address. */
    async mailBrand(input: { host: string | null; email: string | null }) {
      const hosted = await deps.resolver.resolve(input.host);
      if (hosted) return build(hosted.partnerId, hosted.brand, hosted.hostname);
      return input.email ? forOrganization(await deps.organizationOfEmail(input.email)) : undefined;
    },
    async mailBrandForSpace(spaceId: string) {
      return forOrganization(await deps.organizationOfSpace(spaceId));
    },
    /** Only an active partner host is trusted as an origin for sign-in. */
    async hostOrigins(host: string | null): Promise<string[]> {
      const hosted = await deps.resolver.resolve(host);
      return hosted ? [`https://${hosted.hostname}`] : [];
    },
    /** A signup on a partner host makes the organization that partner's customer, once. */
    async onSignup(input: { organizationId: string; host: string | null }): Promise<void> {
      const hosted = await deps.resolver.resolve(input.host);
      if (!hosted) return;
      await deps.store.linkCustomer({
        partnerId: hosted.partnerId,
        organizationId: input.organizationId,
        hostname: hosted.hostname,
      });
    },
  };
}
