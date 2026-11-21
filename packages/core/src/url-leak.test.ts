import { describe, expect, it } from "vitest";
import {
  MAX_OUTBOUND_QUERY_LENGTH,
  outboundUrlLeak,
  outboundUrlsOfCall,
  urlMayCarryData,
  urlsInText,
} from "./url-leak.js";

const none = new Set<string>();
const check = (
  url: string,
  extra: Partial<Parameters<typeof outboundUrlLeak>[0]> = {},
): ReturnType<typeof outboundUrlLeak> =>
  outboundUrlLeak({ url, privateText: [], knownUrls: none, ...extra });

describe("outboundUrlLeak: key-shaped strings", () => {
  it.each([
    "https://example.com/?q=sk-abcdefghijklmnopqrstuvwx",
    "https://example.com/collect/ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "https://example.com/?k=AKIAABCDEFGHIJKLMNOP",
    "https://example.com/?t=eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4",
    "https://example.com/?api_key=abcd1234",
    "https://example.com/?x=a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
    "https://example.com/#a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
    "https://user:pass@example.com/",
  ])("refuses %s", (url) => {
    expect(check(url)?.rule).toBe("key");
  });

  it("refuses a value this run redacts", () => {
    expect(
      check("https://example.com/?q=hunter2-secret", { secrets: ["hunter2-secret"] })?.rule,
    ).toBe("key");
  });

  it("allows ordinary URLs, even with a commit-like path", () => {
    expect(check("https://example.com/docs/getting-started?page=2")).toBeNull();
    expect(check("https://example.com/a/b/c.html#section-2")).toBeNull();
  });
});

describe("outboundUrlLeak: query length", () => {
  it("refuses a query longer than the limit and allows one at it", () => {
    const at = `https://example.com/?q=${"x".repeat(MAX_OUTBOUND_QUERY_LENGTH - 3)}`;
    expect(new URL(at).search.length).toBe(MAX_OUTBOUND_QUERY_LENGTH);
    expect(check(at)).toBeNull();
    const over = `https://example.com/?q=${"x y ".repeat(200)}`;
    expect(check(over)?.rule).toBe("query");
  });
});

describe("outboundUrlLeak: characters copied from private results", () => {
  const privateText = ["Dear Ana, your invoice number is INV-2024-0099-CONFIDENTIAL today."];

  it("refuses 24 or more characters copied from a private result", () => {
    const leaked = "INV-2024-0099-CONFIDENTIAL";
    expect(check(`https://example.com/log?d=${leaked}`, { privateText })?.rule).toBe("copied");
    expect(
      check(`https://example.com/log?d=${encodeURIComponent("your invoice number is INV")}`, {
        privateText,
      })?.rule,
    ).toBe("copied");
  });

  it("allows shorter overlaps and text that is not in a private result", () => {
    expect(check("https://example.com/log?d=INV-2024-0099", { privateText })).toBeNull();
    expect(
      check("https://example.com/log?d=another-completely-different-value", { privateText }),
    ).toBeNull();
  });

  it("does not count the site's own name", () => {
    expect(
      check("https://www.long-example-host.example.com/a", {
        privateText: ["https://www.long-example-host.example.com/b"],
      }),
    ).toBeNull();
  });
});

describe("outboundUrlLeak: a URL the run was given", () => {
  it("passes a URL that appeared in the conversation or a tool result, for every rule", () => {
    const privateText = ["token INV-2024-0099-CONFIDENTIAL-XXXXXXXX"];
    for (const url of [
      "https://example.com/?api_key=abcd1234",
      `https://example.com/?q=${"x".repeat(600)}`,
      "https://example.com/?d=INV-2024-0099-CONFIDENTIAL-XXXXXXXX",
    ]) {
      expect(check(url, { privateText })).not.toBeNull();
      expect(check(url, { privateText, knownUrls: urlsInText(`see ${url}.`) })).toBeNull();
    }
  });

  it("does not pass a URL that only extends a given one", () => {
    const known = urlsInText("open https://example.com/page");
    expect(check("https://example.com/page?api_key=abcd1234", { knownUrls: known })?.rule).toBe(
      "key",
    );
  });
});

describe("outboundUrlsOfCall", () => {
  it("finds the URL of web_fetch, browser navigation and HTTP-like connector tools", () => {
    expect(outboundUrlsOfCall("web_fetch", { url: "https://example.com/a" })).toEqual([
      "https://example.com/a",
    ]);
    expect(outboundUrlsOfCall("browser_navigate", { url: "https://example.com/b" })).toHaveLength(
      1,
    );
    expect(outboundUrlsOfCall("mcp__fetch__fetch", { url: "https://example.com/c" })).toHaveLength(
      1,
    );
    expect(outboundUrlsOfCall("http_request", { endpoint: "https://example.com/d" })).toHaveLength(
      1,
    );
  });

  it("ignores other tools and non-URL values", () => {
    expect(outboundUrlsOfCall("create_task", { url: "https://example.com/e" })).toEqual([]);
    expect(outboundUrlsOfCall("web_fetch", { url: "not a url" })).toEqual([]);
    expect(outboundUrlsOfCall("web_fetch", null)).toEqual([]);
  });
});

describe("urlMayCarryData", () => {
  const carries = (url: string, privateText: string[] = []) =>
    urlMayCarryData({ url, privateText });

  it("passes a plain address", () => {
    expect(carries("https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm")).toBe(
      false,
    );
    expect(carries("https://example.com/")).toBe(false);
  });

  it("flags a query, a fragment, credentials and a long or deep path", () => {
    expect(carries("https://example.com/a?q=1")).toBe(true);
    expect(carries("https://example.com/a#x")).toBe(true);
    expect(carries("https://u:p@example.com/")).toBe(true);
    expect(carries(`https://example.com/${"a".repeat(130)}`)).toBe(true);
    expect(carries("https://example.com/a/b/c/d/e/f/g/h/i")).toBe(true);
  });

  it("flags a token-looking host label or path segment", () => {
    expect(carries("https://c2VjcmV0c2VjcmV0MTIz.example.com/")).toBe(true);
    expect(carries("https://example.com/dGhpc2lzc2VjcmV0ZGF0YTEyMw")).toBe(true);
    expect(carries("https://example.com/0123456789abcdef0123")).toBe(true);
  });

  it("flags a part seen in private results, and passes it when nothing was seen", () => {
    expect(carries("https://example.com/anasouza", ["Customer anasouza owes money"])).toBe(true);
    expect(carries("https://example.com/anasouza")).toBe(false);
  });
});
