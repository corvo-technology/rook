import type { Actor, CreateBotInput } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PartnerContent } from "./partner-content.js";
import { installPartnerTenantContent } from "./partner-content.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "owner-1",
  email: "owner@partner.invalid",
  isDeploymentOwner: false,
};
const partnerId = "partner-1";

function fixture(options: { unsafeEndpoint?: boolean } = {}) {
  const servers: Array<Record<string, unknown>> = [];
  const secrets = new Map<string, { id: string; ciphertext: string }>();
  const assignments: Array<{ botId: string; serverId: string }> = [];
  const bots = new Map<string, { id: string; instructions: string; name: string }>();
  const putCalls: string[] = [];
  let counter = 0;

  const tx = {
    secret: {
      create: vi.fn(async ({ data }: { data: { id: string; ciphertext: string } }) => {
        secrets.set(data.id, { id: data.id, ciphertext: data.ciphertext });
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        secrets.delete(where.id);
      }),
    },
    mcpServer: {
      findFirst: vi.fn(async ({ where }: { where: { slug: string } }) =>
        servers.find((server) => server.slug === where.slug),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `server-${++counter}`, ...data };
        servers.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        Object.assign(servers.find((server) => server.id === where.id) ?? {}, data);
      }),
    },
    botMcpServer: {
      upsert: vi.fn(async ({ create }: { create: { botId: string; serverId: string } }) => {
        if (!assignments.some((a) => a.botId === create.botId && a.serverId === create.serverId))
          assignments.push({ botId: create.botId, serverId: create.serverId });
      }),
    },
  };
  const routines = new Map<string, Record<string, unknown>>();
  const prisma = {
    ...tx,
    routine: {
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { botId_templateKey: { botId: string; templateKey: string } };
          create: Record<string, unknown>;
        }) => {
          const key = `${where.botId_templateKey.botId}:${where.botId_templateKey.templateKey}`;
          // Like the real upsert with an empty update: an existing row stays as it is.
          if (!routines.has(key)) routines.set(key, create);
        },
      ),
    },
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const deps = {
    prisma: prisma as never,
    secrets: {
      put: vi.fn(async (value: string) => {
        putCalls.push(value);
        return { id: `secret-${++counter}`, ciphertext: `sealed:${value.length}` };
      }),
    } as never,
    assertEndpoint: vi.fn(async (endpoint: string) => {
      if (options.unsafeEndpoint) throw new Error(`Endpoint ${endpoint} is not allowed`);
    }),
    // Like the repository: the same spawn key in a space returns the same bot, untouched.
    createBot: vi.fn(async (_actor: Actor, input: CreateBotInput) => {
      const key = String(input.spawnKey);
      const existing = bots.get(key);
      if (existing) return { id: existing.id };
      const bot = { id: `bot-${++counter}`, instructions: input.instructions, name: input.name };
      bots.set(key, bot);
      return { id: bot.id };
    }),
  };
  return { deps, servers, secrets, assignments, bots, putCalls, tx, routines };
}

const content: PartnerContent = {
  connector: {
    slug: "acme-system",
    name: "Acme system",
    endpoint: "https://mcp.acme.example/v1",
    token: "tenant-token-1",
  },
  agents: [
    { key: "manager", name: "Manager", instructions: "Run the day.", usesConnector: true },
    { key: "writer", name: "Writer", instructions: "Write replies.", usesConnector: false },
  ],
};

describe("installPartnerTenantContent", () => {
  it("makes one connector and one agent per key, however many times it runs", async () => {
    const f = fixture();
    const first = await installPartnerTenantContent(f.deps, actor, partnerId, content);
    const second = await installPartnerTenantContent(f.deps, actor, partnerId, content);
    expect(f.servers).toHaveLength(1);
    expect(f.bots.size).toBe(2);
    expect(second.botIds).toEqual(first.botIds);
    expect([...f.bots.keys()]).toEqual([
      `partner:${partnerId}:manager`,
      `partner:${partnerId}:writer`,
    ]);
  });

  it("starts no work: agents are made without their first run", async () => {
    const f = fixture();
    await installPartnerTenantContent(f.deps, actor, partnerId, content);
    for (const [, input] of f.deps.createBot.mock.calls) expect(input.intro).toBe(false);
  });

  it("gives an agent the starters the partner defined, and none when it defined none", async () => {
    const f = fixture();
    await installPartnerTenantContent(f.deps, actor, partnerId, {
      agents: [
        {
          key: "manager",
          name: "Manager",
          instructions: "Run the day.",
          usesConnector: false,
          starters: ["Show today's bookings", "Who has not paid?"],
        },
        { key: "writer", name: "Writer", instructions: "Write replies.", usesConnector: false },
      ],
    });
    const [manager, writer] = f.deps.createBot.mock.calls.map(([, input]) => input);
    expect(manager?.starters).toEqual(["Show today's bookings", "Who has not paid?"]);
    expect(writer?.starters).toBeUndefined();
  });

  it("gives the connector only to the agents that use it", async () => {
    const f = fixture();
    const result = await installPartnerTenantContent(f.deps, actor, partnerId, content);
    expect(f.assignments).toEqual([
      { botId: result.botIds.manager, serverId: String(f.servers[0]?.id) },
    ]);
  });

  it("rotates the stored token without touching what the agents are", async () => {
    const f = fixture();
    await installPartnerTenantContent(f.deps, actor, partnerId, content);
    const before = [...f.bots.values()].map((bot) => ({ ...bot }));
    const firstSecret = String(f.servers[0]?.secretId);
    await installPartnerTenantContent(f.deps, actor, partnerId, {
      ...content,
      connector: { ...content.connector!, token: "tenant-token-2" },
      agents: content.agents.map((agent) => ({
        ...agent,
        instructions: "Changed by the partner.",
      })),
    });
    expect(f.servers).toHaveLength(1);
    expect(f.servers[0]?.secretId).not.toBe(firstSecret);
    expect(f.secrets.has(firstSecret)).toBe(false);
    expect(f.secrets.size).toBe(1);
    expect([...f.bots.values()]).toEqual(before);
  });

  it("refuses an endpoint the network policy refuses, before writing anything", async () => {
    const f = fixture({ unsafeEndpoint: true });
    await expect(installPartnerTenantContent(f.deps, actor, partnerId, content)).rejects.toThrow(
      /not allowed/,
    );
    expect(f.servers).toHaveLength(0);
    expect(f.putCalls).toHaveLength(0);
    expect(f.deps.createBot).not.toHaveBeenCalled();
  });

  it("never puts the token in an error, a result or a stored row", async () => {
    const f = fixture({ unsafeEndpoint: true });
    const error = await installPartnerTenantContent(f.deps, actor, partnerId, content).catch(
      (e: unknown) => e,
    );
    expect(String((error as Error).message)).not.toContain("tenant-token-1");
    const ok = fixture();
    const result = await installPartnerTenantContent(ok.deps, actor, partnerId, content);
    expect(JSON.stringify(result)).not.toContain("tenant-token-1");
    expect(JSON.stringify(ok.servers)).not.toContain("tenant-token-1");
    expect(JSON.stringify([...ok.secrets.values()])).not.toContain("tenant-token-1");
    // Only the sealed secret store ever sees the token.
    expect(ok.putCalls.join("")).toContain("tenant-token-1");
  });

  it("installs agents alone when the partner sends no connector", async () => {
    const f = fixture();
    const result = await installPartnerTenantContent(f.deps, actor, partnerId, {
      agents: [{ key: "solo", name: "Solo", instructions: "Help.", usesConnector: false }],
    });
    expect(Object.keys(result.botIds)).toEqual(["solo"]);
    expect(f.servers).toHaveLength(0);
    expect(f.assignments).toHaveLength(0);
  });

  it("gives each customer the event routines once and leaves a switched-off one off", async () => {
    const f = fixture();
    const withRoutines: PartnerContent = {
      agents: content.agents,
      routines: [
        {
          key: "no-show",
          agent: "writer",
          name: "Reschedule no-shows",
          prompt: "Draft a message offering a new time, for approval.",
          on: { type: "appointment.no_show" },
          active: true,
        },
        {
          key: "ghost",
          agent: "nobody",
          name: "Never made",
          prompt: "x",
          on: { type: "payment.overdue" },
          active: true,
        },
      ],
    };
    const first = await installPartnerTenantContent(f.deps, actor, partnerId, withRoutines);
    const [row] = [...f.routines.values()];
    expect(f.routines.size).toBe(1);
    expect(row).toMatchObject({
      botId: first.botIds.writer,
      userId: actor.userId,
      spaceId: actor.spaceId,
      crons: [],
      active: true,
      templateKey: "no-show",
      eventTrigger: { type: "appointment.no_show" },
    });
    // The customer switched it off; installing the template again must not switch it back on.
    if (row) row.active = false;
    await installPartnerTenantContent(f.deps, actor, partnerId, withRoutines);
    expect(f.routines.size).toBe(1);
    expect([...f.routines.values()][0]?.active).toBe(false);
  });

  it("gives each customer the scheduled routines once, in its timezone, owned by the right agent", async () => {
    const f = fixture();
    const scheduled: PartnerContent = {
      agents: content.agents,
      timezone: "America/Sao_Paulo",
      scheduledRoutines: [
        {
          key: "tomorrow",
          agent: "writer",
          name: "Confirm tomorrow",
          prompt: "List tomorrow's appointments.",
          crons: ["0 18 * * *"],
          active: true,
        },
        {
          key: "weekly",
          agent: "manager",
          name: "Returns",
          prompt: "List patients due.",
          crons: ["0 9 * * 1"],
          timezone: "UTC",
          active: false,
        },
        {
          key: "ghost",
          agent: "nobody",
          name: "x",
          prompt: "x",
          crons: ["0 9 * * *"],
          active: true,
        },
        {
          key: "bad",
          agent: "writer",
          name: "x",
          prompt: "x",
          crons: ["0 99 * * *"],
          active: true,
        },
      ],
    };
    const first = await installPartnerTenantContent(f.deps, actor, partnerId, scheduled);
    expect(f.routines.size).toBe(2);
    const rows = [...f.routines.values()];
    expect(rows[0]).toMatchObject({
      botId: first.botIds.writer,
      crons: ["0 18 * * *"],
      timezone: "America/Sao_Paulo",
      active: true,
      templateKey: "tomorrow",
    });
    expect(rows[0]?.nextRunAt).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ timezone: "UTC", active: false, nextRunAt: null });
    if (rows[0]) rows[0].active = false;
    await installPartnerTenantContent(f.deps, actor, partnerId, scheduled);
    expect(f.routines.size).toBe(2);
    expect([...f.routines.values()][0]?.active).toBe(false);
  });

  it("runs scheduled routines in UTC when no timezone is known", async () => {
    const f = fixture();
    await installPartnerTenantContent(f.deps, actor, partnerId, {
      agents: content.agents,
      scheduledRoutines: [
        { key: "a", agent: "writer", name: "A", prompt: "x", crons: ["0 8 * * *"], active: true },
      ],
    });
    expect([...f.routines.values()][0]?.timezone).toBe("UTC");
  });
});
