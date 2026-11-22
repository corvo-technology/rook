// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyBrand,
  bootBrand,
  currentBrand,
  loadBrand,
  rebrandMessages,
  setBrandForTest,
} from "./brand";

const brand = {
  name: "Acme",
  accent: "#2563eb",
  logoUrl: "/api/brand/assets/p1/logo-abc.png",
  iconUrl: "/api/brand/assets/p1/icon-def.png",
  supportEmail: "help@acme.example.test",
  termsUrl: "https://acme.example.test/terms",
  privacyUrl: "https://acme.example.test/privacy",
};

function answer(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => {
  document.head.innerHTML = `
    <meta name="description" content="Your team of always-on agents." />
    <meta name="theme-color" content="#000000" />
    <meta name="apple-mobile-web-app-title" content="Rook" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="icon" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <title>Rook</title>`;
});
afterEach(() => {
  setBrandForTest(null);
  delete document.documentElement.dataset.brand;
  document.documentElement.removeAttribute("style");
});

describe("applying a partner's brand", () => {
  it("replaces the title, icons, theme colour, manifest and accent, leaving nothing of Rook's", () => {
    applyBrand(brand);
    expect(document.title).toBe("Acme");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      "#2563eb",
    );
    expect(
      document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content"),
    ).toBe("Acme");
    expect(
      [...document.querySelectorAll('link[rel="icon"]')].map((l) => l.getAttribute("href")),
    ).toEqual([brand.iconUrl]);
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe(
      brand.iconUrl,
    );
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe(
      "/api/brand/manifest.webmanifest",
    );
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#2563eb");
    expect(document.head.outerHTML).not.toMatch(/rook/i);
  });

  it("shows no icon rather than the app's when the partner has none", () => {
    applyBrand({ ...brand, iconUrl: null, accent: null });
    expect(
      [...document.querySelectorAll('link[rel="icon"]')].map((l) => l.getAttribute("href")),
    ).toEqual(["data:,"]);
    expect(document.querySelector('link[rel="apple-touch-icon"]')).toBeNull();
  });
});

describe("reading the brand of a host", () => {
  it("keeps the app's own look on a host with no brand", async () => {
    expect(await bootBrand(answer({ brand: null }))).toBeNull();
    expect(currentBrand()).toBeNull();
    expect(document.title).toBe("Rook");
  });

  it("keeps the app's own look when the read fails or the answer is not a brand", async () => {
    expect(await loadBrand(answer({}, false))).toBeNull();
    expect(await loadBrand(answer({ brand: { name: 7 } }))).toBeNull();
    expect(
      await loadBrand((async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch),
    ).toBeNull();
  });

  it("applies the brand the API names for the host", async () => {
    expect(await bootBrand(answer({ brand }))).toEqual(brand);
    expect(currentBrand()?.name).toBe("Acme");
    expect(document.title).toBe("Acme");
  });
});

describe("the app's name inside the catalogs", () => {
  it("is the partner's in every message, plain or with placeholders, and nothing else changes", () => {
    const catalog = {
      a: "Use Rook credits",
      b: ["Sign in to Rook, ", ["name"], " and Rook's team"],
      c: "Rookery stays",
      d: 7,
    };
    expect(rebrandMessages(catalog, "Acme $&")).toEqual({
      a: "Use Acme $& credits",
      b: ["Sign in to Acme $&, ", ["name"], " and Acme $&'s team"],
      c: "Rookery stays",
      d: 7,
    });
  });
});

describe("the page before a brand is known", () => {
  it("has no title to show on a partner host, and the app's own once it knows there is none", async () => {
    document.title = "";
    await bootBrand(answer({ brand: null }));
    expect(document.title).toBe("Rook");
    document.title = "";
    await bootBrand(answer({ brand }));
    expect(document.title).toBe("Acme");
  });
});
