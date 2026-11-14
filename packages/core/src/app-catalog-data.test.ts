import { APP_CATEGORIES, AppCatalogEntrySchema, McpServerConfigInput } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { appCatalogToMcpConfig } from "./app-catalog.js";
import { APP_CATALOG } from "./app-catalog-data.js";

describe("APP_CATALOG", () => {
  it("has entries that parse, with unique slugs", () => {
    expect(APP_CATALOG.length).toBeGreaterThan(0);
    for (const entry of APP_CATALOG) expect(() => AppCatalogEntrySchema.parse(entry)).not.toThrow();
    const slugs = APP_CATALOG.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("converts every entry to a valid MCP server config", () => {
    for (const entry of APP_CATALOG) {
      const config = appCatalogToMcpConfig(
        entry,
        entry.auth.kind === "key" ? "test-key" : undefined,
      );
      expect(() => McpServerConfigInput.parse(config)).not.toThrow();
    }
  });

  it("features between 4 and 8 apps", () => {
    const featured = APP_CATALOG.filter((entry) => entry.featured).length;
    expect(featured).toBeGreaterThanOrEqual(4);
    expect(featured).toBeLessThanOrEqual(8);
  });

  it("adds Resend with its hosted server and an API key as a bearer token", () => {
    const resend = APP_CATALOG.find((entry) => entry.slug === "resend");
    expect(resend?.endpoint).toBe("https://mcp.resend.com/mcp");
    expect(appCatalogToMcpConfig(resend!, " re_test ")).toMatchObject({
      headers: { Authorization: "Bearer re_test" },
    });
  });

  it("adds GitHub with its hosted server and a personal access token as a bearer token", () => {
    const github = APP_CATALOG.find((entry) => entry.slug === "github");
    expect(github?.endpoint).toBe("https://api.githubcopilot.com/mcp/");
    expect(github?.auth.kind).toBe("key");
    expect(appCatalogToMcpConfig(github!, " ghp_test ")).toMatchObject({
      headers: { Authorization: "Bearer ghp_test" },
    });
  });

  it("adds Grafana, Rook NFS-e, MillionSend and Executor as hosted servers that sign in with OAuth", () => {
    const endpoints = {
      executor: "https://mcp.executor.sh/mcp",
      grafana: "https://mcp.grafana.com/mcp",
      "corvo-nfse": "https://api.corvo.tech/mcp",
      millionsend: "https://api.millionsend.com/mcp",
    };
    for (const [slug, endpoint] of Object.entries(endpoints)) {
      const entry = APP_CATALOG.find((item) => item.slug === slug);
      expect(entry?.endpoint).toBe(endpoint);
      expect(entry?.auth.kind).toBe("oauth");
    }
  });

  it("only uses known categories", () => {
    for (const entry of APP_CATALOG) expect(APP_CATEGORIES).toContain(entry.category);
  });
});
