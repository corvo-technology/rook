import type { NotificationMessage } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";

vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  countUnreadInboxChats: vi.fn(async () => 3),
  runAsSystem: vi.fn(async (_why: string, fn: () => unknown) => fn()),
}));

import { decidePush, deliverDigest } from "./notification-policy.js";

const SP = "America/Sao_Paulo";
const run = { spaceId: "s", userId: "u", botId: "b", threadId: "t", trigger: "routine" };
const completion: NotificationMessage = {
  kind: "completion",
  title: "Ana finished",
  body: "done",
  botId: "b",
  threadId: "t",
};

type Held = {
  id: string;
  userId: string;
  botId: string;
  spaceId: string;
  message: unknown;
  releaseAt: Date;
};

function fakePrisma(
  options: {
    muted?: boolean;
    user?: Partial<{
      timezone: string | null;
      quietHoursEnabled: boolean;
      quietHoursStart: number;
      quietHoursEnd: number;
      locale: string | null;
    }>;
    held?: Held[];
  } = {},
) {
  const held: Held[] = options.held ?? [];
  const counts = new Map<string, number>();
  let mutedNow = options.muted ?? false;
  const prisma = {
    notificationMute: { count: vi.fn(async () => (mutedNow ? 1 : 0)) },
    user: {
      findUnique: vi.fn(async () => ({
        timezone: SP,
        quietHoursEnabled: true,
        quietHoursStart: 1320,
        quietHoursEnd: 480,
        locale: "en",
        ...options.user,
      })),
    },
    proactivePushCount: {
      upsert: vi.fn(
        async ({ where }: { where: { userId_botId_day: { botId: string; day: string } } }) => {
          const key = `${where.userId_botId_day.botId}:${where.userId_botId_day.day}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          return { count: counts.get(key) };
        },
      ),
    },
    heldNotification: {
      create: vi.fn(async ({ data }: { data: Omit<Held, "id"> }) => {
        held.push({ id: `h${held.length}`, ...data });
      }),
      aggregate: vi.fn(async () => ({
        _min: { releaseAt: held.map((row) => row.releaseAt).sort((a, b) => +a - +b)[0] ?? null },
      })),
      findMany: vi.fn(async () => [...held]),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in)
          held.splice(
            held.findIndex((row) => row.id === id),
            1,
          );
      }),
    },
    bot: {
      findMany: vi.fn(async () => [
        { id: "b", name: "Ana" },
        { id: "c", name: "Caio" },
      ]),
    },
  };
  return {
    prisma: prisma as never,
    held,
    mute: () => {
      mutedNow = true;
    },
  };
}

const jobs = () => ({ enqueue: vi.fn(async () => undefined) });
const night = new Date("2026-11-21T01:30:00Z"); // 22:30 in Sao Paulo
const afternoon = new Date("2026-11-20T18:00:00Z"); // 15:00 in Sao Paulo

describe("decidePush", () => {
  it("sends what a person started, even at night", async () => {
    const { prisma, held } = fakePrisma();
    expect(await decidePush({ prisma }, { ...run, trigger: "user" }, completion, null, night)).toBe(
      "send",
    );
    expect(held).toHaveLength(0);
  });

  it("holds a background push during quiet hours until the window opens", async () => {
    const { prisma, held } = fakePrisma();
    const queue = jobs();
    expect(await decidePush({ prisma, jobs: queue as never }, run, completion, null, night)).toBe(
      "held",
    );
    expect(held[0]).toMatchObject({ reason: "quiet", releaseAt: new Date("2026-11-21T11:00:00Z") });
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "notification.digest",
        replaceKey: "notification.digest:u",
        availableAt: new Date("2026-11-21T11:00:00Z"),
      }),
    );
  });

  it("uses the person's timezone, not the server's", async () => {
    // 01:30 UTC is mid-afternoon in Auckland the same day only if quiet were read in UTC.
    const { prisma } = fakePrisma({ user: { timezone: "Asia/Tokyo" } }); // 10:30 in Tokyo
    expect(await decidePush({ prisma }, run, completion, null, night)).toBe("send");
  });

  it("sends in the daytime, and again when quiet hours are off at night", async () => {
    expect(
      await decidePush({ prisma: fakePrisma().prisma }, run, completion, null, afternoon),
    ).toBe("send");
    const off = fakePrisma({ user: { quietHoursEnabled: false } });
    expect(await decidePush({ prisma: off.prisma }, run, completion, null, night)).toBe("send");
  });

  it("lets an urgent push through the night and the cap, but not a mute", async () => {
    const { prisma, held } = fakePrisma();
    expect(await decidePush({ prisma }, run, completion, "urgent", night)).toBe("send");
    expect(held).toHaveLength(0);
    const silenced = fakePrisma({ muted: true });
    expect(await decidePush({ prisma: silenced.prisma }, run, completion, "urgent", night)).toBe(
      "muted",
    );
  });

  it("sends a question during quiet hours: someone is waiting on it", async () => {
    const { prisma } = fakePrisma();
    const help = { ...completion, kind: "help" as const };
    expect(await decidePush({ prisma }, run, help, null, night)).toBe("send");
  });

  it("holds the pushes past the daily cap and keeps the first ones", async () => {
    const { prisma, held } = fakePrisma();
    const verdicts = [];
    for (let i = 0; i < 8; i += 1) {
      verdicts.push(await decidePush({ prisma }, run, completion, null, afternoon));
    }
    expect(verdicts.filter((verdict) => verdict === "send")).toHaveLength(6);
    expect(verdicts.slice(6)).toEqual(["held", "held"]);
    expect(held.map((row) => (row as unknown as { reason: string }).reason)).toEqual([
      "cap",
      "cap",
    ]);
  });

  it("counts a new local day from zero", async () => {
    const { prisma } = fakePrisma();
    for (let i = 0; i < 7; i += 1) await decidePush({ prisma }, run, completion, null, afternoon);
    const nextDay = new Date("2026-11-21T18:00:00Z");
    expect(await decidePush({ prisma }, run, completion, null, nextDay)).toBe("send");
  });

  it("sends a low push straight to the digest", async () => {
    const { prisma, held } = fakePrisma();
    expect(await decidePush({ prisma }, run, completion, "low", afternoon)).toBe("held");
    expect(held[0]).toMatchObject({ reason: "low", releaseAt: new Date("2026-11-21T11:00:00Z") });
  });

  it("silences everything for a muted agent, human started or not", async () => {
    const { prisma, held } = fakePrisma({ muted: true });
    expect(
      await decidePush({ prisma }, { ...run, trigger: "user" }, completion, null, afternoon),
    ).toBe("muted");
    expect(held).toHaveLength(0);
  });
});

describe("deliverDigest", () => {
  const row = (id: string, botId: string, releaseAt: Date, title = "x"): Held => ({
    id,
    userId: "u",
    botId,
    spaceId: "s",
    message: { ...completion, botId, title },
    releaseAt,
  });
  const due = new Date("2026-11-21T11:00:00Z");
  const morning = new Date("2026-11-21T11:00:30Z");

  it("sends one summary for everything held and clears it", async () => {
    const { prisma, held } = fakePrisma({
      held: [row("1", "b", due), row("2", "c", due), row("3", "b", due)],
    });
    const send = vi.fn(async () => undefined);
    await deliverDigest({ prisma, jobs: jobs() as never, notifications: { send } }, "u", morning);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ title: "3 updates", body: "Ana and Caio", badge: 3 }),
      expect.objectContaining({ userId: "u", spaceId: "s" }),
    );
    expect(held).toHaveLength(0);
  });

  it("sends a lone item as the push it would have been", async () => {
    const { prisma } = fakePrisma({ held: [row("1", "b", due, "Ana finished")] });
    const send = vi.fn(async () => undefined);
    await deliverDigest({ prisma, jobs: jobs() as never, notifications: { send } }, "u", morning);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ana finished", body: "done" }),
      expect.anything(),
    );
  });

  it("drops what was muted while it waited, and sends nothing when nothing is left", async () => {
    const fake = fakePrisma({ held: [row("1", "b", due)] });
    fake.mute();
    const send = vi.fn(async () => undefined);
    await deliverDigest(
      { prisma: fake.prisma, jobs: jobs() as never, notifications: { send } },
      "u",
      morning,
    );
    expect(send).not.toHaveBeenCalled();
    expect(fake.held).toHaveLength(0);
  });

  it("leaves items for a later morning and schedules for them", async () => {
    const later = new Date("2026-11-22T11:00:00Z");
    const { prisma, held } = fakePrisma({ held: [row("1", "b", due), row("2", "c", later)] });
    const queue = jobs();
    const send = vi.fn(async () => undefined);
    await deliverDigest({ prisma, jobs: queue as never, notifications: { send } }, "u", morning);
    expect(held.map((item) => item.id)).toEqual(["2"]);
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ availableAt: later }));
  });

  it("keeps the rows when the send fails, so the job can retry", async () => {
    const { prisma, held } = fakePrisma({ held: [row("1", "b", due)] });
    const send = vi.fn(async () => {
      throw new Error("expo down");
    });
    await expect(
      deliverDigest({ prisma, jobs: jobs() as never, notifications: { send } }, "u", morning),
    ).rejects.toThrow("expo down");
    expect(held).toHaveLength(1);
  });
});
