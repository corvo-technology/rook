import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { FleetRun } from "./fleet-tools.js";
import { spaceStatus } from "./space-status.js";

const run: FleetRun = {
  spaceId: "space-1",
  userId: "user-1",
  botId: "chief",
  groupId: null,
  threadId: "t1",
  runId: "run-1",
};

const SECRET = "sk-test-123";

type Rows = {
  bots?: unknown[];
  botRuns?: unknown[];
  routineRuns?: unknown[];
  effects?: unknown[];
  connections?: unknown[];
  servers?: unknown[];
  routines?: unknown[];
  quotas?: unknown[];
};

function db(rows: Rows) {
  const calls: Array<{ model: string; where: Record<string, unknown> }> = [];
  const find = (model: string, pick: (args: { where: Record<string, unknown> }) => unknown[]) =>
    vi.fn(async (args: { where: Record<string, unknown> }) => {
      calls.push({ model, where: args.where });
      return pick(args);
    });
  const prisma = {
    bot: { findMany: find("bot", () => rows.bots ?? []) },
    run: {
      findMany: find("run", ({ where }) =>
        "routineId" in where ? (rows.routineRuns ?? []) : (rows.botRuns ?? []),
      ),
    },
    externalEffect: { findMany: find("externalEffect", () => rows.effects ?? []) },
    connection: { findMany: find("connection", () => rows.connections ?? []) },
    mcpServer: { findMany: find("mcpServer", () => rows.servers ?? []) },
    routine: { findMany: find("routine", () => rows.routines ?? []) },
    providerQuota: { findMany: find("providerQuota", () => rows.quotas ?? []) },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

const bot = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  name: "Analyst",
  modelProvider: null,
  modelId: null,
  ...over,
});

describe("spaceStatus", () => {
  it("names a bot without its own model as using the space default", async () => {
    const { prisma } = db({
      bots: [bot(), bot({ id: "b2", name: "Writer", modelProvider: "anthropic", modelId: "m1" })],
    });
    const status = await spaceStatus({ prisma }, run, []);
    expect(status.bots.map((b) => b.model)).toEqual(["space default", "anthropic/m1"]);
  });

  it("redacts secrets in a failed run's error and cuts it to 200 characters", async () => {
    const error = `Provider said ${SECRET} is bad. ${"x".repeat(500)}`;
    const { prisma } = db({
      bots: [bot()],
      botRuns: [
        { botId: "b1", status: "failed", createdAt: new Date("2026-10-29T12:00:00Z"), error },
      ],
    });
    const status = await spaceStatus({ prisma }, run, [SECRET]);
    const last = status.bots[0]?.last_run;
    expect(last?.status).toBe("failed");
    expect(last?.error?.length).toBeLessThanOrEqual(201);
    expect(last?.error).toContain("[redacted]");
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });

  it("counts a bot's pending approvals", async () => {
    const { prisma } = db({
      bots: [bot()],
      effects: [{ run: { botId: "b1" } }, { run: { botId: "b1" } }],
    });
    const status = await spaceStatus({ prisma }, run, []);
    expect(status.bots[0]?.pending_approvals).toBe(2);
  });

  it("lists connections and servers in error, not healthy ones", async () => {
    const { prisma, calls } = db({
      connections: [{ displayName: "Mail", provider: "gmail", status: "error" }],
      servers: [
        {
          name: "Files",
          healthMessage: `token ${SECRET} rejected`,
          healthCheckedAt: new Date("2026-10-29T12:00:00Z"),
        },
      ],
    });
    const status = await spaceStatus({ prisma }, run, [SECRET]);
    expect(status.connections_down).toEqual([{ name: "Mail", provider: "gmail", status: "error" }]);
    expect(status.servers_failing).toHaveLength(1);
    expect(status.servers_failing[0]?.message).toContain("[redacted]");
    // The database does the filtering; the queries ask only for the unhealthy ones.
    expect(calls.find((c) => c.model === "connection")?.where).toMatchObject({ status: "error" });
    expect(calls.find((c) => c.model === "mcpServer")?.where).toMatchObject({
      enabled: true,
      healthStatus: "error",
    });
  });

  it("lists an active routine whose newest run failed, and not one whose newest run succeeded", async () => {
    const { prisma } = db({
      routines: [
        { id: "r1", name: "Morning summary", bot: { name: "Analyst" } },
        { id: "r2", name: "Report", bot: { name: "Writer" } },
      ],
      routineRuns: [
        {
          routineId: "r1",
          status: "failed",
          createdAt: new Date("2026-10-29T12:00:00Z"),
          error: "boom",
        },
        {
          routineId: "r2",
          status: "completed",
          createdAt: new Date("2026-10-29T12:00:00Z"),
          error: null,
        },
      ],
    });
    const status = await spaceStatus({ prisma }, run, []);
    expect(status.routines_failing).toEqual([
      {
        routine_id: "r1",
        name: "Morning summary",
        agent: "Analyst",
        last_run: "2026-10-29T12:00:00.000Z",
        error: "boom",
      },
    ]);
  });

  it("lists quota windows at 80 percent or more", async () => {
    const { prisma } = db({
      quotas: [
        {
          provider: "claude",
          windows: [
            { key: "5h", usedPercent: 79, resetsAt: "2026-10-30T00:00:00Z" },
            { key: "7d", usedPercent: 80, resetsAt: "2026-11-02T00:00:00Z" },
          ],
        },
      ],
    });
    const status = await spaceStatus({ prisma }, run, []);
    expect(status.limits).toEqual([
      { provider: "claude", window: "7d", used_percent: 80, resets_at: "2026-11-02T00:00:00Z" },
    ]);
  });

  it("never returns message text or prompts, and scopes every query to the space", async () => {
    const { prisma, calls } = db({
      bots: [bot()],
      botRuns: [
        {
          botId: "b1",
          status: "completed",
          createdAt: new Date("2026-10-29T12:00:00Z"),
          error: null,
          // Rows a careless select could return; the result must not carry them.
          messages: [{ text: "PRIVATE-MESSAGE" }],
          task: { prompt: "PRIVATE-TASK" },
        },
      ],
      routines: [{ id: "r1", name: "Daily", prompt: "PRIVATE-ROUTINE", bot: { name: "Analyst" } }],
      routineRuns: [
        {
          routineId: "r1",
          status: "failed",
          createdAt: new Date("2026-10-29T12:00:00Z"),
          error: "x",
        },
      ],
    });
    const status = await spaceStatus({ prisma }, run, []);
    const json = JSON.stringify(status);
    for (const text of ["PRIVATE-MESSAGE", "PRIVATE-TASK", "PRIVATE-ROUTINE"]) {
      expect(json).not.toContain(text);
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(
        call.where.spaceId ?? (call.where.bot as { spaceId?: string } | undefined)?.spaceId,
      ).toBe("space-1");
    }
  });

  it("marks the bot list truncated past 40 bots", async () => {
    const bots = Array.from({ length: 41 }, (_, i) => bot({ id: `b${i}`, name: `Bot ${i}` }));
    const { prisma } = db({ bots });
    const status = await spaceStatus({ prisma }, run, []);
    expect(status.bots).toHaveLength(40);
    expect(status.truncated).toBe(true);
  });
});
