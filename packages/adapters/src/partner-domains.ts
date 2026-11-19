import type {
  CustomHostname,
  DomainProvider,
  EmailDomain,
  EmailDomainProvider,
} from "@corvo/adapter-kit";
import type { BrandingStore, BrandRecord, DomainRecord, HostState } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { ResendEmailDomains } from "./resend-email-domains.js";

/**
 * How a partner's hostname moves (docs/partner-commerce.md, section 8): `pending` until the
 * provider sees the CNAME, `verified` once it does and the certificate is being issued, `active`
 * when the certificate is live and the partner's terms and privacy links are set, `failed` when
 * the provider gives up. Pure, so the console and the reconciler agree.
 */
export interface HostTransition {
  state: HostState;
  error: string | null;
}

export function nextHostState(input: {
  current: HostState;
  /** What the provider reports; null when it no longer knows the hostname. */
  provider: CustomHostname | null;
  /** Terms and privacy links are set, which activation requires. */
  legalLinks: boolean;
}): HostTransition {
  const { current, provider, legalLinks } = input;
  if (!provider) return { state: "failed", error: "The domain provider no longer has this host." };
  switch (provider.status) {
    case "failed":
      return { state: "failed", error: provider.error ?? "The domain provider gave up." };
    case "active":
      return legalLinks ? { state: "active", error: null } : { state: "verified", error: null };
    case "verified":
      // A live host is not taken offline because the provider is renewing its certificate.
      return { state: current === "active" ? "active" : "verified", error: null };
    default:
      return { state: current === "active" ? "active" : "pending", error: null };
  }
}

/** The one thing a partner has to do next, for the console to say in a sentence. */
export function nextHostStep(
  host: Pick<DomainRecord, "state" | "lastError"> | null,
  legalLinks: boolean,
): "add_cname" | "wait" | "add_legal_links" | "fix_error" | "none" {
  if (!host) return "none";
  if (host.state === "failed") return "fix_error";
  if (host.state === "active") return "none";
  if (host.state === "verified" && !legalLinks) return "add_legal_links";
  if (host.state === "verified") return "wait";
  return "add_cname";
}

export const hasLegalLinks = (brand: Pick<BrandRecord, "termsUrl" | "privacyUrl"> | null) =>
  Boolean(brand?.termsUrl && brand.privacyUrl);

/** Polls the provider for one hostname and records where it stands. */
export async function refreshHost(
  deps: { store: BrandingStore; domains: DomainProvider; now(): Date },
  host: DomainRecord,
): Promise<DomainRecord> {
  const brand = await deps.store.brand(host.partnerId);
  const provider = host.providerId ? await deps.domains.get(host.providerId) : null;
  const next = nextHostState({
    current: host.state,
    provider,
    legalLinks: hasLegalLinks(brand),
  });
  const now = deps.now();
  const patch = {
    state: next.state,
    lastError: next.error,
    lastCheckedAt: now,
    ...(next.state === "active" && host.state !== "active" ? { activatedAt: now } : {}),
  };
  await deps.store.updateDomain(host.id, patch);
  return { ...host, ...patch };
}

/** Asks the email service about a partner's sender domain and records where it stands. */
export async function refreshSender(
  deps: { store: BrandingStore; senderDomains: EmailDomainProvider; now(): Date },
  brand: BrandRecord,
): Promise<void> {
  if (!brand.senderProviderId || !brand.senderDomain) return;
  const domain: EmailDomain = await deps.senderDomains.verify(brand.senderProviderId);
  await deps.store.saveSender(brand.partnerId, {
    senderDomain: brand.senderDomain,
    senderState: domain.status,
    senderProviderId: brand.senderProviderId,
    senderRecords: domain.records,
    senderError: domain.status === "failed" ? "The records were not found." : null,
    checkedAt: deps.now(),
  });
}

/** Sender-domain verification at the Resend-compatible service that already sends the mail. */
export function senderDomainProviderFromEnv(env: {
  emailProvider?: string | undefined;
  emailApiKey?: string | undefined;
  emailApiUrl?: string | undefined;
}): EmailDomainProvider | undefined {
  if (env.emailProvider !== "resend" || !env.emailApiKey) return undefined;
  return new ResendEmailDomains({ apiKey: env.emailApiKey, endpoint: env.emailApiUrl });
}

const POLL_MS: Record<HostState, number> = {
  pending: 0,
  verified: 0,
  failed: 60 * 60_000,
  // A certificate is renewed by the provider; looking now and then catches one that lapsed.
  active: 6 * 60 * 60_000,
};
const SENDER_FAILED_MS = 60 * 60_000;
const BATCH = 50;

/**
 * Periodic: moves every hostname and sender domain along. A provider that cannot be reached
 * leaves a record as it was; only the provider saying so fails a hostname.
 */
export function createPartnerDomainReconciler(deps: {
  store: BrandingStore;
  domains?: DomainProvider | undefined;
  senderDomains?: EmailDomainProvider | undefined;
  now?: () => Date;
}) {
  const clock = deps.now ?? (() => new Date());
  return async () => {
    const now = clock();
    if (deps.domains) {
      const provider = deps.domains;
      const due = (await deps.store.allDomains())
        .filter(
          (host) =>
            host.providerId &&
            (!host.lastCheckedAt ||
              now.getTime() - host.lastCheckedAt.getTime() >= POLL_MS[host.state]),
        )
        .slice(0, BATCH);
      for (const host of due) {
        await refreshHost({ store: deps.store, domains: provider, now: clock }, host).catch(
          (error) => getLogger().error("partner domain refresh", error),
        );
      }
    }
    if (deps.senderDomains) {
      const senderDomains = deps.senderDomains;
      for (const brand of (await deps.store.openSenders()).slice(0, BATCH)) {
        if (
          brand.senderState === "failed" &&
          brand.senderCheckedAt &&
          now.getTime() - brand.senderCheckedAt.getTime() < SENDER_FAILED_MS
        )
          continue;
        await refreshSender({ store: deps.store, senderDomains, now: clock }, brand).catch(
          (error) => getLogger().error("partner sender domain refresh", error),
        );
      }
    }
  };
}
