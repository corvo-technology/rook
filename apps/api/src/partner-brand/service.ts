import type { DomainProvider, EmailDomainProvider } from "@corvo/adapter-kit";
import { hasLegalLinks, nextHostStep, refreshHost, refreshSender } from "@corvo/adapters";
import type { PartnerBranding } from "@corvo/contracts";
import { checkAccent, normalizeHostname } from "@corvo/contracts";
import type { BrandingStore, BrandRecord } from "@corvo/db";
import { HostnameTakenError } from "@corvo/db";
import type { PartnerConsoleDeps, PartnerRecord, PartnerScope } from "../partner-console/index.js";
import { PartnerConsoleError, requirePartner } from "../partner-console/index.js";
import type { BrandAssetKind } from "./assets.js";
import { BrandAssetError, type BrandAssetStore, decodeBrandAsset } from "./assets.js";

/**
 * The white label part of the partner console: the brand, the host and the mail domain. Like the
 * rest of the console it only reaches partners the caller's organization manages, and only those
 * that sell as white label.
 */
export interface BrandingDeps {
  store: BrandingStore;
  console: Pick<PartnerConsoleDeps["store"], "findPartner" | "audit">;
  assets: BrandAssetStore;
  domains?: DomainProvider | undefined;
  senderDomains?: EmailDomainProvider | undefined;
  /** Hosts the deployment itself serves: no partner may claim one. */
  reservedHosts: string[];
  now(): Date;
  /** Called after anything that changes what a host shows, so a cached brand is dropped. */
  changed?(): void;
}

export function assetPath(partnerId: string, key: string | null): string | null {
  return key ? `/api/brand/assets/${partnerId}/${key.split("/").pop()}` : null;
}

async function requireWhiteLabel(
  deps: BrandingDeps,
  scope: PartnerScope,
  partnerId: string,
): Promise<PartnerRecord> {
  const partner = await requirePartner(
    { store: deps.console } as PartnerConsoleDeps,
    scope,
    partnerId,
  );
  if (partner.mode !== "white_label") throw new PartnerConsoleError("refused", "not_white_label");
  return partner;
}

export async function brandingView(
  deps: BrandingDeps,
  partnerId: string,
): Promise<PartnerBranding> {
  const [brand, hosts] = await Promise.all([
    deps.store.brand(partnerId),
    deps.store.domains(partnerId),
  ]);
  const host = hosts[0] ?? null;
  const legal = hasLegalLinks(brand);
  return {
    brand: brand && {
      appName: brand.appName,
      accent: brand.accent,
      supportEmail: brand.supportEmail,
      termsUrl: brand.termsUrl,
      privacyUrl: brand.privacyUrl,
      logoUrl: assetPath(partnerId, brand.logoKey),
      iconUrl: assetPath(partnerId, brand.iconKey),
    },
    domainsAvailable: Boolean(deps.domains),
    domain: host && {
      hostname: host.hostname,
      state: host.state,
      cname: deps.domains ? { name: host.hostname, target: deps.domains.fallbackHostname() } : null,
      nextStep: nextHostStep(host, legal),
      error: host.lastError,
    },
    senderAvailable: Boolean(deps.senderDomains),
    sender: {
      domain: brand?.senderDomain ?? null,
      state: brand?.senderState ?? "none",
      records: brand?.senderRecords ?? [],
      error: brand?.senderError ?? null,
    },
  };
}

export async function getBranding(
  deps: BrandingDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<PartnerBranding> {
  await requireWhiteLabel(deps, scope, input.partnerId);
  return brandingView(deps, input.partnerId);
}

interface AssetChange {
  kind: BrandAssetKind;
  /** undefined keeps the image, null removes it. */
  input: { mimeType: string; dataBase64: string } | null | undefined;
}

export async function saveBrand(
  deps: BrandingDeps,
  scope: PartnerScope,
  input: {
    partnerId: string;
    appName: string;
    accent: string | null;
    supportEmail: string | null;
    termsUrl: string | null;
    privacyUrl: string | null;
    logo?: AssetChange["input"];
    icon?: AssetChange["input"];
  },
): Promise<PartnerBranding> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  // The schema already refuses this; the service holds the line for any caller that skips it.
  const accentCheck = input.accent ? checkAccent(input.accent) : null;
  if (input.accent && !accentCheck?.ok) throw new PartnerConsoleError("invalid", "accent_contrast");
  const accent = accentCheck?.hex ?? null;
  const current = await deps.store.brand(partner.id);
  const stored: Partial<Record<BrandAssetKind, string | null>> = {};
  const replaced: string[] = [];
  for (const change of [
    { kind: "logo", input: input.logo },
    { kind: "icon", input: input.icon },
  ] as AssetChange[]) {
    if (change.input === undefined) continue;
    const previous = change.kind === "logo" ? current?.logoKey : current?.iconKey;
    if (change.input === null) {
      stored[change.kind] = null;
    } else {
      try {
        const asset = decodeBrandAsset(change.kind, change.input);
        const key = deps.assets.keyFor(partner.id, change.kind, asset);
        await deps.assets.put(key, asset.bytes);
        stored[change.kind] = key;
      } catch (error) {
        if (error instanceof BrandAssetError)
          throw new PartnerConsoleError(
            "invalid",
            error.reason.startsWith("icon_") ? error.reason : `${change.kind}_${error.reason}`,
          );
        throw error;
      }
    }
    if (previous && previous !== stored[change.kind]) replaced.push(previous);
  }
  await deps.store.saveBrand(partner.id, {
    appName: input.appName.trim(),
    accent,
    supportEmail: input.supportEmail,
    termsUrl: input.termsUrl,
    privacyUrl: input.privacyUrl,
    ...(stored.logo !== undefined ? { logoKey: stored.logo } : {}),
    ...(stored.icon !== undefined ? { iconKey: stored.icon } : {}),
  });
  // Old images go once the new brand is saved, so a failed save never loses the working ones.
  for (const key of replaced) await deps.assets.delete(key).catch(() => undefined);
  // Adding the legal links is what lets a verified host go live.
  const host = (await deps.store.domains(partner.id))[0];
  if (host?.state === "verified" && deps.domains && host.providerId)
    await refreshHost({ store: deps.store, domains: deps.domains, now: deps.now }, host).catch(
      () => undefined,
    );
  await deps.console.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "brand.changed",
    detail: { appName: input.appName.trim() },
  });
  deps.changed?.();
  return brandingView(deps, partner.id);
}

export async function addDomain(
  deps: BrandingDeps,
  scope: PartnerScope,
  input: { partnerId: string; hostname: string },
): Promise<PartnerBranding> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  const provider = deps.domains;
  if (!provider) throw new PartnerConsoleError("refused", "domains_unavailable");
  const hostname = normalizeHostname(input.hostname);
  if (!hostname) throw new PartnerConsoleError("invalid", "hostname");
  if ([...deps.reservedHosts, provider.fallbackHostname()].some((host) => host === hostname))
    throw new PartnerConsoleError("conflict", "hostname_taken");
  if ((await deps.store.domains(partner.id)).length > 0)
    throw new PartnerConsoleError("conflict", "one_domain");
  // A host maps to one partner: refuse before the provider is asked for anything.
  if (await deps.store.hostnameTaken(hostname))
    throw new PartnerConsoleError("conflict", "hostname_taken");
  let created: Awaited<ReturnType<DomainProvider["create"]>>;
  try {
    created = await provider.create(hostname);
  } catch {
    throw new PartnerConsoleError("refused", "domain_provider_error");
  }
  try {
    await deps.store.createDomain({ partnerId: partner.id, hostname, providerId: created.id });
  } catch (error) {
    // Lost a race for the same host: the other partner's registration stands.
    if (error instanceof HostnameTakenError)
      throw new PartnerConsoleError("conflict", "hostname_taken");
    throw error;
  }
  await deps.console.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "domain.changed",
    detail: { action: "added", hostname },
  });
  deps.changed?.();
  return brandingView(deps, partner.id);
}

export async function checkDomain(
  deps: BrandingDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<PartnerBranding> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  const host = (await deps.store.domains(partner.id))[0];
  if (host?.providerId && deps.domains) {
    try {
      await refreshHost({ store: deps.store, domains: deps.domains, now: deps.now }, host);
    } catch {
      throw new PartnerConsoleError("refused", "domain_provider_error");
    }
    deps.changed?.();
  }
  return brandingView(deps, partner.id);
}

export async function removeDomain(
  deps: BrandingDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<PartnerBranding> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  const host = (await deps.store.domains(partner.id))[0];
  if (host) {
    if (host.providerId && deps.domains) {
      try {
        await deps.domains.delete(host.providerId);
      } catch {
        throw new PartnerConsoleError("refused", "domain_provider_error");
      }
    }
    await deps.store.deleteDomain(host.id);
    await deps.console.audit({
      partnerId: partner.id,
      actorUserId: scope.actorUserId ?? null,
      kind: "domain.changed",
      detail: { action: "removed", hostname: host.hostname },
    });
    deps.changed?.();
  }
  return brandingView(deps, partner.id);
}

export async function setSenderDomain(
  deps: BrandingDeps,
  scope: PartnerScope,
  input: { partnerId: string; domain: string | null },
): Promise<PartnerBranding> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  const provider = deps.senderDomains;
  if (!provider) throw new PartnerConsoleError("refused", "sender_unavailable");
  const brand = await deps.store.brand(partner.id);
  if (!brand) throw new PartnerConsoleError("refused", "brand_required");
  const domain = input.domain === null ? null : normalizeHostname(input.domain);
  if (input.domain !== null && !domain) throw new PartnerConsoleError("invalid", "domain");
  try {
    if (brand.senderProviderId) await provider.delete(brand.senderProviderId);
    const created = domain ? await provider.create(domain) : null;
    await deps.store.saveSender(partner.id, {
      senderDomain: created?.name ?? null,
      senderState: created ? created.status : "none",
      senderProviderId: created?.id ?? null,
      senderRecords: created?.records ?? [],
      senderError: null,
      checkedAt: deps.now(),
    });
  } catch {
    throw new PartnerConsoleError("refused", "sender_provider_error");
  }
  await deps.console.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "domain.changed",
    detail: { action: domain ? "sender_set" : "sender_removed", ...(domain ? { domain } : {}) },
  });
  return brandingView(deps, partner.id);
}

export async function checkSenderDomain(
  deps: BrandingDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<PartnerBranding> {
  const partner = await requireWhiteLabel(deps, scope, input.partnerId);
  const brand: BrandRecord | null = await deps.store.brand(partner.id);
  if (brand?.senderProviderId && deps.senderDomains) {
    try {
      await refreshSender(
        { store: deps.store, senderDomains: deps.senderDomains, now: deps.now },
        brand,
      );
    } catch {
      throw new PartnerConsoleError("refused", "sender_provider_error");
    }
  }
  return brandingView(deps, partner.id);
}
