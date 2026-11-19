import type { Actor, CreateBotInput, VerticalId, VerticalSelection } from "@corvo/contracts";
import {
  CreateRoutineInput,
  verticalRoutinePrompt,
  verticalTemplate,
  verticalText,
} from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { routineNextRunAt, routineRowData } from "./routines.js";

export interface VerticalDeps {
  prisma: PrismaClient;
  /** Idempotent by spawn key: the same key in a space returns the same bot, untouched. */
  createBot(actor: Actor, input: CreateBotInput): Promise<{ id: string }>;
  /** Wakes an active routine when it is due. */
  scheduleRoutine(routineId: string, at: Date): Promise<void>;
}

export const verticalSpawnKey = (verticalId: VerticalId, agentKey: string) =>
  `vertical:${verticalId}:${agentKey}`;

export interface AppliedVertical {
  /** Agent key to the bot made (or already there) for it. */
  botIds: Record<string, string>;
  /** Routine key to its id, for the routines made now or before. */
  routineIds: Record<string, string>;
  /** What to offer next, in the person's language; nothing is connected here. */
  channels: Array<{ kind: "whatsapp" | "email"; purpose: string }>;
  connections: Array<{ app: string; reason: string }>;
}

/**
 * Makes the agents and scheduled routines a person picked from a starter team for their kind of
 * business. Safe to repeat: an agent and a routine are made once and never changed afterwards, so
 * what the person edited stays. Routines started by a partner's events belong to partner
 * templates and are not made here. No agent runs.
 */
export async function applyVertical(
  deps: VerticalDeps,
  actor: Actor,
  verticalId: VerticalId,
  selection: VerticalSelection = {},
): Promise<AppliedVertical> {
  const template = verticalTemplate(verticalId);
  const locale = selection.locale ?? "en";
  const known = new Set(template.agents.map((agent) => agent.key));
  const knownRoutines = new Set(template.routines.map((routine) => routine.key));
  for (const key of selection.agents ?? []) {
    if (!known.has(key)) throw new Error(`Unknown agent: ${key}`);
  }
  for (const key of selection.routines ?? []) {
    if (!knownRoutines.has(key)) throw new Error(`Unknown routine: ${key}`);
  }
  const wantedAgents = new Set(selection.agents ?? [...known]);

  const botIds: Record<string, string> = {};
  for (const agent of template.agents) {
    if (!wantedAgents.has(agent.key)) continue;
    const bot = await deps.createBot(actor, {
      name: verticalText(agent.name, locale),
      title: verticalText(agent.role, locale),
      description: "",
      instructions: verticalText(agent.instructions, locale),
      notifyOnFinish: true,
      computerMode: "team",
      starters: agent.starters.map((starter) => verticalText(starter, locale)),
      avatarFamily: agent.avatarFamily,
      spawnKey: verticalSpawnKey(verticalId, agent.key),
      intro: false,
    });
    botIds[agent.key] = bot.id;
  }

  const wantedRoutines = selection.routines ? new Set(selection.routines) : null;
  const routineIds: Record<string, string> = {};
  for (const routine of template.routines) {
    if (routine.trigger.kind !== "schedule") continue;
    if (wantedRoutines && !wantedRoutines.has(routine.key)) continue;
    const botId = botIds[routine.agent];
    if (!botId) continue;
    const existing = await deps.prisma.routine.findUnique({
      where: { botId_templateKey: { botId, templateKey: routine.key } },
      select: { id: true },
    });
    if (existing) {
      routineIds[routine.key] = existing.id;
      continue;
    }
    const input = CreateRoutineInput.parse({
      botId,
      name: verticalText(routine.name, locale),
      prompt: verticalRoutinePrompt(routine, locale),
      crons: routine.trigger.crons,
      timezone: selection.timezone ?? "UTC",
      active: routine.defaultActive,
    });
    const nextRunAt = routineNextRunAt(input);
    const row = await deps.prisma.routine.create({
      data: { ...routineRowData(actor, input, nextRunAt), templateKey: routine.key },
    });
    routineIds[routine.key] = row.id;
    if (row.active && row.nextRunAt) await deps.scheduleRoutine(row.id, row.nextRunAt);
  }

  return {
    botIds,
    routineIds,
    channels: template.channels.map((channel) => ({
      kind: channel.kind,
      purpose: verticalText(channel.purpose, locale),
    })),
    connections: template.connections.map((connection) => ({
      app: connection.app,
      reason: verticalText(connection.reason, locale),
    })),
  };
}
