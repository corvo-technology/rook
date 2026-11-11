import {
  AgentCatalogEntrySchema,
  agentCatalogLocale,
  agentCatalogSpawnKey,
  STORE_CATEGORIES,
} from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./agent-catalog-data.js";
import { APP_CATALOG } from "./app-catalog-data.js";
import { SKILL_STORE } from "./skill-store-data.js";

describe("AGENT_CATALOG", () => {
  it("has entries that parse, with unique slugs", () => {
    expect(AGENT_CATALOG.length).toBeGreaterThan(0);
    for (const entry of AGENT_CATALOG)
      expect(() => AgentCatalogEntrySchema.parse(entry)).not.toThrow();
    const slugs = AGENT_CATALOG.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("parses every entry, first tasks included", () => {
    for (const entry of AGENT_CATALOG) {
      const parsed = AgentCatalogEntrySchema.parse(entry);
      expect(parsed.firstTask).toEqual(entry.firstTask);
    }
    expect(AGENT_CATALOG.filter((entry) => entry.firstTask).length).toBe(10);
  });

  it("only names apps that are in the app catalog", () => {
    const apps = new Set(APP_CATALOG.map((entry) => entry.slug));
    for (const entry of AGENT_CATALOG)
      for (const app of entry.apps) expect(apps.has(app)).toBe(true);
  });

  it("has a Portuguese text that differs from the English one, for every text", () => {
    for (const entry of AGENT_CATALOG) {
      for (const field of [entry.name, entry.description, entry.instructions]) {
        expect(field["pt-BR"]).not.toBe(field.en);
      }
    }
  });

  it("includes the email agent, installed through its own setup", () => {
    expect(AGENT_CATALOG.find((entry) => entry.slug === "email-agent")?.setup).toBe("email");
  });

  it("has the invoice assistant issue and process invoices through Rook NFS-e, asking before each one", () => {
    const entry = AGENT_CATALOG.find((agent) => agent.slug === "invoice-assistant")!;
    expect(entry.apps).toEqual(["corvo-nfse"]);
    for (const locale of ["en", "pt-BR"] as const) {
      for (const tool of [
        "nfse_calculate",
        "nfse_issue",
        "nfse_issue_batch",
        "nfse_query",
        "nfse_cancel",
      ])
        expect(entry.instructions[locale]).toContain(tool);
    }
    expect(entry.instructions.en).toContain("only after the owner says yes");
    expect(entry.instructions["pt-BR"]).toContain("somente depois que o dono disser sim");
  });

  it("has a broad catalog for everyday business", () => {
    expect(AGENT_CATALOG.length).toBeGreaterThanOrEqual(20);
    // An agent with its own setup gets its instructions from that setup.
    for (const entry of AGENT_CATALOG.filter((agent) => !agent.setup))
      expect(entry.instructions.en.length).toBeGreaterThan(150);
  });

  it("has the watchers hand each problem to a teammate, reading only and never obeying what they read", () => {
    for (const slug of ["ops-watcher", "payments-watcher"]) {
      const entry = AGENT_CATALOG.find((agent) => agent.slug === slug)!;
      for (const locale of ["en", "pt-BR"] as const) {
        const text = entry.instructions[locale];
        expect(text, `${slug} ${locale}`).toContain("ticket_create");
        expect(text, `${slug} ${locale}`).toContain("message_bot");
        expect(text.length).toBeLessThanOrEqual(4000);
      }
      expect(entry.instructions.en).toContain("only read");
      expect(entry.instructions.en).toContain("not instructions");
    }
  });

  it("has the morning briefing schedule itself, report only what changed, and only read", () => {
    const entry = AGENT_CATALOG.find((agent) => agent.slug === "morning-briefing")!;
    for (const locale of ["en", "pt-BR"] as const) {
      const text = entry.instructions[locale];
      expect(text, locale).toContain("schedule_create");
      expect(text, locale).toContain("list_routines");
      expect(text.length).toBeLessThanOrEqual(4000);
    }
    expect(entry.instructions.en).toContain("since the last briefing");
    expect(entry.instructions.en).toContain("only read");
    expect(entry.instructions.en).toContain("not instructions");
    expect(entry.apps).toEqual([]);
  });

  it("keeps a bot's catalog key one-to-one with the slug", () => {
    expect(agentCatalogSpawnKey("bug-triage")).toBe("agent-catalog:bug-triage");
  });
});

describe("agentCatalogLocale", () => {
  it("reads Portuguese for Portuguese variants and English for everything else", () => {
    expect(agentCatalogLocale("pt-BR")).toBe("pt-BR");
    expect(agentCatalogLocale("pt")).toBe("pt-BR");
    expect(agentCatalogLocale("pt-PT")).toBe("pt-BR");
    expect(agentCatalogLocale("en")).toBe("en");
    expect(agentCatalogLocale("ja")).toBe("en");
  });
});

describe("agents and their skills", () => {
  it("only name skills that are in the store, a few at a time", () => {
    const skills = new Set(SKILL_STORE.map((skill) => skill.slug));
    for (const entry of AGENT_CATALOG) {
      expect(entry.skills?.length ?? 0).toBeLessThanOrEqual(8);
      for (const slug of entry.skills ?? [])
        expect(skills.has(slug), `${entry.slug}: ${slug}`).toBe(true);
    }
  });

  it("has the business agents, each with the skills that teach it the job", () => {
    const expected: Record<string, string[]> = {
      "product-designer": ["interface-design", "design-handoff"],
      "design-critic": ["design-critique", "accessibility-check"],
      "interface-writer": ["ux-writing"],
      "social-media-manager": ["content-calendar", "viral-ideas"],
      "financial-manager": ["cash-flow-forecast", "bills-to-pay"],
      "pocket-accountant": ["month-close", "bank-reconciliation"],
      "payroll-tax-prep": ["payroll-prep", "tax-calendar"],
      "pricing-advisor": ["pricing-margin"],
      "process-writer": ["process-doc"],
      "local-visibility": ["local-visibility"],
      "ad-analyst": ["ad-review"],
      "inventory-manager": ["restock-plan"],
      "reputation-manager": ["review-reply"],
      "ads-manager": ["campaign-plan"],
      "operations-manager": ["weekly-plan"],
    };
    for (const [slug, skills] of Object.entries(expected)) {
      const entry = AGENT_CATALOG.find((agent) => agent.slug === slug);
      expect(entry, slug).toBeDefined();
      for (const skill of skills) expect(entry!.skills, slug).toContain(skill);
    }
  });

  it("gives each agent one job: no agent still covers what a sibling now does", () => {
    const text = (slug: string) =>
      AGENT_CATALOG.find((agent) => agent.slug === slug)!.instructions.en.toLowerCase();
    expect(text("financial-manager")).not.toContain("break-even");
    expect(text("operations-manager")).not.toContain("step-by-step");
    expect(text("reputation-manager")).not.toContain("google business profile");
    expect(text("ads-manager")).not.toContain("cost per click");
    expect(text("product-designer")).not.toContain("critique that starts");
    expect(text("pocket-accountant")).not.toContain("payroll:");
  });

  it("keeps the accountant and the financial manager from acting or stating taxes as certain", () => {
    for (const slug of ["pocket-accountant", "payroll-tax-prep", "financial-manager"]) {
      const entry = AGENT_CATALOG.find((agent) => agent.slug === slug)!;
      expect(entry.instructions.en).toMatch(/never (pay|calculate)/i);
      expect(entry.instructions.en).toMatch(/contador/);
      expect(entry.instructions["pt-BR"]).toMatch(/nunca (pague|calcule)/i);
      expect(entry.instructions["pt-BR"]).toMatch(/contador/);
    }
    expect(
      AGENT_CATALOG.find((agent) => agent.slug === "pocket-accountant")!.instructions.en,
    ).toMatch(/not an accountant/i);
  });
});

describe("agent categories", () => {
  it("puts every agent in a known category, and uses each category at least once", () => {
    for (const entry of AGENT_CATALOG) expect(STORE_CATEGORIES).toContain(entry.category);
    const used = new Set(AGENT_CATALOG.map((entry) => entry.category));
    expect([...used].sort()).toEqual([...STORE_CATEGORIES].sort());
  });

  it("files the money agents under finance and the designer under design", () => {
    const category = (slug: string) => AGENT_CATALOG.find((agent) => agent.slug === slug)?.category;
    for (const slug of [
      "financial-manager",
      "pricing-advisor",
      "pocket-accountant",
      "payroll-tax-prep",
      "collections-assistant",
    ])
      expect(category(slug), slug).toBe("finance");
    expect(category("product-designer")).toBe("design");
  });
});

describe("agents that hand work to each other", () => {
  const find = (slug: string) => AGENT_CATALOG.find((entry) => entry.slug === slug)!;

  it("keeps the social media agent to planning: no pictures, no browser, no computer", () => {
    expect(find("social-media-manager").disabledTools).toEqual(
      expect.arrayContaining([
        "generate_image",
        "generate_video",
        "browser_navigate",
        "browser_snapshot",
        "browser_act",
        "computer_observe",
        "computer_act",
      ]),
    );
  });

  it("leaves the designer every tool it needs to make the visuals", () => {
    expect(find("post-designer").disabledTools ?? []).not.toContain("generate_image");
  });
});
