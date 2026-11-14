import type { AgentHomeStore } from "@corvo/adapter-kit";
import { resolveBotWorkspacePath } from "@corvo/adapters";
import type { Actor, ExportManifest, SpaceExport, SpaceImportResult } from "@corvo/contracts";
import { CreateRoutineInput, MEMORY_INDEX_PATH } from "@corvo/contracts";
import type { Prisma, PrismaClient } from "@corvo/db";
import { IsolationError, parseComputerMode } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { AgentImportServices } from "./agent-import.js";
import type { AgentSkillsService } from "./agent-skills.js";

type TransferDeps = { prisma: PrismaClient; home: AgentHomeStore };
type ExportedBot = SpaceExport["bots"][number];
type ExportableBot = {
  id: string;
  computer: { homeKey: string; scope: string } | null;
};

/** Valid UTF-8 stays readable text; anything else is base64 so the bytes survive the JSON. */
function exportFile(path: string, content: Uint8Array): ExportManifest["files"][number] {
  try {
    return {
      path,
      content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content),
    };
  } catch {
    return { path, content: Buffer.from(content).toString("base64"), encoding: "base64" };
  }
}

/** What a bot carries between servers: its memory, routines and workspace files. */
export async function gatherBotContent(
  deps: TransferDeps,
  actor: Actor,
  bot: ExportableBot,
): Promise<Pick<ExportedBot, "memory" | "routines" | "files">> {
  if (!bot.computer) throw new IsolationError();
  const homeKey = bot.computer.homeKey;
  const context = {
    operationId: "export",
    traceId: "export",
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal: new AbortController().signal,
  };
  const [memory, routines, files] = await Promise.all([
    deps.prisma.memoryDocument.findMany({ where: { botId: bot.id, spaceId: actor.spaceId } }),
    deps.prisma.routine.findMany({ where: { botId: bot.id, spaceId: actor.spaceId } }),
    (async () => {
      const exported: ExportManifest["files"] = [];
      const directory = resolveBotWorkspacePath(parseComputerMode(bot.computer!.scope), bot.id, "");
      // Root dotfiles contain computer state rather than portable bot files.
      for await (const file of deps.home.exportHome(homeKey, context, {
        directory,
        skipHidden: true,
      })) {
        exported.push(exportFile(file.path, file.content));
      }
      return exported;
    })(),
  ]);
  return {
    memory: memory.map((m) => ({ path: m.path, content: m.content })),
    routines: routines.map((r) => ({
      name: r.name,
      prompt: r.prompt,
      crons: r.crons,
      timezone: r.timezone,
    })),
    files,
  };
}

export async function exportSpace(
  deps: TransferDeps,
  repos: {
    listBots: (actor: Actor) => Promise<{ id: string }[]>;
    getBot: (
      actor: Actor,
      id: string,
    ) => Promise<
      ExportableBot & Pick<ExportedBot["bot"], "name" | "title" | "description" | "instructions">
    >;
  },
  actor: Actor,
): Promise<SpaceExport> {
  const owner = { spaceId: actor.spaceId, userId: actor.userId };
  const listed = await repos.listBots(actor);
  const bots: ExportedBot[] = [];
  for (const { id } of listed) {
    const bot = await repos.getBot(actor, id);
    bots.push({
      bot: {
        name: bot.name,
        title: bot.title,
        description: bot.description,
        instructions: bot.instructions,
        computerMode: parseComputerMode(bot.computer!.scope),
      },
      ...(await gatherBotContent(deps, actor, bot)),
    });
  }
  const [memory, skills] = await Promise.all([
    deps.prisma.memoryDocument.findMany({
      where: { ...owner, scope: "user", botId: null },
      orderBy: { path: "asc" },
    }),
    deps.prisma.agentSkill.findMany({
      where: { ...owner, source: "user" },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    version: 1,
    kind: "space",
    exportedAt: new Date().toISOString(),
    bots,
    memory: memory.map((m) => ({ path: m.path, content: m.content })),
    skills: skills.map((s) => ({ content: s.content })),
  };
}

async function writeMemory(
  tx: Prisma.TransactionClient,
  owner: { spaceId: string; userId: string },
  scope: { botId: string | null },
  item: { path: string; content: string },
  existingId: string | null,
) {
  const document = existingId
    ? await tx.memoryDocument.update({
        where: { id: existingId },
        data: { content: item.content },
      })
    : await tx.memoryDocument.create({
        data: {
          ...owner,
          scope: scope.botId ? "bot" : "user",
          botId: scope.botId,
          path: item.path,
          content: item.content,
        },
      });
  await tx.memoryRevision.create({
    data: { documentId: document.id, revision: document.revision, content: item.content },
  });
}

/**
 * Adds what the space doesn't have yet. Bots are matched by name, ignoring case; routines
 * arrive paused; credentials, connections and chat history are never part of the file.
 */
export async function importSpace<PreparedKey>(
  services: AgentImportServices<PreparedKey>,
  deps: TransferDeps,
  agentSkills: Pick<AgentSkillsService, "create">,
  actor: Actor,
  input: SpaceExport,
): Promise<SpaceImportResult> {
  const owner = { spaceId: actor.spaceId, userId: actor.userId };
  const taken = new Set(
    (await deps.prisma.bot.findMany({ where: owner, select: { name: true } })).map((row) =>
      row.name.toLowerCase(),
    ),
  );
  const result: SpaceImportResult = {
    added: [],
    existing: [],
    skills: 0,
    routines: 0,
    skippedFiles: 0,
  };
  const announce: { botId: string; rows: Prisma.RoutineGetPayload<object>[] }[] = [];

  for (const entry of input.bots) {
    const key = entry.bot.name.toLowerCase();
    if (taken.has(key)) {
      result.existing.push(entry.bot.name);
      continue;
    }
    taken.add(key);
    // A bad schedule skips that routine; a throw inside the seed would drop the whole bot.
    const routines = entry.routines.flatMap((routine) => {
      try {
        const parsed = CreateRoutineInput.parse({
          botId: "pending",
          name: routine.name,
          prompt: routine.prompt,
          crons: routine.crons,
          timezone: routine.timezone,
          active: false,
        });
        services.assertRoutineSchedule(parsed);
        services.routineNextRunAt(parsed);
        return [parsed];
      } catch {
        return [];
      }
    });
    const bot = await services.createBot(actor, {
      name: entry.bot.name,
      title: entry.bot.title,
      description: entry.bot.description,
      instructions: entry.bot.instructions,
      notifyOnFinish: true,
      computerMode: entry.bot.computerMode,
      modelProvider: null,
      modelId: null,
      seed: async (tx, botId) => {
        // A serialization conflict runs the seed again: start each attempt clean.
        for (const item of entry.memory) {
          const seeded =
            item.path === MEMORY_INDEX_PATH
              ? await tx.memoryDocument.findFirst({
                  where: { ...owner, scope: "bot", botId, path: item.path },
                  select: { id: true },
                })
              : null;
          await writeMemory(tx, owner, { botId }, item, seeded?.id ?? null);
        }
        const rows: Prisma.RoutineGetPayload<object>[] = [];
        for (const routine of routines) {
          const withBot = { ...routine, botId };
          const row = await tx.routine.create({
            data: services.routineRowData(actor, withBot, services.routineNextRunAt(withBot)),
          });
          rows.push(row);
        }
        announce.push({ botId, rows });
      },
    });
    result.added.push(entry.bot.name);
    const rows = announce.filter((a) => a.botId === bot.id).at(-1)?.rows ?? [];
    result.routines += rows.length;

    const homeKey =
      (
        await deps.prisma.bot.findUnique({
          where: { id: bot.id },
          select: { computer: { select: { homeKey: true } } },
        })
      )?.computer?.homeKey ?? null;
    const context = {
      operationId: "import",
      traceId: "import",
      spaceId: actor.spaceId,
      userId: actor.userId,
      signal: new AbortController().signal,
    };
    for (const file of entry.files) {
      if (file.encoding === "base64" || !homeKey) {
        result.skippedFiles += 1;
        continue;
      }
      try {
        await deps.home.writeFile(
          homeKey,
          resolveBotWorkspacePath(entry.bot.computerMode, bot.id, file.path),
          file.content,
          context,
        );
      } catch (error) {
        getLogger().error("imported file", error);
        result.skippedFiles += 1;
      }
    }
    const thread = bot.threadId ? { id: bot.threadId } : null;
    for (const row of rows) {
      await services
        .announceRoutine(actor, { id: bot.id, thread }, row)
        .catch((error: unknown) => getLogger().error("imported routine notice", error));
    }
  }

  const spacePaths = new Set(
    (
      await deps.prisma.memoryDocument.findMany({
        where: { ...owner, scope: "user", botId: null },
        select: { path: true },
      })
    ).map((row) => row.path),
  );
  for (const item of input.memory) {
    if (spacePaths.has(item.path)) continue;
    spacePaths.add(item.path);
    await services.inTransaction((tx) => writeMemory(tx, owner, { botId: null }, item, null));
  }

  for (const skill of input.skills) {
    try {
      await agentSkills.create(actor, { content: skill.content });
      result.skills += 1;
    } catch {
      // A name already in use, or a SKILL.md this server can't read: leave it out.
    }
  }
  return result;
}
