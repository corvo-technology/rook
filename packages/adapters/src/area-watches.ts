import type { ConnectorTool } from "@corvo/adapter-kit";
import type { AreaWatch } from "@corvo/contracts";
import { agentCatalogLocale, RoutineWatchSchema, TimeZoneSchema } from "@corvo/contracts";
import { AREA_WATCHES, areaWatchTemplateKey } from "@corvo/core";
import type { Prisma, PrismaClient } from "@corvo/db";
import { presetToolName } from "./routine-watch-presets.js";

const FIRST_CHECK_DELAY_MS = 60_000;

export type AreaWatchPreset = AreaWatch["preset"];

export type AreaWatchTool = { name: string; args: Record<string, unknown> };

/** The window a calendar tool asks for, from its own schema, so the next week stays current. */
function calendarWindow(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {});
  const from = properties.find((key) =>
    /^(time_?min|start(_?time|_?date)?|from|after)$/i.test(key),
  );
  const to = properties.find((key) =>
    /^(time_?max|end(_?time|_?date)?|to|until|before)$/i.test(key),
  );
  return { ...(from ? { [from]: "{{now}}" } : {}), ...(to ? { [to]: "{{in7d}}" } : {}) };
}

/** The read tool a newly connected integration offers for each preset, by what the tool does. */
export function presetToolsOf(
  tools: readonly ConnectorTool[],
): Map<AreaWatchPreset, AreaWatchTool> {
  const found = new Map<AreaWatchPreset, AreaWatchTool>();
  for (const preset of ["calendar", "email"] as const) {
    const tool = tools.find((tool) => tool.readOnly === true && presetToolName(preset, tool.name));
    if (tool) {
      found.set(preset, {
        name: tool.name,
        args: preset === "calendar" ? calendarWindow(tool.inputSchema) : {},
      });
    }
  }
  return found;
}

/**
 * Turn on the change triggers of the owner's agents that a connected integration can now serve.
 * Made by the system like the Chief's watch, so nothing waits for an approval. Safe to repeat and
 * kind to the person's choices: an agent that already has the routine (paused or not) or any
 * watch of the same kind of its own is left alone. Wakes and pushes follow the person's quiet
 * hours and mutes, like every background run. Never throws for one agent's failure.
 */
export async function enableAreaWatches(
  deps: { prisma: Pick<PrismaClient, "bot" | "routine" | "user"> },
  owner: { spaceId: string; userId: string },
  tools: ReadonlyMap<AreaWatchPreset, AreaWatchTool>,
  now: Date = new Date(),
): Promise<number> {
  if (tools.size === 0) return 0;
  const bots = await deps.prisma.bot.findMany({
    where: {
      spaceId: owner.spaceId,
      userId: owner.userId,
      archivedAt: null,
      spawnKey: { in: Object.keys(AREA_WATCHES) },
    },
    select: { id: true, spawnKey: true },
  });
  if (bots.length === 0) return 0;
  const user = await deps.prisma.user.findUnique({
    where: { id: owner.userId },
    select: { timezone: true, locale: true, email: true },
  });
  const locale = agentCatalogLocale(user?.locale ?? "en");
  const timezone = TimeZoneSchema.safeParse(user?.timezone).success && user?.timezone;
  let enabled = 0;
  for (const bot of bots) {
    for (const area of AREA_WATCHES[bot.spawnKey ?? ""] ?? []) {
      const tool = tools.get(area.preset);
      if (!tool) continue;
      const templateKey = areaWatchTemplateKey(area);
      const taken = await deps.prisma.routine.findFirst({
        where: {
          botId: bot.id,
          OR: [{ templateKey }, { watch: { path: ["preset"], equals: area.preset } }],
        },
        select: { id: true },
      });
      if (taken) continue;
      const watch = RoutineWatchSchema.parse({
        kind: "tool",
        tool: tool.name,
        args: tool.args,
        preset: area.preset,
        ...(area.preset === "email" && user?.email ? { userEmails: [user.email] } : {}),
      });
      try {
        await deps.prisma.routine.create({
          data: {
            spaceId: owner.spaceId,
            botId: bot.id,
            userId: owner.userId,
            name: area.name[locale],
            prompt: area.prompt[locale],
            crons: [],
            timezone: timezone || "UTC",
            notify: true,
            active: true,
            watch: watch as Prisma.InputJsonValue,
            templateKey,
            // The job reconciler wakes any active routine that is due.
            nextRunAt: new Date(now.getTime() + FIRST_CHECK_DELAY_MS),
          },
        });
        enabled++;
      } catch (error) {
        // Another connection event made it first: the unique (bot, template key) pair.
        if ((error as { code?: string }).code !== "P2002") throw error;
      }
    }
  }
  return enabled;
}
