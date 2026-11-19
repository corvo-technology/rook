import { EmailEmulator } from "@corvo/adapters";
import {
  invitationEmail,
  passwordResetEmail,
  signInCodeEmail,
  verificationEmail,
} from "@corvo/auth";
import { describe, expect, it } from "vitest";
import { brandWorld, goLive } from "./brand.test-support.js";
import { createPartnerMail, partnerSender, senderAddress } from "./mail.js";

async function mailWorld() {
  const world = await brandWorld();
  await goLive(world, "acme", "app.acme.example.test", {
    appName: "Acme",
    accent: "#2563eb",
    supportEmail: "help@acme.example.test",
  });
  await goLive(world, "beta", "app.beta.example.test", { appName: "Beta", accent: "#dc2626" });
  const organizations = new Map([
    ["ana@acme-customer.example.test", "org-customer-1"],
    ["bia@beta-customer.example.test", "org-customer-2"],
  ]);
  const mail = createPartnerMail({
    store: world.store,
    resolver: world.resolver,
    webOrigin: "https://rook.example.test",
    rookFrom: "Rook <no-reply@rook.example.test>",
    organizationOfEmail: async (email) => organizations.get(email) ?? null,
    organizationOfSpace: async (spaceId) => spaceId,
  });
  world.store.customers.set("org-customer-1", {
    partnerId: "acme",
    hostname: "app.acme.example.test",
  });
  world.store.customers.set("org-customer-2", {
    partnerId: "beta",
    hostname: "app.beta.example.test",
  });
  return { ...world, mail };
}

describe("a customer's mail takes its partner's brand", () => {
  it("is the host's brand for a sign-in code, with that host's address in its links", async () => {
    const { mail } = await mailWorld();
    const branded = await mail.mailBrand({ host: "app.acme.example.test", email: null });
    expect(branded?.brand).toMatchObject({
      name: "Acme",
      accent: "#2563eb",
      supportEmail: "help@acme.example.test",
    });
    expect(branded?.origin).toBe("https://app.acme.example.test");
    const message = await signInCodeEmail(
      branded!.origin,
      "ana@acme-customer.example.test",
      "123456",
      branded!.brand,
    );
    expect(message.subject).toBe("Your Acme sign-in code");
    expect(message.html).toContain("Acme");
    expect(message.html).toContain("#2563eb");
    expect(message.html + message.text + message.subject).not.toMatch(/rook/i);
  });

  it("is the customer's own partner when asked by address, and never another partner's", async () => {
    const { mail } = await mailWorld();
    expect(
      (await mail.mailBrand({ host: null, email: "ana@acme-customer.example.test" }))?.brand.name,
    ).toBe("Acme");
    expect(
      (await mail.mailBrand({ host: null, email: "bia@beta-customer.example.test" }))?.brand.name,
    ).toBe("Beta");
    expect(await mail.mailBrand({ host: null, email: "stranger@example.test" })).toBeUndefined();
    // The host in front of the person wins over who they are.
    expect(
      (
        await mail.mailBrand({
          host: "app.beta.example.test",
          email: "ana@acme-customer.example.test",
        })
      )?.brand.name,
    ).toBe("Beta");
  });

  it("is Rook's own for a host nobody registered, and for a code asked by address alone", async () => {
    const { mail } = await mailWorld();
    expect(await mail.mailBrand({ host: "rook.example.test", email: null })).toBeUndefined();
    expect(await mail.mailBrand({ host: null, email: null })).toBeUndefined();
  });

  it("brands an invitation sent from a customer's space, with the link on the partner's host", async () => {
    const { mail } = await mailWorld();
    const branded = await mail.mailBrandForSpace("org-customer-1");
    const message = await invitationEmail(
      branded!.origin,
      {
        to: "new@example.test",
        inviterName: "Ana",
        spaceName: "Equipe",
        url: "https://app.acme.example.test/invite/x",
      },
      branded!.brand,
    );
    expect(message.subject).toBe("Ana invited you to Equipe on Acme");
    expect(message.html + message.text).not.toMatch(/rook/i);
    expect(await mail.mailBrandForSpace("org-nobody")).toBeUndefined();
  });

  it("covers the verification and reset mail too, and leaves Rook's own mail as it was", async () => {
    const { mail } = await mailWorld();
    const branded = (await mail.mailBrand({ host: "app.acme.example.test", email: null }))!;
    const verification = await verificationEmail(
      branded.origin,
      "ana@example.test",
      "https://app.acme.example.test/v",
      branded.brand,
    );
    const reset = await passwordResetEmail(
      branded.origin,
      { id: "u1", email: "ana@example.test", name: "Ana" },
      "https://app.acme.example.test/r",
      branded.brand,
    );
    for (const message of [verification, reset])
      expect(message.html + message.text + message.subject).not.toMatch(/rook/i);
    const rooks = await signInCodeEmail("https://rook.example.test", "ana@example.test", "123456");
    expect(rooks.subject).toBe("Your Rook sign-in code");
  });
});

describe("who the mail comes from", () => {
  it("is Rook's address under the partner's name until its domain is verified", async () => {
    const { store, mail } = await mailWorld();
    expect((await mail.mailBrand({ host: "app.acme.example.test", email: null }))?.from).toBe(
      "Acme <no-reply@rook.example.test>",
    );
    await store.saveSender("acme", {
      senderDomain: "mail.acme.example.test",
      senderState: "pending",
      senderProviderId: "ed-1",
      senderRecords: [],
      senderError: null,
      checkedAt: new Date(),
    });
    expect((await mail.mailBrand({ host: "app.acme.example.test", email: null }))?.from).toBe(
      "Acme <no-reply@rook.example.test>",
    );
  });

  it("is the partner's own domain once it is verified, and falls back again if it fails", async () => {
    const { store, resolver, mail } = await mailWorld();
    const sender = (state: "verified" | "failed") =>
      store.saveSender("acme", {
        senderDomain: "mail.acme.example.test",
        senderState: state,
        senderProviderId: "ed-1",
        senderRecords: [],
        senderError: null,
        checkedAt: new Date(),
      });
    await sender("verified");
    resolver.invalidate();
    expect((await mail.mailBrand({ host: "app.acme.example.test", email: null }))?.from).toBe(
      "Acme <noreply@mail.acme.example.test>",
    );
    await sender("failed");
    resolver.invalidate();
    expect((await mail.mailBrand({ host: "app.acme.example.test", email: null }))?.from).toBe(
      "Acme <no-reply@rook.example.test>",
    );
  });

  it("is delivered with that sender, and Rook's own mail with none", async () => {
    const { mail } = await mailWorld();
    const sink = new EmailEmulator();
    const branded = (await mail.mailBrand({ host: "app.acme.example.test", email: null }))!;
    await sink.send({
      ...(await signInCodeEmail(branded.origin, "ana@example.test", "123456", branded.brand)),
      from: branded.from,
    });
    await sink.send(
      await signInCodeEmail("https://rook.example.test", "ana@example.test", "123456"),
    );
    expect(sink.sent[0]?.from).toBe("Acme <no-reply@rook.example.test>");
    expect(sink.sent[1]?.from).toBeUndefined();
  });

  it("cannot be bent into another header by a partner's name", () => {
    const from = partnerSender(
      { appName: 'Acme" <evil@x.test>\r\nBcc: a@b.test', senderDomain: null, senderState: "none" },
      "no-reply@rook.example.test",
    );
    expect(from).not.toMatch(/[\r\n]/);
    expect(from?.match(/</g)).toHaveLength(1);
    expect(from?.endsWith("<no-reply@rook.example.test>")).toBe(true);
  });

  it("reads the address out of a configured sender, and has none when none is configured", () => {
    expect(senderAddress("Rook <no-reply@rook.example.test>")).toBe("no-reply@rook.example.test");
    expect(senderAddress("no-reply@rook.example.test")).toBe("no-reply@rook.example.test");
    expect(senderAddress("")).toBeUndefined();
    expect(senderAddress(undefined)).toBeUndefined();
    expect(
      partnerSender({ appName: "Acme", senderDomain: null, senderState: "none" }, undefined),
    ).toBeUndefined();
  });
});

describe("a signup on a partner's host", () => {
  it("links the new organization to that partner, once, and the link never moves", async () => {
    const { mail, store } = await mailWorld();
    await mail.onSignup({ organizationId: "org-new", host: "app.acme.example.test" });
    expect(store.customers.get("org-new")).toEqual({
      partnerId: "acme",
      hostname: "app.acme.example.test",
    });
    expect(await store.customerCount("acme")).toBe(2);
    // The same organization arriving again, through the other partner's host, stays Acme's.
    await mail.onSignup({ organizationId: "org-new", host: "app.beta.example.test" });
    await mail.onSignup({ organizationId: "org-new", host: "app.acme.example.test" });
    expect(store.customers.get("org-new")?.partnerId).toBe("acme");
    expect(await store.customerCount("acme")).toBe(2);
    expect(await store.customerCount("beta")).toBe(1);
  });

  it("links nothing on Rook's own host or an unregistered one", async () => {
    const { mail, store } = await mailWorld();
    await mail.onSignup({ organizationId: "org-a", host: "rook.example.test" });
    await mail.onSignup({ organizationId: "org-b", host: "app.unknown.example.test" });
    await mail.onSignup({ organizationId: "org-c", host: null });
    expect(
      [...store.customers.keys()].filter((id) => ["org-a", "org-b", "org-c"].includes(id)),
    ).toEqual([]);
  });

  it("trusts a host's origin for sign-in only while that host is active", async () => {
    const { mail, store } = await mailWorld();
    expect(await mail.hostOrigins("app.acme.example.test")).toEqual([
      "https://app.acme.example.test",
    ]);
    expect(await mail.hostOrigins("app.unknown.example.test")).toEqual([]);
    expect(await mail.hostOrigins(null)).toEqual([]);
    const [host] = await store.domains("acme");
    await store.updateDomain(host!.id, { state: "failed" });
    // The resolver's cache is off in this world, so the change shows at once.
    expect(await mail.hostOrigins("app.acme.example.test")).toEqual([]);
  });
});
