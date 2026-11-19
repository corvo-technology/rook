import type { PublicBrandResponse } from "@corvo/contracts";
import type { BrandingStore } from "@corvo/db";
import type { Context } from "hono";
import { Hono } from "hono";
import type { BrandAssetStore } from "./assets.js";
import { assetContentType, pngSize } from "./assets.js";
import type { HostBrand, HostBrandResolver } from "./host-brand.js";
import { toPublicBrand } from "./host-brand.js";
import { assetPath } from "./service.js";

/**
 * What a host shows, before anyone signs in. The host decides: there is no parameter that picks a
 * brand, and a host that is not registered and active answers `{ brand: null }`, which is the
 * app's own look.
 */
export function brandRoutes(deps: {
  resolver: HostBrandResolver;
  store: Pick<BrandingStore, "brand">;
  assets: BrandAssetStore;
  host(c: Context): string | null;
}) {
  const app = new Hono();
  const found = (c: Context) => deps.resolver.resolve(deps.host(c));

  app.get("/api/brand", async (c) => {
    const brand = await found(c);
    // The answer depends on the host, and a brand edit must show at once.
    c.header("cache-control", "no-store");
    return c.json({ brand: brand ? toPublicBrand(brand) : null } satisfies PublicBrandResponse);
  });

  app.get("/api/brand/manifest.webmanifest", async (c) => {
    const brand = await found(c);
    c.header("cache-control", "no-store");
    if (!brand) return c.json({ error: "Not found" }, 404);
    return c.body(JSON.stringify(await manifest(brand, deps.assets)), 200, {
      "content-type": "application/manifest+json",
    });
  });

  app.get("/api/brand/assets/:partnerId/:file", async (c) => {
    const { partnerId, file } = c.req.param();
    const brand = await deps.store.brand(partnerId);
    const key = [brand?.logoKey, brand?.iconKey].find((candidate) =>
      candidate?.endsWith(`/${file}`),
    );
    const type = key ? assetContentType(key) : null;
    const bytes = key ? await deps.assets.get(key) : null;
    if (!key || !type || !bytes) return c.json({ error: "Not found" }, 404);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": type,
      // The address carries a hash of the bytes, so it never changes meaning.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    });
  });

  return app;
}

async function manifest(found: HostBrand, assets: BrandAssetStore) {
  const { brand, partnerId } = found;
  const icon = assetPath(partnerId, brand.iconKey);
  const bytes = brand.iconKey ? await assets.get(brand.iconKey) : null;
  const size = bytes ? pngSize(bytes) : null;
  const sizes = size ? `${size.width}x${size.height}` : "512x512";
  return {
    id: "/",
    name: brand.appName,
    short_name: brand.appName,
    start_url: "/",
    scope: "/",
    display: "standalone",
    ...(brand.accent ? { theme_color: brand.accent, background_color: brand.accent } : {}),
    // Without an icon of its own the app is not installable under this brand, rather than
    // installing under another's.
    icons: icon
      ? [
          { src: icon, sizes, type: "image/png", purpose: "any" },
          { src: icon, sizes, type: "image/png", purpose: "maskable" },
        ]
      : [],
  };
}
