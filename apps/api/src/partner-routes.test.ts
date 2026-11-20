import { createHash } from "node:crypto";
import type { PartnerTemplate } from "@corvo/contracts";
import { verticalPartnerTemplate } from "@corvo/contracts";
import { PartnerAllowanceRefused } from "@corvo/db";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { PartnerRouteDeps } from "./partner-routes.js";
import { mountPartnerRoutes } from "./partner-routes.js";

const KEY_A = "cpk_AAAAAAAA.key-for-partner-a";
const TEMPLATE = {
  connector: { slug: "acme", name: "Acme", endpoint: "https://mcp.acme.example/v1" },
  agents: [{ key: "manager", name: "Manager", instructions: "Run it.", usesConnector: true }],
};
const KEY_COMMERCE = "cpk_CCCCCCCC.key-for-commerce";
const KEY_NO_SCOPE = "cpk_SSSSSSSS.key-without-tenant-scope";
const KEY_B = "cpk_BBBBBBBB.key-for-partner-b";
const NOW = new Date("2026-11-05T12:00:00.000Z");

function fixture(options: { maxRequests?: number; template?: unknown } = {}) {
  const used = new Map<string, number>();
  const partners: Record<
    string,
    { id: string; enabled: boolean; template?: unknown; billingModel?: string; scopes?: string[] }
  > = {
    [KEY_A]: { id: "partner-a", enabled: true, template: options.template },
    [KEY_COMMERCE]: { id: "partner-c", enabled: true, billingModel: "commerce" },
    [KEY_NO_SCOPE]: { id: "partner-s", enabled: true, scopes: ["commerce:read"] },
    [KEY_B]: { id: "partner-b", enabled: true },
    "cpk_DDDDDDDD.key-for-disabled": { id: "partner-d", enabled: false },
  };
  const tenants = new Map<
    string,
    { id: string; organizationId: string; ownerUserId: string; state: string }
  >();
  const codes: Array<Record<string, unknown>> = [];
  const installs: Array<{ partnerId: string; content: unknown }> = [];
  const allowances: Array<{ amountCents: number; period: string }> = [];
  const deps = {
    webOrigin: "https://app.example.test",
    now: () => NOW,
    allowRequest: vi.fn(async (partnerId: string) => {
      const count = (used.get(partnerId) ?? 0) + 1;
      used.set(partnerId, count);
      return count <= (options.maxRequests ?? 1000);
    }),
    authenticate: vi.fn(async (key: string) => {
      const found = partners[key];
      return found?.enabled
        ? {
            id: found.id,
            template: found.template,
            billingModel: found.billingModel,
            scopes: found.scopes,
          }
        : null;
    }),
    provision: vi.fn(
      async (partner: { id: string }, input: { externalTenantId: string; name: string }) => {
        const id = `${partner.id}/${input.externalTenantId}`;
        const existing = tenants.get(id);
        if (existing) {
          return {
            tenantId: existing.id,
            organizationId: existing.organizationId,
            spaceId: existing.organizationId,
            ownerUserId: existing.ownerUserId,
            created: false,
          };
        }
        const row = {
          id: `tenant-${tenants.size + 1}`,
          organizationId: `org-${tenants.size + 1}`,
          ownerUserId: `owner-${tenants.size + 1}`,
          state: "enabled",
        };
        tenants.set(id, row);
        return {
          tenantId: row.id,
          organizationId: row.organizationId,
          spaceId: row.organizationId,
          ownerUserId: row.ownerUserId,
          created: true,
        };
      },
    ),
    findTenant: vi.fn(async (partnerId: string, externalTenantId: string) => {
      const row = tenants.get(`${partnerId}/${externalTenantId}`);
      return row ?? null;
    }),
    setState: vi.fn(async (partnerId: string, externalTenantId: string, state: string) => {
      const row = tenants.get(`${partnerId}/${externalTenantId}`);
      if (!row) return false;
      row.state = state;
      return true;
    }),
    setTemplate: vi.fn(async () => undefined),
    ensureChief: vi.fn(async () => undefined),
    install: vi.fn(async (_actor: unknown, partnerId: string, content: unknown) => {
      installs.push({ partnerId, content });
    }),
    grantAllowance: vi.fn(
      async (_tenant: unknown, input: { amountCents: number; period: string }) => {
        allowances.push(input);
      },
    ),
    storeEntryCode: vi.fn(async (row: Record<string, unknown>) => {
      codes.push(row);
    }),
  } satisfies PartnerRouteDeps;
  const app = new Hono();
  mountPartnerRoutes(app, deps);
  const call = (
    method: string,
    path: string,
    options: { key?: string | null; body?: unknown; raw?: string } = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(options.key === null ? {} : { authorization: `Bearer ${options.key ?? KEY_A}` }),
      },
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  return { deps, call, tenants, codes, installs, allowances };
}

const put = "/api/partner/v1/tenants/shop-1";

describe("partner routes: authentication", () => {
  it("refuses a missing key, a wrong key, a disabled partner and a malformed key the same way", async () => {
    const f = fixture();
    const bodies: string[] = [];
    for (const key of [null, "cpk_ZZZZZZZZ.not-a-real-key", "cpk_DDDDDDDD.key-for-disabled", "x"]) {
      const res = await f.call("PUT", put, { key, body: { name: "Shop" } });
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(f.deps.provision).not.toHaveBeenCalled();
  });

  it("refuses an over-long key without looking anything up", async () => {
    const f = fixture();
    const res = await f.call("PUT", put, {
      key: `cpk_${"a".repeat(5000)}`,
      body: { name: "Shop" },
    });
    expect(res.status).toBe(401);
    expect(f.deps.authenticate).not.toHaveBeenCalled();
  });
});

describe("partner routes: tenants", () => {
  it("provisions a customer, and a repeat creates nothing new", async () => {
    const f = fixture();
    const first = await f.call("PUT", put, { body: { name: "Shop One" } });
    expect(first.status).toBe(200);
    const created = (await first.json()) as { tenantId: string; created: boolean };
    expect(created.created).toBe(true);
    const second = await f.call("PUT", put, { body: { name: "Shop One" } });
    await expect(second.json()).resolves.toEqual({ tenantId: created.tenantId, created: false });
    expect(f.tenants.size).toBe(1);
  });

  it("gives every customer the Chief, before its agents, even when no agent is sent", async () => {
    const f = fixture();
    const res = await f.call("PUT", put, { body: { name: "Shop" } });
    expect(res.status).toBe(200);
    expect(f.deps.ensureChief).toHaveBeenCalledOnce();
    expect(f.deps.ensureChief).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: expect.any(String), userId: expect.any(String) }),
      "en",
    );
    expect(f.installs).toHaveLength(0);
  });

  it("makes the Chief in the language the call names, and in English when it names none or an unknown one", async () => {
    for (const [locale, expected] of [
      ["pt-BR", "pt-BR"],
      ["pt", "pt-BR"],
      ["pt-PT", "pt-BR"],
      ["fr", "en"],
      ["not a language", "en"],
      [undefined, "en"],
    ] as const) {
      const f = fixture();
      const res = await f.call("PUT", put, { body: { name: "Shop", locale } });
      expect(res.status, String(locale)).toBe(200);
      expect(f.deps.ensureChief, String(locale)).toHaveBeenCalledWith(expect.anything(), expected);
    }
  });

  it("names the Chief as the partner's template says, in the customer's language", async () => {
    const f = fixture({ template: { agents: [], chiefName: "Assistente Acme" } });
    await f.call("PUT", put, { body: { name: "Shop", locale: "pt-BR" } });
    expect(f.deps.ensureChief).toHaveBeenCalledWith(expect.anything(), "pt-BR", {
      name: "Assistente Acme",
    });
  });

  it("leaves the Chief's default name when the template has none or is not valid", async () => {
    for (const template of [{ agents: [] }, { agents: [], chiefName: "" }, { chiefName: 7 }]) {
      const f = fixture({ template });
      await f.call("PUT", put, { body: { name: "Shop" } });
      expect(f.deps.ensureChief).toHaveBeenCalledWith(expect.anything(), "en");
    }
  });

  it("installs the connector and agents and sets the month's allowance when sent", async () => {
    const f = fixture();
    await f.call("PUT", put, {
      body: {
        name: "Shop",
        connector: {
          slug: "acme",
          name: "Acme",
          endpoint: "https://mcp.acme.example/v1",
          token: "t",
        },
        agents: [{ key: "manager", name: "Manager", instructions: "Run it.", usesConnector: true }],
        allowanceCents: 1500,
      },
    });
    expect(f.installs).toHaveLength(1);
    expect(f.installs[0]?.partnerId).toBe("partner-a");
    expect(f.allowances).toEqual([{ amountCents: 1500, period: "2026-11" }]);
  });

  it("still sets the customer up but answers 402 when the partner's credit cannot cover the allowance", async () => {
    const f = fixture();
    (f.deps.grantAllowance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PartnerAllowanceRefused("wallet"),
    );
    const response = await f.call("PUT", put, { body: { name: "Shop", allowanceCents: 500 } });
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "wallet_insufficient",
      tenantId: expect.any(String),
    });
    expect(f.tenants.size).toBe(1);
  });

  it("refuses a pass-on from a wallet to a commerce partner, whose credit comes from plans", async () => {
    const f = fixture();
    const response = await f.call("PUT", put, {
      key: KEY_COMMERCE,
      body: { name: "Shop", allowanceCents: 500 },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "commerce_partner" });
    expect(f.allowances).toEqual([]);
  });

  it("refuses a key without the tenants scope after authenticating it", async () => {
    const f = fixture();
    const response = await f.call("PUT", put, { key: KEY_NO_SCOPE, body: { name: "Shop" } });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "scope" });
    expect(f.tenants.size).toBe(0);
  });

  it("answers 409 when the allowance is over a limit the partner set", async () => {
    const f = fixture();
    (f.deps.grantAllowance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PartnerAllowanceRefused("limit"),
    );
    const response = await f.call("PUT", put, { body: { name: "Shop", allowanceCents: 500 } });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "allowance_limit" });
  });

  it("gives a new customer the template's agents and connector when the call names only the customer", async () => {
    const f = fixture({ template: TEMPLATE });
    await f.call("PUT", put, { body: { name: "Shop", connectorToken: "tok-1" } });
    expect(f.installs[0]?.content).toEqual({
      connector: { ...TEMPLATE.connector, token: "tok-1" },
      agents: TEMPLATE.agents,
    });
  });

  it("gives the template's agents but no connector when no token comes with the call", async () => {
    const f = fixture({ template: TEMPLATE });
    await f.call("PUT", put, { body: { name: "Shop" } });
    expect(f.installs[0]?.content).toEqual({ connector: undefined, agents: TEMPLATE.agents });
  });

  it("lets what the call names win over the template", async () => {
    const f = fixture({ template: TEMPLATE });
    const agents = [{ key: "solo", name: "Solo", instructions: "Help.", usesConnector: false }];
    await f.call("PUT", put, { body: { name: "Shop", agents } });
    expect(f.installs[0]?.content).toMatchObject({ agents });
  });

  it("hands the template's scheduled routines and the customer's timezone to the install", async () => {
    const scheduledRoutines = [
      {
        key: "tomorrow",
        agent: "manager",
        name: "Confirm tomorrow",
        prompt: "List tomorrow's appointments.",
        crons: ["0 18 * * *"],
        active: true,
      },
    ];
    const f = fixture({ template: { ...TEMPLATE, timezone: "UTC", scheduledRoutines } });
    await f.call("PUT", put, { body: { name: "Shop", timezone: "America/Sao_Paulo" } });
    expect(f.installs[0]?.content).toMatchObject({
      scheduledRoutines,
      timezone: "America/Sao_Paulo",
    });
    await f.call("PUT", put, { body: { name: "Shop" } });
    expect(f.installs[1]?.content).toMatchObject({ timezone: "UTC" });
  });

  it("ignores a stored template that is no longer valid", async () => {
    const f = fixture({ template: { agents: "nonsense" } });
    await f.call("PUT", put, { body: { name: "Shop" } });
    expect(f.installs).toHaveLength(0);
  });

  it("answers 400, not 500, when the connector address is not one this deployment may call", async () => {
    const f = fixture();
    f.deps.install.mockRejectedValueOnce(
      Object.assign(new Error("not allowed"), { code: "BAD_REQUEST" }),
    );
    const res = await f.call("PUT", put, {
      body: {
        name: "Shop",
        connector: { slug: "acme", name: "Acme", endpoint: "http://10.0.0.1/mcp", token: "t" },
      },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("not allowed");
  });

  it("suspends through PUT state, and through the suspend and resume routes", async () => {
    const f = fixture();
    await f.call("PUT", put, { body: { name: "Shop", state: "suspended" } });
    expect(f.tenants.get("partner-a/shop-1")?.state).toBe("suspended");
    const resume = await f.call("POST", `${put}/resume`);
    expect(resume.status).toBe(200);
    expect(f.tenants.get("partner-a/shop-1")?.state).toBe("enabled");
    await f.call("POST", `${put}/suspend`);
    expect(f.tenants.get("partner-a/shop-1")?.state).toBe("suspended");
  });

  it("answers the same for a customer that does not exist and one that belongs to another partner", async () => {
    const f = fixture();
    await f.call("PUT", put, { body: { name: "Shop" } });
    const other = await f.call("POST", `${put}/suspend`, { key: KEY_B });
    const unknown = await f.call("POST", "/api/partner/v1/tenants/nope/suspend");
    expect(other.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await other.text()).toBe(await unknown.text());
    expect(f.tenants.get("partner-a/shop-1")?.state).toBe("enabled");
  });

  it("rejects unknown fields, a bad id and a body that is too large", async () => {
    const f = fixture();
    expect((await f.call("PUT", put, { body: { name: "Shop", admin: true } })).status).toBe(400);
    expect((await f.call("PUT", put, { body: { name: "" } })).status).toBe(400);
    expect((await f.call("PUT", put, { raw: "{not json" })).status).toBe(400);
    expect(
      (await f.call("PUT", "/api/partner/v1/tenants/bad%20id!", { body: { name: "S" } })).status,
    ).toBe(400);
    const big = await f.call("PUT", put, { raw: JSON.stringify({ name: "x".repeat(300_000) }) });
    expect(big.status).toBe(413);
    expect(f.deps.provision).not.toHaveBeenCalled();
  });
});

describe("partner routes: sessions", () => {
  const session = "/api/partner/v1/sessions";

  it("returns a link on the web origin that lives 60 seconds, and stores only the hash of its code", async () => {
    const f = fixture();
    await f.call("PUT", put, { body: { name: "Shop" } });
    const res = await f.call("POST", session, {
      body: { externalTenantId: "shop-1", externalUserId: "user-9", email: "ana@example.test" },
    });
    expect(res.status).toBe(200);
    const {
      url,
      code: returned,
      expiresAt,
    } = (await res.json()) as {
      url: string;
      code: string;
      expiresAt: string;
    };
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://app.example.test");
    expect(parsed.pathname).toBe("/api/partner/enter");
    const code = parsed.searchParams.get("code") ?? "";
    expect(code.length).toBeGreaterThanOrEqual(40);
    expect(returned).toBe(code);
    expect(expiresAt).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect(f.codes).toHaveLength(1);
    const stored = f.codes[0] ?? {};
    expect(stored.codeHash).toBe(createHash("sha256").update(code).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(stored).toMatchObject({
      partnerId: "partner-a",
      externalUserId: "user-9",
      externalEmail: "ana@example.test",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
  });

  it("makes a different code every time", async () => {
    const f = fixture();
    await f.call("PUT", put, { body: { name: "Shop" } });
    const body = { externalTenantId: "shop-1", externalUserId: "u" };
    await f.call("POST", session, { body });
    await f.call("POST", session, { body });
    expect(new Set(f.codes.map((c) => c.codeHash)).size).toBe(2);
  });

  it("refuses an unknown, foreign or suspended customer without creating a code", async () => {
    const f = fixture();
    await f.call("PUT", put, { body: { name: "Shop", state: "suspended" } });
    const body = { externalTenantId: "shop-1", externalUserId: "u" };
    const suspended = await f.call("POST", session, { body });
    const foreign = await f.call("POST", session, { key: KEY_B, body });
    const unknown = await f.call("POST", session, { body: { ...body, externalTenantId: "nope" } });
    expect([suspended.status, foreign.status, unknown.status]).toEqual([404, 404, 404]);
    expect(await suspended.text()).toBe(await unknown.text());
    expect(f.codes).toHaveLength(0);
  });

  it("stores no role or scope for a session that sends none, so it opens the owner as before", async () => {
    const f = fixture();
    await f.call("PUT", put, { body: { name: "Shop" } });
    await f.call("POST", session, { body: { externalTenantId: "shop-1", externalUserId: "u" } });
    expect(f.codes[0]).toMatchObject({ role: null, scope: null });
  });

  it("stores the role and scope the partner sends, and a later session replaces them", async () => {
    const f = fixture();
    await f.call("PUT", put, { body: { name: "Shop" } });
    const body = { externalTenantId: "shop-1", externalUserId: "u-1" };
    await f.call("POST", session, {
      body: {
        ...body,
        role: " Professional ",
        scope: { professionalId: "p-1", branchIds: ["b-1", "b-2"] },
      },
    });
    await f.call("POST", session, { body: { ...body, role: "reception" } });
    expect(f.codes[0]).toMatchObject({
      role: "professional",
      scope: { professionalId: "p-1", branchIds: ["b-1", "b-2"] },
    });
    expect(f.codes[1]).toMatchObject({ role: "reception", scope: null });
  });

  it("rejects a role or scope that is not well formed", async () => {
    const f = fixture();
    await f.call("PUT", put, { body: { name: "Shop" } });
    const base = { externalTenantId: "shop-1", externalUserId: "u" };
    const bad = [
      { role: "not a role" },
      { role: "x".repeat(40) },
      { scope: { "bad key": "x" } },
      { scope: { professionalId: { nested: true } } },
      { scope: { branchIds: Array.from({ length: 51 }, (_, i) => `b${i}`) } },
    ];
    for (const extra of bad) {
      expect((await f.call("POST", session, { body: { ...base, ...extra } })).status).toBe(400);
    }
    expect(f.codes).toHaveLength(0);
  });

  it("rejects a malformed request", async () => {
    const f = fixture();
    expect((await f.call("POST", session, { body: { externalTenantId: "shop-1" } })).status).toBe(
      400,
    );
    expect(
      (
        await f.call("POST", session, {
          body: { externalTenantId: "s", externalUserId: "u", email: "no" },
        })
      ).status,
    ).toBe(400);
  });
});

describe("partner routes: the partner's own template", () => {
  const route = "/api/partner/v1/template";

  it("reads the stored template, or null when there is none or it is no longer valid", async () => {
    const stored = await fixture({ template: TEMPLATE }).call("GET", route);
    expect(await stored.json()).toEqual({ template: TEMPLATE });
    const none = await fixture().call("GET", route);
    expect(await none.json()).toEqual({ template: null });
    const broken = await fixture({ template: { agents: "x" } }).call("GET", route);
    expect(await broken.json()).toEqual({ template: null });
  });

  it("stores a whole template for the calling partner only", async () => {
    const f = fixture();
    const res = await f.call("PUT", route, { body: { template: TEMPLATE } });
    expect(res.status).toBe(200);
    expect(f.deps.setTemplate).toHaveBeenCalledWith("partner-a", TEMPLATE);
    await f.call("PUT", route, { key: KEY_B, body: { template: null } });
    expect(f.deps.setTemplate).toHaveBeenLastCalledWith("partner-b", null);
  });

  it("starts from a vertical the code ships, without any connector", async () => {
    const f = fixture();
    const res = await f.call("PUT", route, { body: { vertical: "barbearia_salao" } });
    expect(res.status).toBe(200);
    const saved = f.deps.setTemplate.mock.calls[0]?.[1] as unknown as PartnerTemplate;
    expect(saved).toEqual(verticalPartnerTemplate("barbearia_salao"));
    expect(saved.connector).toBeUndefined();
    expect(saved.routines?.length).toBeGreaterThan(0);
  });

  it("refuses an unknown vertical, an invalid template, extra fields and a key without the scope", async () => {
    const f = fixture();
    for (const body of [
      { vertical: "spaceship" },
      { template: { agents: [], accent: "red" } },
      { vertical: "clinica", template: null },
      {},
    ]) {
      expect((await f.call("PUT", route, { body })).status).toBe(400);
    }
    const noScope = await f.call("PUT", route, {
      key: KEY_NO_SCOPE,
      body: { vertical: "clinica" },
    });
    expect(noScope.status).toBe(403);
    expect((await f.call("GET", route, { key: null })).status).toBe(401);
    expect(f.deps.setTemplate).not.toHaveBeenCalled();
  });

  it("gives a new customer the partner's own stored template, never another partner's", async () => {
    const f = fixture({ template: TEMPLATE });
    await f.call("PUT", put, { key: KEY_B, body: { name: "S" } });
    expect(f.installs).toEqual([]);
    await f.call("PUT", put, { body: { name: "S", connectorToken: "t" } });
    expect(f.installs).toHaveLength(1);
    expect(f.installs[0]?.partnerId).toBe("partner-a");
  });
});

describe("partner routes: rate limit", () => {
  it("limits each partner on its own", async () => {
    const f = fixture({ maxRequests: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push((await f.call("PUT", put, { body: { name: "S" } })).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect((await f.call("PUT", put, { key: KEY_B, body: { name: "S" } })).status).toBe(200);
  });
});
