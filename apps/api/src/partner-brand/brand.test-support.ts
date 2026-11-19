import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DomainEmulator, EmailDomainEmulator } from "@corvo/adapters";
import type { BrandFields } from "@corvo/db";
import { createMemoryBrandingStore } from "@corvo/db";
import { BrandAssetStore } from "./assets.js";
import { createHostBrandResolver } from "./host-brand.js";
import type { BrandingDeps } from "./service.js";

/** A PNG with the given pixel size: the signature and header only, which is all that is read. */
export function png(width: number, height = width, extra = 0): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(extra, 1)]);
}

export const asInput = (bytes: Buffer, mimeType = "image/png") => ({
  mimeType,
  dataBase64: bytes.toString("base64"),
});

export const legal: Pick<BrandFields, "termsUrl" | "privacyUrl"> = {
  termsUrl: "https://acme.example.test/terms",
  privacyUrl: "https://acme.example.test/privacy",
};

export const look = (overrides: Partial<BrandFields> = {}): BrandFields => ({
  appName: "Acme",
  accent: "#2563eb",
  supportEmail: "help@acme.example.test",
  ...legal,
  ...overrides,
});

/** Two white label partners, one embedded one, and everything the brand service needs, in memory. */
export async function brandWorld() {
  const store = createMemoryBrandingStore(
    new Map([
      ["acme", { enabled: true, mode: "white_label" as const }],
      ["beta", { enabled: true, mode: "white_label" as const }],
      ["embedded", { enabled: true, mode: "embedded" as const }],
    ]),
  );
  const domains = new DomainEmulator("fallback.rook.example");
  const senderDomains = new EmailDomainEmulator();
  const resolver = createHostBrandResolver(store, { ttlMs: 0 });
  const dataDir = await mkdtemp(path.join(tmpdir(), "brand-assets-"));
  const assets = new BrandAssetStore(undefined, dataDir);
  const audit: Array<{ partnerId: string; kind: string; detail: Record<string, unknown> }> = [];
  // The console's own scoping: an organization reaches only the partners it manages.
  const managed = new Map([
    ["org-acme", ["acme"]],
    ["org-beta", ["beta"]],
    ["org-embedded", ["embedded"]],
  ]);
  const deps: BrandingDeps = {
    store,
    console: {
      findPartner: async (organizationId: string, partnerId: string) =>
        managed.get(organizationId)?.includes(partnerId)
          ? ({
              id: partnerId,
              mode: store.partners.get(partnerId)?.mode,
              name: partnerId,
            } as never)
          : null,
      audit: async (event) => {
        audit.push({ partnerId: event.partnerId, kind: event.kind, detail: event.detail });
      },
    },
    assets,
    domains,
    senderDomains,
    reservedHosts: ["rook.example.test"],
    now: () => new Date("2026-11-18T12:00:00Z"),
    changed: () => resolver.invalidate(),
  };
  return { store, domains, senderDomains, resolver, assets, audit, deps };
}

/** Puts a partner's host live: registered at the provider, active, with its brand saved. */
export async function goLive(
  world: Awaited<ReturnType<typeof brandWorld>>,
  partnerId: string,
  hostname: string,
  brand: Partial<BrandFields> = {},
) {
  await world.store.saveBrand(partnerId, look(brand));
  const created = await world.domains.create(hostname);
  const host = await world.store.createDomain({ partnerId, hostname, providerId: created.id });
  await world.store.updateDomain(host.id, { state: "active" });
}
