import type { Actor } from "@corvo/contracts";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import { PresenceTracker } from "./presence.js";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { HEARTBEAT_MS } from "./routes/shared.js";

const actorOf = (userId: string): Actor => ({
  spaceId: "space-1",
  userId,
  email: `${userId}@corvo.test`,
  isDeploymentOwner: false,
});

function setup(options: { member?: boolean } = {}) {
  const member = options.member ?? true;
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const presence = new PresenceTracker({
    onChange: () => undefined,
    persistSeen: async () => undefined,
  });
  const deps = {
    prisma: {
      spaceMember: {
        findUnique: vi.fn(async () => (member ? { role: "member", roles: [] } : null)),
        findFirst: vi.fn(async () => (member ? { role: "member", roles: [] } : null)),
        findMany: vi.fn(async () => [
          { userId: "ana", lastSeenAt: null },
          { userId: "bo", lastSeenAt: null },
        ]),
      },
      spaceRole: { findMany: vi.fn(async () => []) },
      notification: {
        updateMany,
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
      thread: { findMany: vi.fn(async () => []) },
      message: { findMany: vi.fn(async () => []) },
      user: { findMany: vi.fn(async () => []) },
      bot: { findMany: vi.fn(async () => []) },
    },
    presence,
    env: {},
  } as unknown as RouterDeps;
  const client = (userId: string) =>
    createRouterClient(createRouter(deps), {
      context: { actor: actorOf(userId), stillAuthorized: async () => true },
    });
  return { client, updateMany, presence };
}

describe("the inbox routes", () => {
  it("lists the caller's inbox", async () => {
    const { client } = setup();
    expect(await client("ana").inbox.list()).toEqual({ items: [], unreadCount: 0 });
  });

  it("refuses a person who is not a member of the space", async () => {
    const { client } = setup({ member: false });
    await expect(client("ana").inbox.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(client("ana").inbox.markAllRead()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("marks read only the caller's own entries", async () => {
    const { client, updateMany } = setup();
    await client("ana").inbox.markRead({ ids: ["n1"] });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          spaceId: "space-1",
          userId: "ana",
          readAt: null,
          id: { in: ["n1"] },
        }),
      }),
    );
    await client("ana").inbox.markRead({ threadId: "t1" });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "ana", threadId: "t1" }),
      }),
    );
  });

  it("asks for entries or a conversation, never neither", async () => {
    const { client } = setup();
    await expect(client("ana").inbox.markRead({})).rejects.toBeDefined();
  });
});

describe("the presence routes", () => {
  it("shows a member online while their stream is open, away once the client says it is in the background", async () => {
    const { client, presence } = setup();
    presence.connect("space-1", "ana");
    const listed = async () =>
      Object.fromEntries(
        (await client("bo").presence.list()).map((row) => [row.userId, row.status]),
      );
    expect(await listed()).toEqual({ ana: "online", bo: "offline" });
    await client("ana").presence.touch({ active: false });
    expect((await listed()).ana).toBe("away");
  });

  it("opens and closes presence with the member's space stream", async () => {
    vi.useFakeTimers();
    try {
      const { client, presence } = setup();
      const stream = await client("ana").spaces.subscribe();
      const beat = stream.next();
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      await beat;
      expect(presence.statusOf("space-1", "ana", null)).toBe("online");
      await stream.return?.(undefined);
      // Closing keeps the reload grace, then the member is gone.
      expect(presence.statusOf("space-1", "ana", null)).toBe("away");
      await vi.advanceTimersByTimeAsync(11_000);
      expect(presence.statusOf("space-1", "ana", null)).toBe("offline");
    } finally {
      vi.useRealTimers();
    }
  });
});
