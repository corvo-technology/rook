// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accentTokens,
  applyEmbedAccent,
  applyPartnerAccent,
  installEmbedToken,
  parseEmbedLaunch,
  parseEmbedMessage,
  resetEmbedForTests,
} from "./embed";

const NO_BRAND = { assistant: null, icon: null, user: null };

describe("parseEmbedLaunch", () => {
  it("reads the code, theme and locale from the fragment", () => {
    expect(parseEmbedLaunch("#code=abc123&theme=dark&locale=pt-BR")).toEqual({
      code: "abc123",
      theme: "dark",
      locale: "pt-BR",
      accent: null,
      brand: NO_BRAND,
    });
  });

  it("defaults the theme to auto and ignores values it does not know", () => {
    expect(parseEmbedLaunch("#code=x&theme=purple&locale=xx")).toEqual({
      code: "x",
      theme: "auto",
      locale: null,
      accent: null,
      brand: NO_BRAND,
    });
    expect(parseEmbedLaunch("#code=x")).toEqual({
      code: "x",
      theme: "auto",
      locale: null,
      accent: null,
      brand: NO_BRAND,
    });
  });

  it("returns no code when there is none", () => {
    expect(parseEmbedLaunch("")).toEqual({
      code: null,
      theme: "auto",
      locale: null,
      accent: null,
      brand: NO_BRAND,
    });
    expect(parseEmbedLaunch("#theme=light")).toEqual({
      code: null,
      theme: "light",
      locale: null,
      accent: null,
      brand: NO_BRAND,
    });
  });

  it("maps any shipped locale tag and refuses the rest", () => {
    for (const locale of ["en", "de", "pt-BR", "zh-CN", "es", "fr", "ja"]) {
      expect(parseEmbedLaunch(`#code=x&locale=${locale}`).locale).toBe(locale);
    }
    expect(parseEmbedLaunch("#code=x&locale=de-AT").locale).toBe("de");
    expect(parseEmbedLaunch("#code=x&locale=ru").locale).toBeNull();
  });
});

describe("parseEmbedMessage", () => {
  it("accepts only theme and locale changes", () => {
    expect(parseEmbedMessage({ type: "corvo:config", theme: "light", locale: "fr" })).toEqual({
      type: "config",
      theme: "light",
      locale: "fr",
      accent: null,
      brand: NO_BRAND,
    });
    expect(parseEmbedMessage({ type: "corvo:config", theme: "light" })).toEqual({
      type: "config",
      theme: "light",
      locale: null,
      accent: null,
      brand: NO_BRAND,
    });
    expect(parseEmbedMessage({ type: "corvo:code", code: "new" })).toEqual({
      type: "code",
      code: "new",
    });
  });

  it("ignores anything else, including attempts to carry a token", () => {
    for (const value of [
      null,
      "text",
      5,
      {},
      { type: "other" },
      { type: "corvo:token", token: "t" },
    ]) {
      expect(parseEmbedMessage(value)).toBeNull();
    }
  });
});

describe("installEmbedToken", () => {
  const original = window.fetch;
  let calls: Array<{ url: string; auth: string | null }>;

  beforeEach(() => {
    calls = [];
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        auth: headers.get("authorization"),
      });
      return new Response("{}");
    }) as typeof fetch;
  });
  afterEach(() => {
    resetEmbedForTests();
    window.fetch = original;
  });

  it("adds the token to this app's api and rpc requests only", async () => {
    installEmbedToken("tok-1");
    await window.fetch("/rpc/me");
    await window.fetch(`${window.location.origin}/api/auth/get-session`);
    await window.fetch("https://other.example/api/x");
    await window.fetch("/assets/app.js");
    expect(calls.map((c) => c.auth)).toEqual(["Bearer tok-1", "Bearer tok-1", null, null]);
  });

  it("keeps the caller's own headers and a Request's body", async () => {
    installEmbedToken("tok-2");
    await window.fetch("/rpc/x", { method: "POST", headers: { "x-corvo-space-id": "s1" } });
    await window.fetch(
      new Request(`${window.location.origin}/rpc/y`, { method: "POST", body: "{}" }),
    );
    expect(calls.every((c) => c.auth === "Bearer tok-2")).toBe(true);
  });

  it("replaces the token when a new one is installed, without wrapping twice", async () => {
    installEmbedToken("old");
    installEmbedToken("new");
    await window.fetch("/rpc/z");
    expect(calls).toEqual([{ url: "/rpc/z", auth: "Bearer new" }]);
  });
});

describe("the partner's accent colour", () => {
  it("is read from the fragment and from a config message, as a six-digit hex colour", () => {
    expect(parseEmbedLaunch("#code=a&accent=E11D48").accent).toBe("#e11d48");
    expect(parseEmbedLaunch("#code=a&accent=%23e11d48").accent).toBe("#e11d48");
    expect(parseEmbedMessage({ type: "corvo:config", accent: "#0ea5e9" })).toMatchObject({
      accent: "#0ea5e9",
    });
  });

  it("refuses anything that is not a plain hex colour, so it can never carry style rules", () => {
    for (const value of ["red", "#fff", "e11d48;background:url(x)", "url(x)", "#e11d4", "", null]) {
      expect(
        parseEmbedLaunch(`#code=a&accent=${encodeURIComponent(String(value))}`).accent,
      ).toBeNull();
      expect(parseEmbedMessage({ type: "corvo:config", accent: value })).toMatchObject({
        accent: null,
      });
    }
  });
});

describe("accentTokens", () => {
  it("sets the accent as the main colour and derives the rest from it, with no second colour", () => {
    const tokens = accentTokens("#e11d48");
    expect(tokens["--primary"]).toBe("#e11d48");
    for (const name of ["--primary-foreground", "--primary-hover", "--primary-disabled"]) {
      expect(tokens[name]).toContain("var(--primary)");
      expect(tokens[name]).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });

  it("makes the text on the accent light or dark by the accent's lightness", () => {
    expect(accentTokens("#fde047")["--primary-foreground"]).toContain("(0.62 - l)");
  });
});

describe("the partner's own accent", () => {
  const primary = () => document.documentElement.style.getPropertyValue("--primary");
  afterEach(() => {
    applyEmbedAccent(null);
    applyPartnerAccent(null);
  });

  it("is used when the embedding page passes none", () => {
    applyPartnerAccent("#16A34A");
    expect(primary()).toBe("#16a34a");
  });

  it("yields to the embedding page's accent, and returns when that is taken away", () => {
    applyPartnerAccent("#16a34a");
    applyEmbedAccent("#e11d48");
    expect(primary()).toBe("#e11d48");
    applyEmbedAccent(null);
    expect(primary()).toBe("#16a34a");
  });

  it("gives the app's own colour back when neither is set, and ignores anything not a hex colour", () => {
    applyPartnerAccent("red;background:url(x)");
    expect(primary()).toBe("");
  });
});

describe("what the frame tells the partner's page", () => {
  const posted = vi.fn();
  beforeEach(() => {
    posted.mockReset();
    vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: posted } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends the checkout address only when it is https", async () => {
    const { openCheckout } = await import("./embed");
    openCheckout("https://pay.example.test/buy?tenant=1");
    openCheckout("http://pay.example.test");
    openCheckout("javascript:alert(1)");
    expect(posted).toHaveBeenCalledTimes(1);
    expect(posted).toHaveBeenCalledWith(
      { type: "corvo:checkout", url: "https://pay.example.test/buy?tenant=1" },
      "*",
    );
  });

  it("sends a place in the partner's product only as an absolute path", async () => {
    const { openInHost } = await import("./embed");
    openInHost("/consultas/gravar");
    openInHost("//evil.example");
    openInHost("https://evil.example");
    openInHost("consultas");
    expect(posted).toHaveBeenCalledTimes(1);
    expect(posted).toHaveBeenCalledWith({ type: "corvo:navigate", path: "/consultas/gravar" }, "*");
  });

  it("sends the unread count as a whole number, never negative", async () => {
    const { reportUnread } = await import("./embed");
    reportUnread(3);
    reportUnread(-2);
    expect(posted).toHaveBeenNthCalledWith(1, { type: "corvo:unread", count: 3 }, "*");
    expect(posted).toHaveBeenNthCalledWith(2, { type: "corvo:unread", count: 0 }, "*");
  });
});

describe("the partner's names for the assistant and the person", () => {
  it("are read from the launch fragment", () => {
    const { brand } = parseEmbedLaunch(
      "#code=x&assistant=Dra.%20Ana&icon=https%3A%2F%2Fcdn.example.test%2Fa.png&user=Maria%20Silva",
    );
    expect(brand).toEqual({
      assistant: "Dra. Ana",
      icon: "https://cdn.example.test/a.png",
      user: "Maria Silva",
    });
  });

  it("keep only a plain name and an https icon", () => {
    const { brand } = parseEmbedLaunch(
      `#code=x&assistant=${"A".repeat(200)}&icon=javascript%3Aalert(1)&user=%20%20`,
    );
    expect(brand.assistant).toHaveLength(60);
    expect(brand.icon).toBeNull();
    expect(brand.user).toBeNull();
    expect(parseEmbedLaunch("#code=x&icon=http%3A%2F%2Fa.test%2Fi.png").brand.icon).toBeNull();
  });

  it("can change later through the config message", () => {
    const message = parseEmbedMessage({
      type: "corvo:config",
      theme: "dark",
      assistant: "Assist",
      user: "  Maria \n Silva ",
      icon: "https://cdn.example.test/b.png",
    });
    expect(message).toMatchObject({
      type: "config",
      brand: { assistant: "Assist", user: "Maria Silva", icon: "https://cdn.example.test/b.png" },
    });
  });
});
