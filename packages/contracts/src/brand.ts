import { contrastRatio, normalizeHex, webDarkTokens, webLightTokens } from "@corvo/ui-tokens";
import { z } from "zod";

/**
 * White label branding (docs/partner-commerce.md, section 8): what a partner's app looks like on
 * its own host, and the console that edits it. The host decides the brand, never a parameter.
 */

const Id = z.string().min(1).max(128);

/** The lowest contrast WCAG asks of a UI component against what it sits on (1.4.11). */
export const MIN_ACCENT_CONTRAST = 3;

export interface AccentCheck {
  hex: string;
  /** Against the page in the light and in the dark theme. */
  light: number;
  dark: number;
  ok: boolean;
}

/** An accent has to stand out from the page in both themes, because one value serves both. */
export function checkAccent(value: string): AccentCheck | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  const light = contrastRatio(hex, webLightTokens.background);
  const dark = contrastRatio(hex, webDarkTokens.background);
  return { hex, light, dark, ok: light >= MIN_ACCENT_CONTRAST && dark >= MIN_ACCENT_CONTRAST };
}

const RESERVED_SUFFIXES = [".local", ".internal", ".localhost"];

/**
 * A hostname a partner may serve its app on: lower case, at least two labels, no port, no
 * wildcard and no address. Null when it is not one.
 */
export function normalizeHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    host.length > 253 ||
    !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
  )
    return null;
  if (/^[0-9.]+$/.test(host)) return null;
  if (host === "localhost" || RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix)))
    return null;
  return host;
}

const HttpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "https address");

export const BRAND_ASSET_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** A logo or icon is small on purpose: it is served on every page load and in every email. */
export const BRAND_ASSET_MAX_BYTES = 256 * 1024;

export const BrandAssetInput = z
  .object({
    mimeType: z.enum(BRAND_ASSET_TYPES),
    /** The image bytes, base64. */
    dataBase64: z.string().max(Math.ceil((BRAND_ASSET_MAX_BYTES * 4) / 3) + 8),
  })
  .strict();
export type BrandAssetInput = z.infer<typeof BrandAssetInput>;

const AppName = z.string().trim().min(1).max(40);

/** What the app on a partner's host reads at boot. Null fields keep the app's own look. */
export const PublicBrandSchema = z.object({
  name: z.string(),
  accent: z.string().nullable(),
  logoUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  supportEmail: z.string().nullable(),
  termsUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
});
export type PublicBrand = z.infer<typeof PublicBrandSchema>;

export const PublicBrandResponseSchema = z.object({ brand: PublicBrandSchema.nullable() });
export type PublicBrandResponse = z.infer<typeof PublicBrandResponseSchema>;

export const SENDER_STATES = ["none", "pending", "verified", "failed"] as const;
export const DOMAIN_STATES = ["pending", "verified", "active", "failed"] as const;
export type DomainState = (typeof DOMAIN_STATES)[number];
export type SenderState = (typeof SENDER_STATES)[number];

export const DnsRecordSchema = z.object({
  type: z.string(),
  name: z.string(),
  value: z.string(),
  /** The provider's own word for the record's state, such as "verified" or "pending". */
  status: z.string(),
});
export type DnsRecord = z.infer<typeof DnsRecordSchema>;

export const PartnerBrandSchema = z.object({
  appName: z.string(),
  accent: z.string().nullable(),
  supportEmail: z.string().nullable(),
  termsUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
  logoUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
});

export const PartnerBrandInput = z
  .object({
    partnerId: Id,
    appName: AppName,
    accent: z
      .string()
      .trim()
      .nullable()
      .refine((value) => value === null || checkAccent(value)?.ok === true, "accent contrast"),
    supportEmail: z.string().trim().email().max(254).nullable(),
    termsUrl: HttpsUrl.nullable(),
    privacyUrl: HttpsUrl.nullable(),
    /** Set to replace the image, null to remove it, left out to keep it. */
    logo: BrandAssetInput.nullable().optional(),
    icon: BrandAssetInput.nullable().optional(),
  })
  .strict();

/** The one thing the partner has to do next, so the console can say it in a sentence. */
export const DomainNextSteps = [
  "add_cname",
  "wait",
  "add_legal_links",
  "fix_error",
  "none",
] as const;

export const PartnerDomainSchema = z.object({
  hostname: z.string(),
  state: z.enum(DOMAIN_STATES),
  /** The exact record the partner creates at its DNS provider. */
  cname: z.object({ name: z.string(), target: z.string() }).nullable(),
  nextStep: z.enum(DomainNextSteps),
  error: z.string().nullable(),
});

export const PartnerSenderSchema = z.object({
  domain: z.string().nullable(),
  state: z.enum(SENDER_STATES),
  records: z.array(DnsRecordSchema),
  error: z.string().nullable(),
});

export const PartnerBrandingSchema = z.object({
  brand: PartnerBrandSchema.nullable(),
  /** False when the deployment has no domain provider, so no host can be added. */
  domainsAvailable: z.boolean(),
  domain: PartnerDomainSchema.nullable(),
  /** False when the deployment has no email-domain provider. */
  senderAvailable: z.boolean(),
  sender: PartnerSenderSchema,
});
export type PartnerBranding = z.infer<typeof PartnerBrandingSchema>;

export const PartnerHostnameInput = z.object({
  partnerId: Id,
  hostname: z.string().trim().min(3).max(253),
});

export const PartnerSenderInput = z.object({
  partnerId: Id,
  domain: z.string().trim().min(3).max(253).nullable(),
});

/** Read-only, for the platform owner: what a partner has set up. */
export const PlatformPartnerBrandingSchema = z.object({
  brand: PartnerBrandSchema.nullable(),
  domains: z.array(
    z.object({ hostname: z.string(), state: z.enum(DOMAIN_STATES), error: z.string().nullable() }),
  ),
  sender: PartnerSenderSchema,
  customers: z.number().int().nonnegative(),
});
