import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseTemplateFile, runPartnerCommand } from "./partner-command.js";

function deps() {
  return {
    createPartner: vi.fn(async (input: { slug: string; name: string }) => ({
      partner: { slug: input.slug, name: input.name },
      key: "cpk_FAKE.fake-secret",
    })),
    rotatePartnerKey: vi.fn(async (slug: string) => ({
      partner: { slug, name: "Acme" },
      key: "cpk_NEW.new-secret",
    })),
    setPartnerEnabled: vi.fn(async () => undefined),
    findUserIdByEmail: vi.fn(async (email: string) =>
      email === "owner@example.test" ? "user-1" : null,
    ),
    readFile: vi.fn(async () => TEMPLATE),
    setTemplate: vi.fn(async () => true),
    setWebhookUrl: vi.fn(async () => ({ id: "p1", webhookSecretVersion: 0 })),
    findPartner: vi.fn(
      async (): Promise<{ id: string; webhookSecretVersion: number } | null> => ({
        id: "p1",
        webhookSecretVersion: 0,
      }),
    ),
    rotateWebhookSecret: vi.fn(async () => ({ id: "p1", webhookSecretVersion: 1 })),
    webhookSecret: vi.fn(
      (p: { webhookSecretVersion: number }) => `whsec_v${p.webhookSecretVersion}`,
    ),
    setScribeRetentionDays: vi.fn(async () => undefined),
    configureCommerce: vi.fn(async () => ({
      billingModel: "commerce",
      mode: "embedded",
      currency: "BRL",
      commissionBps: 2000,
    })),
    seedCatalog: vi.fn(async () => undefined),
    recordFxRate: vi.fn(async () => undefined),
  };
}

const TEMPLATE = JSON.stringify({
  connector: { slug: "greenflow", name: "Greenflow", endpoint: "{{MCP_PUBLIC_URL}}" },
  agents: [{ key: "recepcao", name: "Recepção", instructions: "x", usesConnector: true }],
  chiefName: "Assistente Teste",
});

describe("partner command", () => {
  it("creates a partner and shows its key once, saying it cannot be shown again", async () => {
    const d = deps();
    const output = await runPartnerCommand(["create", "acme-saas", "Acme SaaS"], d);
    expect(d.createPartner).toHaveBeenCalledWith({ slug: "acme-saas", name: "Acme SaaS" });
    expect(output).toContain("cpk_FAKE.fake-secret");
    expect(output.toLowerCase()).toContain("will not be shown again");
  });

  it("rotates a key, and says the old one stopped working", async () => {
    const d = deps();
    const output = await runPartnerCommand(["rotate", "acme-saas"], d);
    expect(d.rotatePartnerKey).toHaveBeenCalledWith("acme-saas");
    expect(output).toContain("cpk_NEW.new-secret");
    expect(output.toLowerCase()).toContain("old key no longer works");
  });

  it("disables and enables a partner without printing any key", async () => {
    const d = deps();
    await expect(runPartnerCommand(["disable", "acme-saas"], d)).resolves.not.toContain("cpk_");
    await expect(runPartnerCommand(["enable", "acme-saas"], d)).resolves.not.toContain("cpk_");
    expect(d.setPartnerEnabled).toHaveBeenNthCalledWith(1, "acme-saas", false);
    expect(d.setPartnerEnabled).toHaveBeenNthCalledWith(2, "acme-saas", true);
  });

  it("refuses a missing or unknown command and a slug that is not safe, before touching anything", async () => {
    const d = deps();
    await expect(runPartnerCommand([], d)).rejects.toThrow(/usage/i);
    await expect(runPartnerCommand(["explode", "acme"], d)).rejects.toThrow(/usage/i);
    await expect(runPartnerCommand(["create", "Bad Slug!", "Acme"], d)).rejects.toThrow(/slug/i);
    await expect(runPartnerCommand(["create", "acme"], d)).rejects.toThrow(/usage/i);
    expect(d.createPartner).not.toHaveBeenCalled();
    expect(d.rotatePartnerKey).not.toHaveBeenCalled();
    expect(d.setPartnerEnabled).not.toHaveBeenCalled();
  });

  it("makes a partner that draws on a named account's credit", async () => {
    const d = deps();
    await runPartnerCommand(
      ["create", "divellas", "Divellas", "--wallet-owner", "owner@example.test"],
      d,
    );
    expect(d.createPartner).toHaveBeenCalledWith({
      slug: "divellas",
      name: "Divellas",
      walletOwnerUserId: "user-1",
    });
    await expect(
      runPartnerCommand(["create", "prontu", "Prontu", "--wallet-owner", "nobody@example.test"], d),
    ).rejects.toThrow(/no account/i);
  });

  it("applies a template, filling in the MCP address, and says what it set", async () => {
    const d = deps();
    const output = await runPartnerCommand(
      ["apply-template", "greenbarber", "t.json", "--mcp-url", "https://mcp.example.test/"],
      d,
    );
    expect(d.setTemplate).toHaveBeenCalledWith(
      "greenbarber",
      expect.objectContaining({
        chiefName: "Assistente Teste",
        connector: expect.objectContaining({ endpoint: "https://mcp.example.test" }),
      }),
    );
    expect(output).toContain("Recepção");
  });

  it("applying the same template twice stores the same thing", async () => {
    const d = deps();
    const argv = [
      "apply-template",
      "greenbarber",
      "t.json",
      "--mcp-url",
      "https://mcp.example.test",
    ];
    await runPartnerCommand(argv, d);
    await runPartnerCommand(argv, d);
    expect(d.setTemplate.mock.calls[0]).toEqual(d.setTemplate.mock.calls[1]);
  });

  it("refuses a template with an unfilled address, bad JSON or invalid fields, storing nothing", async () => {
    const d = deps();
    await expect(runPartnerCommand(["apply-template", "greenbarber", "t.json"], d)).rejects.toThrow(
      /--mcp-url/,
    );
    await expect(
      runPartnerCommand(
        ["apply-template", "greenbarber", "t.json", "--mcp-url", "http://evil.test"],
        d,
      ),
    ).rejects.toThrow(/https/);
    d.readFile.mockResolvedValueOnce("{nope");
    await expect(
      runPartnerCommand(
        ["apply-template", "greenbarber", "t.json", "--mcp-url", "https://m.test"],
        d,
      ),
    ).rejects.toThrow(/JSON/);
    d.readFile.mockResolvedValueOnce(JSON.stringify({ agents: [], accent: "red" }));
    await expect(
      runPartnerCommand(
        ["apply-template", "greenbarber", "t.json", "--mcp-url", "https://m.test"],
        d,
      ),
    ).rejects.toThrow(/accent/);
    expect(d.setTemplate).not.toHaveBeenCalled();
    d.setTemplate.mockResolvedValueOnce(false);
    await expect(
      runPartnerCommand(["apply-template", "ghost", "t.json", "--mcp-url", "https://m.test"], d),
    ).rejects.toThrow(/unknown partner/i);
  });

  it("sets, shows, rotates and removes the webhook, printing the secret only for the partner", async () => {
    const d = deps();
    const set = await runPartnerCommand(
      ["webhook", "greenbarber", "https://hooks.example.test/rook"],
      d,
    );
    expect(d.setWebhookUrl).toHaveBeenCalledWith("greenbarber", "https://hooks.example.test/rook");
    expect(set).toContain("whsec_v0");
    expect(await runPartnerCommand(["webhook-secret", "greenbarber"], d)).toContain("whsec_v0");
    expect(await runPartnerCommand(["webhook-rotate", "greenbarber"], d)).toContain("whsec_v1");
    expect(await runPartnerCommand(["webhook", "greenbarber", "off"], d)).not.toContain("whsec_");
    expect(d.setWebhookUrl).toHaveBeenLastCalledWith("greenbarber", null);
    await expect(
      runPartnerCommand(["webhook", "greenbarber", "http://insecure.test"], d),
    ).rejects.toThrow(/https/);
  });
});

describe("the shipped templates", () => {
  const dir = new URL("../partner-templates/", import.meta.url);
  const expected: Record<string, string[]> = {
    greenbarber: ["Recepção", "Retorno de clientes", "Gestor"],
    divellas: ["Recepção", "Pós-atendimento", "Gestor"],
    prontu: ["Recepção", "Assistente de prontuário", "Gestor"],
  };
  const presets: Record<string, string[]> = {
    greenbarber: ["best_slot", "customer_summary"],
    divellas: [],
    prontu: ["evolution", "anamnesis", "prescription_draft"],
  };
  for (const [slug, names] of Object.entries(expected)) {
    it(`${slug} is a valid template with its agents, four starters each, the Store hidden`, async () => {
      const raw = await readFile(new URL(`${slug}.json`, dir), "utf8");
      const template = parseTemplateFile(raw, "https://mcp.example.test");
      expect(template.agents.map((agent) => agent.name)).toEqual(names);
      expect(template.connector).toEqual({
        slug: "greenflow",
        name: "Greenflow",
        endpoint: "https://mcp.example.test",
      });
      expect(template.hide).toEqual(["store"]);
      expect(template.models).toBeUndefined();
      expect(template.chiefName).toMatch(/^Assistente /);
      expect(template.quickActions?.length).toBeGreaterThanOrEqual(3);
      // The tasks the partner's pages run by name, each with a schema that can check an answer.
      expect(Object.keys(template.assist ?? {})).toEqual(presets[slug]);
      for (const preset of Object.values(template.assist ?? {})) {
        if (preset.schema) expect(() => z.fromJSONSchema(preset.schema as never)).not.toThrow();
      }
      for (const agent of template.agents) {
        expect(agent.usesConnector).toBe(true);
        expect(agent.starters).toHaveLength(4);
        expect(agent.instructions).toMatch(/aprovação do dono/);
        expect(agent.instructions).toMatch(/Nunca assine/);
      }
      expect(() => parseTemplateFile(raw)).toThrow(/--mcp-url/);
    });
  }

  it("turns a partner into a commerce partner and says what that means", async () => {
    const d = deps();
    const output = await runPartnerCommand(
      [
        "commerce",
        "acme-saas",
        "--billing-model",
        "commerce",
        "--country",
        "BR",
        "--commission-bps",
        "2000",
      ],
      d,
    );
    expect(d.configureCommerce).toHaveBeenCalledWith("acme-saas", {
      billingModel: "commerce",
      country: "BR",
      commissionBps: 2000,
    });
    expect(output).toContain("BRL");
    expect(output).toContain("20%");
  });

  it("refuses a commerce flag on another command and an unsafe checkout address", async () => {
    const d = deps();
    await expect(
      runPartnerCommand(["rotate", "acme-saas", "--country", "BR"], d),
    ).rejects.toThrow();
    await expect(
      runPartnerCommand(["commerce", "acme-saas", "--checkout-url", "http://shop.example"], d),
    ).rejects.toThrow(/https/);
  });

  it("loads a catalog file and a manual exchange rate", async () => {
    const d = deps();
    d.readFile.mockResolvedValueOnce(JSON.stringify({ plans: [], packs: [] }));
    await runPartnerCommand(["catalog-seed", "catalog.json"], d);
    expect(d.seedCatalog).toHaveBeenCalledWith({ plans: [], packs: [] });
    await runPartnerCommand(["fx-set", "BRL", "5.12", "--date", "2026-11-01"], d);
    expect(d.recordFxRate).toHaveBeenCalledWith({
      quote: "BRL",
      rate: "5.12",
      validFrom: new Date("2026-11-01T00:00:00Z"),
    });
  });
});
