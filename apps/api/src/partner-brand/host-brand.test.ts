import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  createClientIpResolver,
  normalizeRequestHost,
  requestHost,
  requestHostMiddleware,
} from "../client-ip.js";
import { brandWorld, goLive, look, png } from "./brand.test-support.js";
import { createHostBrandResolver } from "./host-brand.js";
import { brandRoutes } from "./routes.js";
import { saveBrand } from "./service.js";

async function appFor(world: Awaited<ReturnType<typeof brandWorld>>) {
  const app = new Hono();
  app.use(
    "*",
    requestHostMiddleware(
      createClientIpResolver({ trustedProxies: ["none"], header: "x-forwarded-for" }),
    ),
  );
  app.route(
    "/",
    brandRoutes({
      resolver: world.resolver,
      store: world.store,
      assets: world.assets,
      host: requestHost,
    }),
  );
  return app;
}

const ask = (app: Hono, path: string, host: string, headers: Record<string, string> = {}) =>
  app.request(`http://internal.test${path}`, { headers: { host, ...headers } });

describe("the brand of a host", () => {
  it("is the registered, active host's own brand", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test", { appName: "Acme" });
    await goLive(world, "beta", "app.beta.example.test", { appName: "Beta", accent: "#dc2626" });
    const found = await world.resolver.resolve("app.acme.example.test");
    expect(found).toMatchObject({ partnerId: "acme", brand: { appName: "Acme" } });
    expect((await world.resolver.resolve("app.beta.example.test"))?.brand.accent).toBe("#dc2626");
  });

  it("is nothing for a host nobody registered, so the app's own look shows", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test");
    expect(await world.resolver.resolve("app.other.example.test")).toBeNull();
    expect(await world.resolver.resolve("rook.example.test")).toBeNull();
    expect(await world.resolver.resolve(null)).toBeNull();
  });

  it("is nothing until the host is active, and nothing again once the partner stops being white label or is off", async () => {
    const world = await brandWorld();
    await world.store.saveBrand("acme", look());
    const created = await world.domains.create("app.acme.example.test");
    const host = await world.store.createDomain({
      partnerId: "acme",
      hostname: "app.acme.example.test",
      providerId: created.id,
    });
    for (const state of ["pending", "verified", "failed"] as const) {
      await world.store.updateDomain(host.id, { state });
      expect(await world.resolver.resolve("app.acme.example.test")).toBeNull();
    }
    await world.store.updateDomain(host.id, { state: "active" });
    expect(await world.resolver.resolve("app.acme.example.test")).not.toBeNull();
    world.store.partners.set("acme", { enabled: false, mode: "white_label" });
    expect(await world.resolver.resolve("app.acme.example.test")).toBeNull();
    world.store.partners.set("acme", { enabled: true, mode: "embedded" });
    expect(await world.resolver.resolve("app.acme.example.test")).toBeNull();
  });

  it("cannot show a brand of the partner's own that was saved for another partner", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test", { appName: "Acme" });
    await world.store.saveBrand("beta", look({ appName: "Beta" }));
    // Beta has a brand but no host: nothing about it is reachable from Acme's host or any other.
    expect((await world.resolver.resolve("app.acme.example.test"))?.brand.appName).toBe("Acme");
    expect(await world.resolver.resolve("beta")).toBeNull();
  });

  it("is remembered briefly, and forgotten when a brand changes", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test", { appName: "Acme" });
    let now = 0;
    const resolver = createHostBrandResolver(world.store, { ttlMs: 10_000, now: () => now });
    expect((await resolver.resolve("app.acme.example.test"))?.brand.appName).toBe("Acme");
    await world.store.saveBrand("acme", look({ appName: "Acme 2" }));
    expect((await resolver.resolve("app.acme.example.test"))?.brand.appName).toBe("Acme");
    resolver.invalidate();
    expect((await resolver.resolve("app.acme.example.test"))?.brand.appName).toBe("Acme 2");
    // A host that is not registered is remembered too, so it costs one read, not one per load.
    expect(await resolver.resolve("nobody.example.test")).toBeNull();
    now = 11_000;
    await goLive(world, "beta", "nobody.example.test");
    expect((await resolver.resolve("nobody.example.test"))?.partnerId).toBe("beta");
  });
});

describe("the public brand endpoint", () => {
  it("answers each host with its own brand and never another's", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test", { appName: "Acme", accent: "#2563eb" });
    await goLive(world, "beta", "app.beta.example.test", { appName: "Beta", accent: "#dc2626" });
    const app = await appFor(world);
    const acme = await (await ask(app, "/api/brand", "app.acme.example.test")).json();
    const beta = await (await ask(app, "/api/brand", "app.beta.example.test:8443")).json();
    expect(acme.brand).toMatchObject({ name: "Acme", accent: "#2563eb" });
    expect(beta.brand).toMatchObject({ name: "Beta", accent: "#dc2626" });
    expect(JSON.stringify(acme)).not.toContain("Beta");
    expect(JSON.stringify(beta)).not.toContain("Acme");
  });

  it("answers an unknown host with no brand, which is the app's own look", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test");
    const app = await appFor(world);
    const response = await ask(app, "/api/brand", "rook.example.test");
    expect(await response.json()).toEqual({ brand: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("ignores a query parameter or a spoofed forwarded host: only the host decides", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test", { appName: "Acme" });
    await goLive(world, "beta", "app.beta.example.test", { appName: "Beta" });
    const app = await appFor(world);
    for (const path of [
      "/api/brand?host=app.beta.example.test",
      "/api/brand?brand=beta",
      "/api/brand?partner=beta&hostname=app.beta.example.test",
    ]) {
      expect((await (await ask(app, path, "app.acme.example.test")).json()).brand.name).toBe(
        "Acme",
      );
      expect((await (await ask(app, path, "rook.example.test")).json()).brand).toBeNull();
    }
    // No trusted proxy vouches for this header, so it is read as what it is: a caller's claim.
    const spoofed = await ask(app, "/api/brand", "rook.example.test", {
      "x-forwarded-host": "app.beta.example.test",
    });
    expect((await spoofed.json()).brand).toBeNull();
  });

  it("believes the forwarded host only from a trusted proxy", async () => {
    const world = await brandWorld();
    await goLive(world, "beta", "app.beta.example.test", { appName: "Beta" });
    const trusting = new Hono();
    trusting.use(
      "*",
      requestHostMiddleware(
        createClientIpResolver({ trustedProxies: ["127.0.0.1"], header: "x-forwarded-for" }),
      ),
    );
    trusting.get("/host", (c) => c.json({ host: requestHost(c) }));
    const env = (address: string) => ({ incoming: { socket: { remoteAddress: address } } });
    const call = (address: string) =>
      trusting.request(
        "http://internal.test/host",
        { headers: { host: "api.internal.test", "x-forwarded-host": "app.beta.example.test" } },
        env(address),
      );
    expect(await (await call("127.0.0.1")).json()).toEqual({ host: "app.beta.example.test" });
    expect(await (await call("203.0.113.9")).json()).toEqual({ host: "api.internal.test" });
  });

  it("serves the host's own manifest and nothing for a host without a brand", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test", { appName: "Acme", accent: "#2563eb" });
    const app = await appFor(world);
    expect((await ask(app, "/api/brand/manifest.webmanifest", "rook.example.test")).status).toBe(
      404,
    );
    const manifest = await (
      await ask(app, "/api/brand/manifest.webmanifest", "app.acme.example.test")
    ).json();
    expect(manifest).toMatchObject({
      name: "Acme",
      short_name: "Acme",
      start_url: "/",
      display: "standalone",
      theme_color: "#2563eb",
      icons: [],
    });
    expect(JSON.stringify(manifest)).not.toMatch(/rook/i);
  });

  it("puts the partner's icon in the manifest at its real size", async () => {
    const world = await brandWorld();
    await goLive(world, "acme", "app.acme.example.test", { appName: "Acme" });
    await saveBrand(
      world.deps,
      { organizationId: "org-acme" },
      {
        partnerId: "acme",
        ...look(),
        icon: { mimeType: "image/png", dataBase64: png(1024).toString("base64") },
      },
    );
    const app = await appFor(world);
    const manifest = await (
      await ask(app, "/api/brand/manifest.webmanifest", "app.acme.example.test")
    ).json();
    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons[0]).toMatchObject({
      sizes: "1024x1024",
      type: "image/png",
      purpose: "any",
    });
    expect(manifest.icons[0].src).toMatch(/^\/api\/brand\/assets\/acme\/icon-[0-9a-f]{16}\.png$/);
  });
});

describe("request hosts", () => {
  it("reads a name without its port and refuses what is not a name", () => {
    expect(normalizeRequestHost("App.Acme.Example.Test:8443")).toBe("app.acme.example.test");
    expect(normalizeRequestHost("")).toBeNull();
    expect(normalizeRequestHost("bad host")).toBeNull();
    expect(normalizeRequestHost("a/b.test")).toBeNull();
  });
});
