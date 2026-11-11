import type { Actor } from "@corvo/contracts";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@corvo.test",
  isDeploymentOwner: true,
};

describe("disabled ticket board", () => {
  it.each([undefined, false])(
    "refuses every route and stream before accessing the database (%s)",
    async (enabled) => {
      const query = vi.fn(() => {
        throw new Error("Unexpected database access");
      });
      const follow = vi.fn();
      const prisma = new Proxy({}, { get: () => query });
      const client = createRouterClient(
        createRouter({
          prisma,
          env: { ticketBoardEnabled: enabled },
          boardEvents: { follow },
        } as unknown as RouterDeps),
        { context: { actor } },
      );
      const calls = [
        () => client.boards.list(),
        () => client.boards.get(),
        () => client.boards.rename({ name: "Launch" }),
        () => client.boards.subscribe(),
        () => client.tickets.list({}),
        () => client.tickets.get({ id: "ticket-1" }),
        () => client.tickets.create({ title: "Launch", assigneeBotId: "bot-1" }),
        () => client.tickets.update({ id: "ticket-1", assigneeBotId: "bot-1" }),
        () => client.tickets.move({ id: "ticket-1", status: "doing" }),
        () => client.tickets.comment({ ticketId: "ticket-1", body: "Ready" }),
        () => client.tickets.comments({ ticketId: "ticket-1" }),
      ];
      for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(query).not.toHaveBeenCalled();
      expect(follow).not.toHaveBeenCalled();
    },
  );
});

it("rejects an out-of-range ticket reference before querying tickets", async () => {
  const findFirst = vi.fn(async () => null);
  const prisma = {
    board: { findUnique: vi.fn(async () => ({ id: "board-1", ticketPrefix: "RAK" })) },
    ticket: { findFirst },
  };
  const client = createRouterClient(
    createRouter({ prisma, env: { ticketBoardEnabled: true } } as unknown as RouterDeps),
    { context: { actor } },
  );

  await expect(client.tickets.get({ ref: `RAK-${"9".repeat(115)}` })).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "Invalid ticket reference.",
  });
  expect(findFirst).not.toHaveBeenCalled();
});

it.each([false, true])("includes the board capability in me (%s)", async (ticketBoardEnabled) => {
  const prisma = {
    partnerTenant: { findFirst: vi.fn(async () => null) },
    missionState: { findUnique: vi.fn(async () => null) },
    user: {
      findUniqueOrThrow: vi.fn(async () => ({
        email: "user@corvo.test",
        name: "Test",
        avatarStyle: "robot",
      })),
    },
    userModelPreference: { findFirst: vi.fn(async () => null) },
    spaceSettingOverride: { findUnique: vi.fn(async () => null) },
    userModelRoleChoice: { findMany: vi.fn(async () => []) },
    deploymentSettings: { findUnique: vi.fn(async () => null) },
  };
  const deps = {
    prisma,
    env: {
      ticketBoardEnabled,
      phoneCallsEnabled: ticketBoardEnabled,
      defaultProvider: "fake",
      defaultModel: "fake-model",
      sandboxProvider: "fake",
    },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), { context: { actor } });
  await expect(client.me()).resolves.toHaveProperty("ticketBoardEnabled", ticketBoardEnabled);
  await expect(client.me()).resolves.toHaveProperty("phoneCallsEnabled", ticketBoardEnabled);
});

describe("renaming column labels", () => {
  const board = { id: "board-1", ticketPrefix: "RAK", statusLabels: { done: "Won" } };
  function renameClient() {
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "board-1",
      spaceId: "space-1",
      name: "Board",
      ticketPrefix: "RAK",
      nextNumber: 1,
      statusLabels: data.statusLabels,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
    const prisma = {
      board: { findUnique: vi.fn(async () => board), update },
      ticket: { count: vi.fn(async () => 0) },
    };
    const client = createRouterClient(
      createRouter({ prisma, env: { ticketBoardEnabled: true } } as unknown as RouterDeps),
      { context: { actor } },
    );
    return { client, update };
  }

  it("keeps the other labels, sets one and returns the result", async () => {
    const { client, update } = renameClient();
    const result = await client.boards.rename({ statusLabels: { doing: "In contact" } });
    expect(update.mock.calls[0]?.[0].data.statusLabels).toEqual({
      done: "Won",
      doing: "In contact",
    });
    expect(result.statusLabels).toEqual({ done: "Won", doing: "In contact" });
  });

  it("removes a label with null", async () => {
    const { client, update } = renameClient();
    await client.boards.rename({ statusLabels: { done: null } });
    // No label left stores a database null, not the JSON value null.
    expect(String(update.mock.calls[0]?.[0].data.statusLabels)).toContain("DbNull");
  });
});

describe("listing tickets by several statuses", () => {
  it("asks the database for the union of the statuses and the owner", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      board: { findUnique: vi.fn(async () => ({ id: "board-1", ticketPrefix: "RAK" })) },
      ticket: { findMany },
    };
    const client = createRouterClient(
      createRouter({ prisma, env: { ticketBoardEnabled: true } } as unknown as RouterDeps),
      { context: { actor } },
    );
    await client.tickets.list({ statuses: ["doing", "review"], assigneeBotId: "bot-1" });
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      spaceId: "space-1",
      boardId: "board-1",
      status: { in: ["doing", "review"] },
      assigneeBotId: "bot-1",
    });
  });

  it("treats an empty list as no filter", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      board: { findUnique: vi.fn(async () => ({ id: "board-1", ticketPrefix: "RAK" })) },
      ticket: { findMany },
    };
    const client = createRouterClient(
      createRouter({ prisma, env: { ticketBoardEnabled: true } } as unknown as RouterDeps),
      { context: { actor } },
    );
    await client.tickets.list({ statuses: [] });
    expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty("status");
  });
});
