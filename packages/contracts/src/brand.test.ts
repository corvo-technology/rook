import { webDarkTokens, webLightTokens } from "@corvo/ui-tokens";
import { describe, expect, it } from "vitest";
import { checkAccent, normalizeHostname, PartnerBrandInput } from "./brand.js";

describe("accent contrast", () => {
  it("accepts a colour that stands out on both the light and the dark page", () => {
    const check = checkAccent("#2563eb");
    expect(check?.ok).toBe(true);
    expect(check?.light).toBeGreaterThanOrEqual(3);
    expect(check?.dark).toBeGreaterThanOrEqual(3);
  });

  it("refuses a colour too close to the light page, and one too close to the dark page", () => {
    expect(checkAccent(webLightTokens.background)?.ok).toBe(false);
    expect(checkAccent("#f5f5f0")?.ok).toBe(false);
    expect(checkAccent(webDarkTokens.background)?.ok).toBe(false);
    expect(checkAccent("#111111")?.ok).toBe(false);
  });

  it("reads the ratio against each theme, so a failure names which one", () => {
    const pale = checkAccent("#ffff99");
    expect(pale?.light).toBeLessThan(3);
    expect(pale?.dark).toBeGreaterThan(3);
    const dim = checkAccent("#202040");
    expect(dim?.dark).toBeLessThan(3);
    expect(dim?.light).toBeGreaterThan(3);
  });

  it("is not a colour unless it is six hex digits", () => {
    for (const value of ["red", "#fff", "#12345", "javascript:1", "#12345g", "url(x)"]) {
      expect(checkAccent(value)).toBeNull();
    }
  });

  it("is enforced by the input a partner submits", () => {
    const base = {
      partnerId: "p1",
      appName: "Acme",
      supportEmail: null,
      termsUrl: null,
      privacyUrl: null,
    };
    expect(PartnerBrandInput.safeParse({ ...base, accent: "#2563eb" }).success).toBe(true);
    expect(PartnerBrandInput.safeParse({ ...base, accent: null }).success).toBe(true);
    expect(PartnerBrandInput.safeParse({ ...base, accent: "#f5f5f0" }).success).toBe(false);
    expect(
      PartnerBrandInput.safeParse({ ...base, accent: "#2563eb", termsUrl: "http://x.test" })
        .success,
    ).toBe(false);
    expect(PartnerBrandInput.safeParse({ ...base, accent: null, extra: 1 }).success).toBe(false);
  });
});

describe("hostnames", () => {
  it("lower-cases and accepts a fully qualified name", () => {
    expect(normalizeHostname(" App.Acme.Example.COM. ")).toBe("app.acme.example.com");
  });

  it.each([
    "localhost",
    "acme",
    "10.0.0.1",
    "*.acme.com",
    "acme.com:8080",
    "https://acme.com",
    "a b.com",
    "acme.internal",
    "-acme.com",
    "",
  ])("refuses %s", (value) => {
    expect(normalizeHostname(value)).toBeNull();
  });
});
