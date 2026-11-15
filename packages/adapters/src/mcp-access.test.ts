import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { requestSpaceAppAccess } from "./mcp-access.js";
import type * as RunMessagesModule from "./run-messages.js";

const persist = vi.hoisted(() => vi.fn());
vi.mock("./run-messages.js", async (importOriginal) => ({
  ...(await importOriginal<typeof RunMessagesModule>()),
  persistMessageInTransaction: persist,
}));

const run = { id: "run-1", spaceId: "space-1", userId: "user-1", threadId: "t-1", botId: "bot-1" };

const teammates = [
  { id: "bot-1", name: "Chefe" },
  { id: "bot-2", name: "Infraestrutura e SRE" },
  { id: "bot-3", name: "Marketing" },
];

function setup(servers: unknown[], recent: unknown[] = [], createError?: unknown) {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    message: { findMany: vi.fn(async () => recent) },
  };
  const notify = vi.fn(async () => undefined);
  const deps = {
    prisma: {
      bot: { findMany: vi.fn(async (_args: unknown) => teammates) },
      mcpServer: {
        findMany: vi.fn(async (_args: unknown) => servers),
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          if (createError) throw createError;
          return { id: "srv-new", secretId: null, ...args.data };
        }),
      },
      $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    },
    events: { notify },
  } as unknown as ExecutorDeps;
  return { deps, notify, tx };
}

const posthog = {
  id: "srv-ph",
  name: "PostHog",
  slug: "posthog",
  transport: "streamable_http",
  endpoint: "https://mcp.posthog.com/mcp",
  secretId: "secret-1",
  assignments: [] as { id: string; allowAllTools?: boolean; level?: string }[],
};

beforeEach(() => {
  persist.mockReset().mockResolvedValue({ eventSeq: 7, firstResponseRunId: undefined });
});

describe("requestSpaceAppAccess", () => {
  it("shows the approval card for an app added to the workspace but not assigned to the agent", async () => {
    const { deps, notify } = setup([posthog]);
    const result = await requestSpaceAppAccess(deps, run, "posthog");
    expect(result).toMatchObject({ status: "pending" });
    expect(persist.mock.calls[0]?.[2]).toBe("bot");
    expect(persist.mock.calls[0]?.[3]).toEqual([
      expect.objectContaining({
        kind: "mcp_approval",
        serverId: "srv-ph",
        name: "PostHog",
        needsOAuth: false,
        status: "pending",
      }),
    ]);
    expect(notify).toHaveBeenCalledWith("t-1", 7, undefined);
  });

  it("asks for read access when read is enough, and the card says so", async () => {
    const { deps } = setup([posthog]);
    await requestSpaceAppAccess(deps, run, "posthog", "Infraestrutura e SRE", "read");
    expect(persist.mock.calls[0]?.[3]).toEqual([
      expect.objectContaining({ kind: "mcp_approval", forBotId: "bot-2", level: "read" }),
    ]);
  });

  it("does not ask again for read when the agent already has write", async () => {
    const { deps } = setup([
      { ...posthog, assignments: [{ id: "a", allowAllTools: true, level: "write" }] },
    ]);
    expect(await requestSpaceAppAccess(deps, run, "posthog", undefined, "read")).toMatchObject({
      status: "connected",
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks again for write when the agent only has read", async () => {
    const { deps } = setup([
      { ...posthog, assignments: [{ id: "a", allowAllTools: true, level: "read" }] },
    ]);
    expect(await requestSpaceAppAccess(deps, run, "posthog")).toMatchObject({ status: "pending" });
    expect(persist).toHaveBeenCalled();
  });

  it("looks only at the owner's enabled servers", async () => {
    const { deps } = setup([posthog]);
    await requestSpaceAppAccess(deps, run, "PostHog");
    const query = (deps.prisma.mcpServer.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(query).toMatchObject({
      where: { spaceId: "space-1", userId: "user-1", enabled: true },
    });
  });

  it("matches by name too, ignoring case", async () => {
    const { deps } = setup([{ ...posthog, slug: "ph-1" }]);
    expect(await requestSpaceAppAccess(deps, run, " POSTHOG ")).toMatchObject({
      status: "pending",
    });
  });

  it("leads with sign-in when an OAuth server has no credential yet", async () => {
    const trello = { ...posthog, id: "srv-t", name: "Trello", slug: "trello", secretId: null };
    const { deps } = setup([trello]);
    await requestSpaceAppAccess(deps, run, "trello");
    expect(persist.mock.calls[0]?.[3]?.[0]).toMatchObject({ needsOAuth: true });
    expect(persist.mock.calls[0]?.[3]?.[0]).not.toHaveProperty("needsKey");
  });

  it("asks for the key, not a sign-in, when a key server has no credential yet", async () => {
    const { deps } = setup([{ ...posthog, secretId: null }]);
    const result = await requestSpaceAppAccess(deps, run, "posthog");
    expect(persist.mock.calls[0]?.[3]?.[0]).toMatchObject({
      needsOAuth: false,
      needsKey: { label: "Personal API key", docsUrl: "https://posthog.com/docs/api" },
    });
    expect(result).toMatchObject({
      status: "pending",
      message: expect.stringContaining("never ask for the key in chat"),
    });
  });

  it("says it is already available when the agent has it", async () => {
    const { deps } = setup([{ ...posthog, assignments: [{ id: "a" }] }]);
    expect(await requestSpaceAppAccess(deps, run, "posthog")).toMatchObject({
      status: "connected",
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not show a second card while one is still pending", async () => {
    const { deps, notify } = setup(
      [posthog],
      [{ blocks: [{ kind: "mcp_approval", serverId: "srv-ph", status: "pending" }] }],
    );
    expect(await requestSpaceAppAccess(deps, run, "posthog")).toMatchObject({ status: "pending" });
    expect(persist).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("adds a catalog app that signs in with OAuth and shows its card, leading with the sign-in", async () => {
    const { deps } = setup([]);
    const result = await requestSpaceAppAccess(deps, run, "trello");
    expect(result).toMatchObject({ status: "pending" });
    const create = (deps.prisma.mcpServer.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(create.data).toMatchObject({
      spaceId: "space-1",
      userId: "user-1",
      slug: "trello",
      name: "Trello",
      endpoint: "https://mcp.trello.com/v1",
      enabled: true,
    });
    expect(persist.mock.calls[0]?.[3]?.[0]).toMatchObject({
      kind: "mcp_approval",
      serverId: "srv-new",
      name: "Trello",
      needsOAuth: true,
    });
  });

  it("adds a key app without a key and shows the card that asks the user for it", async () => {
    const { deps } = setup([]);
    const result = await requestSpaceAppAccess(deps, run, "posthog");
    expect(result).toMatchObject({ status: "pending" });
    const create = (deps.prisma.mcpServer.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(create.data).toMatchObject({ slug: "posthog", endpoint: "https://mcp.posthog.com/mcp" });
    expect(JSON.stringify(create.data)).not.toMatch(/secret|header|Bearer/i);
    expect(persist.mock.calls[0]?.[3]?.[0]).toMatchObject({
      kind: "mcp_approval",
      serverId: "srv-new",
      needsOAuth: false,
      needsKey: { label: "Personal API key" },
    });
  });

  it("sends the user to the desktop app when the sign-in needs it", async () => {
    const { deps } = setup([]);
    const result = await requestSpaceAppAccess(deps, run, "canva");
    expect(result).toEqual({ error: expect.stringContaining("needs the desktop app") });
    expect(deps.prisma.mcpServer.create).not.toHaveBeenCalled();
  });

  it("says a turned-off server with the same name exists instead of failing", async () => {
    const duplicate = Object.assign(new Error("duplicate"), { code: "P2002" });
    const { deps } = setup([], [], duplicate);
    expect(await requestSpaceAppAccess(deps, run, "trello")).toEqual({
      error: expect.stringContaining("turned off"),
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("leaves a name it does not know to the connector catalog", async () => {
    const { deps } = setup([posthog]);
    expect(await requestSpaceAppAccess(deps, run, "gmail")).toBeUndefined();
  });
});

describe("requestSpaceAppAccess for a teammate", () => {
  it("shows the card in the asking agent's chat, naming who the access is for", async () => {
    const { deps, notify } = setup([posthog]);
    const result = await requestSpaceAppAccess(deps, run, "posthog", "infraestrutura");
    expect(result).toMatchObject({ status: "pending" });
    expect(String((result as { message: string }).message)).toContain("Infraestrutura e SRE");
    // The card is the asking agent's own message, in its own chat.
    expect(persist.mock.calls[0]?.[1]).toMatchObject({ threadId: "t-1", botId: "bot-1" });
    expect(persist.mock.calls[0]?.[3]).toEqual([
      expect.objectContaining({
        kind: "mcp_approval",
        serverId: "srv-ph",
        forBotId: "bot-2",
        forBotName: "Infraestrutura e SRE",
        status: "pending",
      }),
    ]);
    expect(notify).toHaveBeenCalledWith("t-1", 7, undefined);
  });

  it("checks whether the teammate, not the asking agent, already has the app", async () => {
    const { deps } = setup([posthog]);
    await requestSpaceAppAccess(deps, run, "posthog", "Infraestrutura e SRE");
    const query = (deps.prisma.mcpServer.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(query.select.assignments).toEqual({
      where: { botId: "bot-2" },
      select: { id: true, allowAllTools: true, level: true },
    });
  });

  it("says the teammate already has it instead of asking again", async () => {
    const { deps } = setup([{ ...posthog, assignments: [{ id: "a-1" }] }]);
    const result = await requestSpaceAppAccess(deps, run, "posthog", "Marketing");
    expect(result).toMatchObject({ status: "connected" });
    expect(String((result as { message: string }).message)).toContain("Marketing");
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks for the teammate once, but separately from a card for another agent", async () => {
    const forInfra = {
      kind: "mcp_approval",
      serverId: "srv-ph",
      status: "pending",
      forBotId: "bot-2",
    };
    const again = setup([posthog], [{ blocks: [forInfra] }]);
    await requestSpaceAppAccess(again.deps, run, "posthog", "Infraestrutura e SRE");
    expect(persist).not.toHaveBeenCalled();

    const other = setup([posthog], [{ blocks: [forInfra] }]);
    await requestSpaceAppAccess(other.deps, run, "posthog", "Marketing");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("treats naming itself as asking for itself", async () => {
    const { deps } = setup([posthog]);
    await requestSpaceAppAccess(deps, run, "posthog", "Chefe");
    expect(persist.mock.calls[0]?.[3]?.[0]).not.toHaveProperty("forBotId");
  });

  it("names the agents it can ask for when the name matches none, or more than one", async () => {
    const { deps } = setup([posthog]);
    const none = await requestSpaceAppAccess(deps, run, "posthog", "Financeiro");
    expect(none).toEqual({ error: expect.stringContaining("Infraestrutura e SRE") });
    const many = await requestSpaceAppAccess(deps, run, "posthog", "i");
    expect(many).toEqual({ error: expect.stringContaining("More than one") });
    expect(persist).not.toHaveBeenCalled();
  });

  it("looks only at the owner's agents that are not archived", async () => {
    const { deps } = setup([posthog]);
    await requestSpaceAppAccess(deps, run, "posthog", "Marketing");
    const query = (deps.prisma.bot.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(query.where).toEqual({ spaceId: "space-1", userId: "user-1", archivedAt: null });
  });
});
