import type { PublicBrand } from "@corvo/contracts";
import type { BrandingStore, BrandRecord } from "@corvo/db";
import { assetPath } from "./service.js";

export interface HostBrand {
  partnerId: string;
  hostname: string;
  brand: BrandRecord;
}

export interface HostBrandResolver {
  /** The brand of a host, or null: an unknown host shows the app's own look, never another's. */
  resolve(hostname: string | null): Promise<HostBrand | null>;
  /** Forget what was read, after a brand or a host changed. */
  invalidate(): void;
}

/**
 * Looks a host up in the registry and nothing else. It is cached for a few seconds because every
 * page load asks, and a miss is cached too, so a host that is not registered costs one read.
 */
export function createHostBrandResolver(
  store: Pick<BrandingStore, "hostBrand">,
  options: { ttlMs?: number; now?: () => number } = {},
): HostBrandResolver {
  const ttl = options.ttlMs ?? 10_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; value: HostBrand | null }>();
  return {
    async resolve(hostname) {
      if (!hostname) return null;
      const hit = cache.get(hostname);
      if (hit && now() - hit.at < ttl) return hit.value;
      const found = await store.hostBrand(hostname);
      const value = found ? { partnerId: found.partnerId, hostname, brand: found.brand } : null;
      // Hosts come from the network: bound what is remembered.
      if (cache.size >= 1000) cache.clear();
      cache.set(hostname, { at: now(), value });
      return value;
    },
    invalidate() {
      cache.clear();
    },
  };
}

/** What the app reads at boot. Only fields the partner set; nothing about the deployment. */
export function toPublicBrand(found: HostBrand): PublicBrand {
  const { brand, partnerId } = found;
  return {
    name: brand.appName,
    accent: brand.accent,
    logoUrl: assetPath(partnerId, brand.logoKey),
    iconUrl: assetPath(partnerId, brand.iconKey),
    supportEmail: brand.supportEmail,
    termsUrl: brand.termsUrl,
    privacyUrl: brand.privacyUrl,
  };
}
