import { describe, expect, it } from "vitest";
import { PartnerConsoleError } from "../partner-console/index.js";
import { asInput, brandWorld, legal, look, png } from "./brand.test-support.js";
import {
  addDomain,
  checkDomain,
  checkSenderDomain,
  getBranding,
  removeDomain,
  saveBrand,
  setSenderDomain,
} from "./service.js";

const acme = { organizationId: "org-acme", actorUserId: "user-1" };
const input = (overrides: Record<string, unknown> = {}) => ({
  partnerId: "acme",
  appName: "Acme",
  accent: "#2563eb",
  supportEmail: "help@acme.example.test",
  ...legal,
  ...overrides,
});

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) =>
      error instanceof PartnerConsoleError ? `${error.code}:${error.reason}` : error,
  );

describe("who may edit a brand", () => {
  it("reaches only the partners the organization manages", async () => {
    const { deps } = await brandWorld();
    expect(
      await refusal(getBranding(deps, { organizationId: "org-beta" }, { partnerId: "acme" })),
    ).toBe("not_found:not_found");
    expect(await refusal(saveBrand(deps, { organizationId: "org-beta" }, input()))).toBe(
      "not_found:not_found",
    );
    expect(
      await refusal(
        addDomain(
          deps,
          { organizationId: "org-beta" },
          { partnerId: "acme", hostname: "app.x.example.test" },
        ),
      ),
    ).toBe("not_found:not_found");
  });

  it("is closed to a partner that is not white label", async () => {
    const { deps } = await brandWorld();
    const scope = { organizationId: "org-embedded" };
    expect(await refusal(getBranding(deps, scope, { partnerId: "embedded" }))).toBe(
      "refused:not_white_label",
    );
    expect(await refusal(saveBrand(deps, scope, input({ partnerId: "embedded" })))).toBe(
      "refused:not_white_label",
    );
  });
});

describe("saving a brand", () => {
  it("stores the look, serves the images by address, and records who changed it", async () => {
    const world = await brandWorld();
    const view = await saveBrand(
      world.deps,
      acme,
      input({ logo: asInput(png(200, 80)), icon: asInput(png(512)) }),
    );
    expect(view.brand).toMatchObject({
      appName: "Acme",
      accent: "#2563eb",
      supportEmail: "help@acme.example.test",
    });
    expect(view.brand?.logoUrl).toMatch(/^\/api\/brand\/assets\/acme\/logo-[0-9a-f]{16}\.png$/);
    expect(view.brand?.iconUrl).toMatch(/^\/api\/brand\/assets\/acme\/icon-[0-9a-f]{16}\.png$/);
    expect(world.audit).toEqual([
      { partnerId: "acme", kind: "brand.changed", detail: { appName: "Acme" } },
    ]);
    const key = (await world.store.brand("acme"))?.logoKey ?? "";
    expect((await world.assets.get(key))?.length).toBe(png(200, 80).length);
  });

  it("keeps an image left out, replaces one sent, removes one set to null, and deletes the old file", async () => {
    const world = await brandWorld();
    await saveBrand(world.deps, acme, input({ logo: asInput(png(100, 40)) }));
    const first = (await world.store.brand("acme"))?.logoKey ?? "";
    await saveBrand(world.deps, acme, input({ appName: "Acme 2" }));
    expect((await world.store.brand("acme"))?.logoKey).toBe(first);
    await saveBrand(world.deps, acme, input({ logo: asInput(png(120, 40)) }));
    const second = (await world.store.brand("acme"))?.logoKey ?? "";
    expect(second).not.toBe(first);
    expect(await world.assets.get(first)).toBeNull();
    expect(await world.assets.get(second)).not.toBeNull();
    await saveBrand(world.deps, acme, input({ logo: null }));
    expect((await world.store.brand("acme"))?.logoKey).toBeNull();
    expect(await world.assets.get(second)).toBeNull();
  });

  it("refuses an accent without contrast even when the schema was skipped", async () => {
    const { deps, store } = await brandWorld();
    expect(await refusal(saveBrand(deps, acme, input({ accent: "#f5f5f0" })))).toBe(
      "invalid:accent_contrast",
    );
    expect(await store.brand("acme")).toBeNull();
  });

  it.each([
    [
      "a file that is not the image it says",
      asInput(Buffer.from("<svg onload=alert(1)>"), "image/png"),
      "logo_not_an_image",
    ],
    [
      "a script labelled as an image",
      asInput(Buffer.from("alert(1)"), "image/jpeg"),
      "logo_not_an_image",
    ],
    ["an image over the limit", asInput(png(10, 10, 300 * 1024)), "logo_too_large"],
  ])("refuses %s", async (_name, logo, reason) => {
    const { deps, store } = await brandWorld();
    expect(await refusal(saveBrand(deps, acme, input({ logo })))).toBe(`invalid:${reason}`);
    expect(await store.brand("acme")).toBeNull();
  });

  it("wants a home-screen icon that is a square PNG of at least 512 px", async () => {
    const { deps } = await brandWorld();
    expect(await refusal(saveBrand(deps, acme, input({ icon: asInput(png(256)) })))).toBe(
      "invalid:icon_size",
    );
    expect(await refusal(saveBrand(deps, acme, input({ icon: asInput(png(512, 400)) })))).toBe(
      "invalid:icon_size",
    );
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(await refusal(saveBrand(deps, acme, input({ icon: asInput(jpeg, "image/jpeg") })))).toBe(
      "invalid:icon_type",
    );
    expect(await refusal(saveBrand(deps, acme, input({ icon: asInput(png(512)) })))).toBeNull();
  });
});

describe("adding a host", () => {
  it("registers it at the provider and shows the exact record and the one next step", async () => {
    const world = await brandWorld();
    await saveBrand(world.deps, acme, input());
    const view = await addDomain(world.deps, acme, {
      partnerId: "acme",
      hostname: " App.Acme.Example.Test ",
    });
    expect(view.domain).toEqual({
      hostname: "app.acme.example.test",
      state: "pending",
      cname: { name: "app.acme.example.test", target: "fallback.rook.example" },
      nextStep: "add_cname",
      error: null,
    });
    expect([...world.domains.hostnames.values()].map((host) => host.hostname)).toEqual([
      "app.acme.example.test",
    ]);
    expect(world.audit.at(-1)).toMatchObject({
      kind: "domain.changed",
      detail: { action: "added" },
    });
  });

  it("maps a host to one partner: another cannot take it", async () => {
    const world = await brandWorld();
    await addDomain(world.deps, acme, { partnerId: "acme", hostname: "app.acme.example.test" });
    const beta = { organizationId: "org-beta" };
    expect(
      await refusal(
        addDomain(world.deps, beta, { partnerId: "beta", hostname: "app.acme.example.test" }),
      ),
    ).toBe("conflict:hostname_taken");
    expect(
      await refusal(
        addDomain(world.deps, beta, { partnerId: "beta", hostname: "APP.ACME.EXAMPLE.TEST" }),
      ),
    ).toBe("conflict:hostname_taken");
    expect(world.domains.hostnames.size).toBe(1);
  });

  it("refuses the deployment's own host, the fallback, a bad name and a second host", async () => {
    const world = await brandWorld();
    for (const hostname of ["rook.example.test", "fallback.rook.example"]) {
      expect(await refusal(addDomain(world.deps, acme, { partnerId: "acme", hostname }))).toBe(
        "conflict:hostname_taken",
      );
    }
    for (const hostname of ["localhost", "10.0.0.1", "*.acme.com", "https://acme.com"]) {
      expect(await refusal(addDomain(world.deps, acme, { partnerId: "acme", hostname }))).toBe(
        "invalid:hostname",
      );
    }
    await addDomain(world.deps, acme, { partnerId: "acme", hostname: "app.acme.example.test" });
    expect(
      await refusal(
        addDomain(world.deps, acme, { partnerId: "acme", hostname: "other.acme.example.test" }),
      ),
    ).toBe("conflict:one_domain");
  });

  it("is closed where the deployment has no domain provider", async () => {
    const world = await brandWorld();
    const deps = { ...world.deps, domains: undefined };
    expect(
      await refusal(
        addDomain(deps, acme, { partnerId: "acme", hostname: "app.acme.example.test" }),
      ),
    ).toBe("refused:domains_unavailable");
    expect((await getBranding(deps, acme, { partnerId: "acme" })).domainsAvailable).toBe(false);
  });

  it("answers a provider failure as one the partner can retry, without registering anything", async () => {
    const world = await brandWorld();
    world.domains.failNextCalls(1);
    expect(
      await refusal(
        addDomain(world.deps, acme, { partnerId: "acme", hostname: "app.acme.example.test" }),
      ),
    ).toBe("refused:domain_provider_error");
    expect(await world.store.domains("acme")).toEqual([]);
  });
});

describe("a host going live", () => {
  it("goes pending, verified, then active only with terms and privacy links; the brand shows only when active", async () => {
    const world = await brandWorld();
    await saveBrand(world.deps, acme, input({ termsUrl: null, privacyUrl: null }));
    await addDomain(world.deps, acme, { partnerId: "acme", hostname: "app.acme.example.test" });

    world.domains.set("app.acme.example.test", "verified");
    expect((await checkDomain(world.deps, acme, { partnerId: "acme" })).domain).toMatchObject({
      state: "verified",
      nextStep: "add_legal_links",
    });

    world.domains.set("app.acme.example.test", "active");
    expect((await checkDomain(world.deps, acme, { partnerId: "acme" })).domain?.state).toBe(
      "verified",
    );
    expect(await world.resolver.resolve("app.acme.example.test")).toBeNull();

    // Saving the links is what lets the host go live, without waiting for the next check.
    const saved = await saveBrand(world.deps, acme, input());
    expect(saved.domain).toMatchObject({ state: "active", nextStep: "none" });
    expect((await world.resolver.resolve("app.acme.example.test"))?.brand.appName).toBe("Acme");
  });

  it("shows the provider's reason when it fails, and lets the partner check again", async () => {
    const world = await brandWorld();
    await saveBrand(world.deps, acme, input());
    await addDomain(world.deps, acme, { partnerId: "acme", hostname: "app.acme.example.test" });
    world.domains.set("app.acme.example.test", "failed", "CNAME not found");
    expect((await checkDomain(world.deps, acme, { partnerId: "acme" })).domain).toMatchObject({
      state: "failed",
      error: "CNAME not found",
      nextStep: "fix_error",
    });
    world.domains.set("app.acme.example.test", "pending");
    expect((await checkDomain(world.deps, acme, { partnerId: "acme" })).domain).toMatchObject({
      state: "pending",
      error: null,
    });
  });

  it("stops serving the brand the moment the host is removed, at the provider too", async () => {
    const world = await brandWorld();
    await saveBrand(world.deps, acme, input());
    await addDomain(world.deps, acme, { partnerId: "acme", hostname: "app.acme.example.test" });
    world.domains.set("app.acme.example.test", "active");
    await checkDomain(world.deps, acme, { partnerId: "acme" });
    expect(await world.resolver.resolve("app.acme.example.test")).not.toBeNull();
    const view = await removeDomain(world.deps, acme, { partnerId: "acme" });
    expect(view.domain).toBeNull();
    expect(world.domains.hostnames.size).toBe(0);
    expect(await world.resolver.resolve("app.acme.example.test")).toBeNull();
  });
});

describe("the sender domain", () => {
  it("needs a saved brand, then lists the records and follows the provider to verified", async () => {
    const world = await brandWorld();
    expect(
      await refusal(
        setSenderDomain(world.deps, acme, { partnerId: "acme", domain: "mail.acme.example.test" }),
      ),
    ).toBe("refused:brand_required");
    await saveBrand(world.deps, acme, input());
    const view = await setSenderDomain(world.deps, acme, {
      partnerId: "acme",
      domain: "mail.acme.example.test",
    });
    expect(view.sender.state).toBe("pending");
    expect(view.sender.records.map((record) => record.type)).toEqual(["MX", "TXT", "TXT"]);
    world.senderDomains.set("mail.acme.example.test", "verified");
    expect((await checkSenderDomain(world.deps, acme, { partnerId: "acme" })).sender).toMatchObject(
      {
        domain: "mail.acme.example.test",
        state: "verified",
      },
    );
  });

  it("replaces one domain with another and removes it with null, at the provider as well", async () => {
    const world = await brandWorld();
    await saveBrand(world.deps, acme, input());
    await setSenderDomain(world.deps, acme, {
      partnerId: "acme",
      domain: "mail.acme.example.test",
    });
    await setSenderDomain(world.deps, acme, {
      partnerId: "acme",
      domain: "send.acme.example.test",
    });
    expect([...world.senderDomains.domains.values()].map((domain) => domain.name)).toEqual([
      "send.acme.example.test",
    ]);
    const view = await setSenderDomain(world.deps, acme, { partnerId: "acme", domain: null });
    expect(view.sender).toEqual({ domain: null, state: "none", records: [], error: null });
    expect(world.senderDomains.domains.size).toBe(0);
  });

  it("keeps a saved brand's look untouched when the sender changes", async () => {
    const world = await brandWorld();
    await saveBrand(world.deps, acme, input());
    await setSenderDomain(world.deps, acme, {
      partnerId: "acme",
      domain: "mail.acme.example.test",
    });
    await saveBrand(world.deps, acme, input({ appName: "Acme 2" }));
    expect((await world.store.brand("acme"))?.senderDomain).toBe("mail.acme.example.test");
    expect(look().appName).toBe("Acme");
  });
});
