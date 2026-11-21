import type { ConnectorTool } from "@corvo/adapter-kit";
import { RoutineWatchSchema, verticalSpawnKey } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { enableAreaWatches, presetToolsOf } from "./area-watches.js";

const NOW = new Date("2026-11-20T10:00:00Z");
const tool = (name: string, readOnly = true, properties: object = {}): ConnectorTool => ({
  name,
  description: "",
  inputSchema: { properties },
  readOnly,
});

/** In-memory bots and routines with the unique (bot, template key) rule. */
function fakeDb(spawnKeys: string[]) {
  const routines: Array<Record<string, unknown>> = [];
  const prisma = {
    bot: {
      findMany: async () => spawnKeys.map((spawnKey, i) => ({ id: `b${i}`, spawnKey })),
    },
    user: {
      findUnique: async () => ({
        timezone: "America/Sao_Paulo",
        locale: "pt-BR",
        email: "Owner@Example.com",
      }),
    },
    routine: {
      findFirst: async ({ where }: { where: { botId: string; OR: Array<Record<string, any>> } }) =>
        routines.find(
          (r) =>
            r.botId === where.botId &&
            (r.templateKey === where.OR[0]?.templateKey ||
              (r.watch as { preset?: string }).preset === where.OR[1]?.watch.equals),
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        routines.push(data);
      },
    },
  };
  return { prisma: prisma as never, routines };
}

const owner = { spaceId: "s", userId: "u" };

describe("presetToolsOf", () => {
  it("finds read tools by what they do and derives the calendar window from the schema", () => {
    const found = presetToolsOf([
      tool("GOOGLECALENDAR_EVENTS_LIST", true, { timeMin: {}, timeMax: {}, q: {} }),
      tool("GMAIL_FETCH_EMAILS"),
      tool("GMAIL_SEND_EMAIL", false),
    ]);
    expect(found.get("calendar")).toEqual({
      name: "GOOGLECALENDAR_EVENTS_LIST",
      args: { timeMin: "{{now}}", timeMax: "{{in7d}}" },
    });
    expect(found.get("email")).toEqual({ name: "GMAIL_FETCH_EMAILS", args: {} });
  });

  it("offers nothing for a connection without those tools", () => {
    expect(presetToolsOf([tool("NOTION_SEARCH")]).size).toBe(0);
  });
});

describe("enableAreaWatches", () => {
  const calendar = new Map([["calendar" as const, { name: "calendar_events_list", args: {} }]]);

  it("turns on the calendar watch of the clinic's reception, in the person's language", async () => {
    const { prisma, routines } = fakeDb([verticalSpawnKey("clinica", "reception")]);
    expect(await enableAreaWatches({ prisma }, owner, calendar, NOW)).toBe(1);
    expect(routines[0]).toMatchObject({
      botId: "b0",
      name: "Mudanças na agenda",
      templateKey: "area-watch:calendar-changes",
      active: true,
      notify: true,
      timezone: "America/Sao_Paulo",
    });
    expect(RoutineWatchSchema.parse(routines[0]!.watch)).toMatchObject({
      kind: "tool",
      preset: "calendar",
      tool: "calendar_events_list",
    });
  });

  it("is idempotent and leaves a paused or hand-made watch alone", async () => {
    const { prisma, routines } = fakeDb([verticalSpawnKey("clinica", "reception")]);
    await enableAreaWatches({ prisma }, owner, calendar, NOW);
    routines[0]!.active = false;
    expect(await enableAreaWatches({ prisma }, owner, calendar, NOW)).toBe(0);
    expect(routines).toHaveLength(1);
    expect(routines[0]!.active).toBe(false);

    const mine = fakeDb(["agent-catalog:meeting-assistant"]);
    mine.routines.push({
      botId: "b0",
      templateKey: null,
      watch: { kind: "tool", preset: "calendar" },
    });
    expect(await enableAreaWatches({ prisma: mine.prisma }, owner, calendar, NOW)).toBe(0);
  });

  it("only enables presets the connection can serve and skips agents without a watch", async () => {
    const { prisma, routines } = fakeDb([
      "agent-catalog:support-agent",
      "agent-catalog:translator",
    ]);
    expect(await enableAreaWatches({ prisma }, owner, calendar, NOW)).toBe(0);
    const email = new Map([["email" as const, { name: "mail_list", args: {} }]]);
    expect(await enableAreaWatches({ prisma }, owner, email, NOW)).toBe(1);
    expect(RoutineWatchSchema.parse(routines[0]!.watch)).toMatchObject({
      preset: "email",
      userEmails: ["owner@example.com"],
    });
    expect(await enableAreaWatches({ prisma }, owner, new Map(), NOW)).toBe(0);
  });
});
