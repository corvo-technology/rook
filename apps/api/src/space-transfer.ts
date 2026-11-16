import type { AgentHomeStore } from "@corvo/adapter-kit";
import { parseRoutineWatch, resolveBotWorkspacePath } from "@corvo/adapters";
import type { Actor, ExportManifest, SpaceExport, SpaceImportResult } from "@corvo/contracts";
import {
  BoardStatusLabelsSchema,
  BotStartersSchema,
  CreateRoutineInput,
  GROUP_MEMBER_MIN,
  isTicketCompletedStatus,
  MEMORY_INDEX_PATH,
  TicketFieldsSchema,
  TicketPrioritySchema,
  TicketStatusSchema,
  UserMemorySourceSchema,
  WikiSettingsSchema,
} from "@corvo/contracts";
import { organicAvatarFamily, wikiCanonicalTitle, wikiSlug } from "@corvo/core";
import type { Prisma, PrismaClient } from "@corvo/db";
import {
  createGroupRepos,
  IsolationError,
  parseComputerMode,
  proposeUserMemory,
  setWikiSettings,
  userMemoryFingerprint,
  writeWikiPage,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { AgentImportServices } from "./agent-import.js";
import type { AgentSkillsService } from "./agent-skills.js";

/** Whether this server can run a model a routine of the file names (a CLI engine or local model may not exist here). */
export type ModelUsable = (provider: string, modelId: string) => Promise<boolean>;
type TransferDeps = { prisma: PrismaClient; home: AgentHomeStore };
type ExportedBot = SpaceExport["bots"][number];
type ExportedRoutine = ExportedBot["routines"][number];
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
    deps.prisma.routine.findMany({
      where: { botId: bot.id, spaceId: actor.spaceId },
      include: {
        steps: { orderBy: { position: "asc" }, include: { bot: { select: { name: true } } } },
      },
    }),
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
      notify: r.notify,
      webhookEnabled: r.webhookEnabled,
      githubEnabled: r.githubEnabled,
      messageProvider: r.messageProvider,
      modelProvider: r.modelProvider,
      modelId: r.modelId,
      thinkingLevel: r.thinkingLevel as ExportedRoutine["thinkingLevel"],
      watch: parseRoutineWatch(r.watch),
      steps: r.steps.map((step) => ({ bot: step.bot.name, instruction: step.instruction })),
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
      ExportableBot &
        Pick<ExportedBot["bot"], "name" | "title" | "description" | "instructions"> & {
          color: string;
          notifyOnFinish: boolean;
          starters?: unknown;
          disabledBuiltinTools?: string[];
          sectionId: string | null;
        }
    >;
  },
  actor: Actor,
): Promise<SpaceExport> {
  const owner = { spaceId: actor.spaceId, userId: actor.userId };
  const listed = await repos.listBots(actor);
  const bots: ExportedBot[] = [];
  const botNames = new Map<string, string>();
  const botSections = new Map<string, string[]>();
  for (const { id } of listed) {
    const bot = await repos.getBot(actor, id);
    bots.push({
      bot: {
        name: bot.name,
        title: bot.title,
        description: bot.description,
        instructions: bot.instructions,
        computerMode: parseComputerMode(bot.computer!.scope),
        color: bot.color,
        avatarFamily: organicAvatarFamily(id),
        notifyOnFinish: bot.notifyOnFinish,
        starters: BotStartersSchema.catch([]).parse(bot.starters ?? []),
        disabledBuiltinTools: bot.disabledBuiltinTools ?? [],
      },
      ...(await gatherBotContent(deps, actor, bot)),
    });
    botNames.set(id, bot.name);
    if (bot.sectionId)
      botSections.set(bot.sectionId, [...(botSections.get(bot.sectionId) ?? []), bot.name]);
  }
  const [memory, skills, wiki, wikiSettings, facts, groups, board, sections] = await Promise.all([
    deps.prisma.memoryDocument.findMany({
      where: { ...owner, scope: "user", botId: null },
      orderBy: { path: "asc" },
    }),
    deps.prisma.agentSkill.findMany({
      where: { ...owner, source: "user" },
      orderBy: { name: "asc" },
    }),
    deps.prisma.memoryDocument.findMany({
      where: { spaceId: actor.spaceId, scope: "wiki", NOT: { path: { startsWith: "." } } },
      orderBy: { path: "asc" },
    }),
    deps.prisma.wikiSettings.findUnique({ where: { spaceId: actor.spaceId } }),
    // Read through the client that decrypts, so the file holds the text itself.
    deps.prisma.userMemory.findMany({
      where: { ...owner, state: { in: ["saved", "pending"] } },
      orderBy: { createdAt: "asc" },
    }),
    deps.prisma.chatGroup.findMany({
      where: { ...owner, archivedAt: null },
      orderBy: { createdAt: "asc" },
      include: { members: { orderBy: { createdAt: "asc" } } },
    }),
    deps.prisma.board.findUnique({
      where: { spaceId: actor.spaceId },
      include: {
        tickets: {
          orderBy: { number: "asc" },
          include: { comments: { orderBy: { createdAt: "asc" } } },
        },
      },
    }),
    deps.prisma.botSection.findMany({ where: owner, orderBy: { position: "asc" } }),
  ]);
  const channels = groups.flatMap((group) => {
    const members = group.members.flatMap((m) => botNames.get(m.botId) ?? []);
    return members.length >= GROUP_MEMBER_MIN
      ? [{ name: group.name, purpose: group.purpose, members, sectionId: group.sectionId }]
      : [];
  });
  return {
    version: 1,
    kind: "space",
    exportedAt: new Date().toISOString(),
    bots,
    memory: memory.map((m) => ({ path: m.path, content: m.content })),
    skills: skills.map((s) => ({ content: s.content })),
    wiki: wiki.map((page) => ({ title: page.path.replace(/\.md$/, ""), body: page.content })),
    wikiSettings: wikiSettings
      ? WikiSettingsSchema.catch({ capture: true, edits: "approve" }).parse(wikiSettings)
      : null,
    facts: facts.map((fact) => ({
      text: fact.text,
      state: fact.state === "pending" ? ("pending" as const) : ("saved" as const),
      source: UserMemorySourceSchema.catch("typed").parse(fact.source),
      bot: fact.botId ? (botNames.get(fact.botId) ?? null) : null,
    })),
    channels: channels.map(({ sectionId: _section, ...channel }) => channel),
    board:
      board && board.tickets.length > 0
        ? {
            name: board.name,
            ticketPrefix: board.ticketPrefix,
            statusLabels: BoardStatusLabelsSchema.nullable().catch(null).parse(board.statusLabels),
            tickets: board.tickets.map((ticket) => ({
              number: ticket.number,
              title: ticket.title,
              description: ticket.description,
              status: TicketStatusSchema.catch("todo").parse(ticket.status),
              priority: TicketPrioritySchema.nullable().catch(null).parse(ticket.priority),
              assignee: ticket.assigneeBotId ? (botNames.get(ticket.assigneeBotId) ?? null) : null,
              fields: TicketFieldsSchema.catch([]).parse(ticket.fields ?? []),
              comments: ticket.comments.map((comment) => ({
                author: comment.authorBotId ? (botNames.get(comment.authorBotId) ?? null) : null,
                body: comment.body,
              })),
            })),
          }
        : null,
    sections: sections.map((section) => ({
      name: section.name,
      bots: botSections.get(section.id) ?? [],
      channels: channels.filter((c) => c.sectionId === section.id).map((c) => c.name),
    })),
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
  modelUsable: ModelUsable = async () => true,
): Promise<SpaceImportResult> {
  const owner = { spaceId: actor.spaceId, userId: actor.userId };
  // Every bot of the space by lowercase name; the ones this file adds join it as they are made.
  const botIds = new Map(
    (await deps.prisma.bot.findMany({ where: owner, select: { id: true, name: true } })).map(
      (row) => [row.name.toLowerCase(), row.id] as const,
    ),
  );
  const taken = new Set(botIds.keys());
  const addedIds = new Map<string, string>();
  const stepsToAdd: { routineId: string; steps: ExportedRoutine["steps"] }[] = [];
  const result: SpaceImportResult = {
    added: [],
    existing: [],
    skills: 0,
    routines: 0,
    skippedRoutines: 0,
    skippedFiles: 0,
    wikiPages: 0,
    facts: 0,
    channels: 0,
    tickets: 0,
    modelsReset: 0,
  };
  // A routine pinned to a model this server cannot run (a CLI engine or local model of the machine
  // that exported) goes back to the space's model, so it works as soon as it is turned on.
  const usable = new Map<string, boolean>();
  for (const entry of input.bots) {
    for (const routine of entry.routines) {
      if (!routine.modelProvider || !routine.modelId) continue;
      const key = `${routine.modelProvider}\u0000${routine.modelId}`;
      if (!usable.has(key)) {
        usable.set(
          key,
          await modelUsable(routine.modelProvider, routine.modelId).catch(() => false),
        );
      }
    }
  }
  const announce: { botId: string; rows: Prisma.RoutineGetPayload<object>[] }[] = [];

  for (const entry of input.bots) {
    const key = entry.bot.name.toLowerCase();
    if (taken.has(key)) {
      result.existing.push(entry.bot.name);
      continue;
    }
    taken.add(key);
    // A bad schedule skips that routine; a throw inside the seed would drop the whole bot.
    // Whatever a routine waits on (a connection, a model key) may not exist here: it arrives
    // paused either way, and the person reconnects before turning it on.
    const routines = entry.routines.flatMap((routine) => {
      try {
        const { steps, ...fields } = routine;
        const pinned = fields.modelProvider && fields.modelId;
        const reset =
          pinned && usable.get(`${fields.modelProvider}\u0000${fields.modelId}`) === false;
        const parsed = CreateRoutineInput.parse({
          ...fields,
          ...(reset ? { modelProvider: null, modelId: null } : {}),
          botId: "pending",
          active: false,
        });
        if (reset) result.modelsReset += 1;
        services.assertRoutineSchedule(parsed);
        services.routineNextRunAt(parsed);
        return [{ input: parsed, steps }];
      } catch {
        result.skippedRoutines += 1;
        return [];
      }
    });
    const bot = await services.createBot(actor, {
      name: entry.bot.name,
      title: entry.bot.title,
      description: entry.bot.description,
      instructions: entry.bot.instructions,
      notifyOnFinish: entry.bot.notifyOnFinish,
      color: entry.bot.color,
      avatarFamily: entry.bot.avatarFamily,
      starters: entry.bot.starters,
      disabledBuiltinTools: entry.bot.disabledBuiltinTools,
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
        for (const { input: routine } of routines) {
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
    botIds.set(key, bot.id);
    addedIds.set(key, bot.id);
    const rows = announce.filter((a) => a.botId === bot.id).at(-1)?.rows ?? [];
    result.routines += rows.length;
    rows.forEach((row, index) => {
      const steps = routines[index]?.steps ?? [];
      if (steps.length > 0) stepsToAdd.push({ routineId: row.id, steps });
    });

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

  // Steps name their agents, so they wait until every agent of the file exists.
  for (const { routineId, steps } of stepsToAdd) {
    const known = steps.flatMap((step) => {
      const botId = botIds.get(step.bot.toLowerCase());
      return botId ? [{ botId, instruction: step.instruction }] : [];
    });
    if (known.length === 0) continue;
    await services.inTransaction((tx) =>
      tx.routineStep.createMany({
        data: known.map((step, index) => ({ routineId, ...step, position: index + 2 })),
      }),
    );
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

  await importWiki(deps, owner, input, result);
  await importFacts(deps, owner, input, botIds, result);
  const channelIds = await importChannels(deps, actor, input, botIds, result);
  await importBoard(services, deps, actor, input, botIds, result);
  await importSections(services, owner, input, addedIds, channelIds);
  return result;
}

/** Pages whose title is already in the wiki stay as they are; their history is not carried. */
async function importWiki(
  deps: TransferDeps,
  owner: { spaceId: string; userId: string },
  input: SpaceExport,
  result: SpaceImportResult,
) {
  for (const page of input.wiki) {
    const title = wikiCanonicalTitle(page.title);
    const slug = wikiSlug(title);
    if (!slug) continue;
    const exists = await deps.prisma.memoryDocument.findFirst({
      where: { spaceId: owner.spaceId, scope: "wiki", slug },
      select: { id: true },
    });
    if (exists) continue;
    try {
      await writeWikiPage(deps.prisma, owner, { title, body: page.body, expectedRevision: 0 });
      result.wikiPages += 1;
    } catch {
      // A title without a letter or digit, or one written meanwhile: leave it out.
    }
  }
  if (input.wikiSettings) {
    const current = await deps.prisma.wikiSettings.findUnique({
      where: { spaceId: owner.spaceId },
      select: { spaceId: true },
    });
    if (!current) await setWikiSettings(deps.prisma, owner.spaceId, input.wikiSettings);
  }
}

/** Facts about the person, written the way the app writes them; one it has or forgot stays as is. */
async function importFacts(
  deps: TransferDeps,
  owner: { spaceId: string; userId: string },
  input: SpaceExport,
  botIds: Map<string, string>,
  result: SpaceImportResult,
) {
  for (const fact of input.facts) {
    try {
      const known = await deps.prisma.userMemory.findUnique({
        where: {
          spaceId_userId_fingerprint: {
            ...owner,
            fingerprint: userMemoryFingerprint(owner, fact.text),
          },
        },
        select: { id: true },
      });
      if (known) continue;
      const botId = fact.bot ? botIds.get(fact.bot.toLowerCase()) : undefined;
      const proposed = await proposeUserMemory(deps.prisma, owner, {
        text: fact.text,
        source: fact.source,
        state: fact.state,
        ...(botId ? { botId } : {}),
      });
      if (proposed.outcome === "created") result.facts += 1;
    } catch {
      // A line the app would refuse as a memory: leave it out.
    }
  }
}

/** Channels the space doesn't have by name, with the members this space has; no messages. */
async function importChannels(
  deps: TransferDeps,
  actor: Actor,
  input: SpaceExport,
  botIds: Map<string, string>,
  result: SpaceImportResult,
): Promise<Map<string, string>> {
  const made = new Map<string, string>();
  if (input.channels.length === 0) return made;
  const names = new Set(
    (
      await deps.prisma.chatGroup.findMany({
        where: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
        select: { name: true },
      })
    ).map((row) => row.name.toLowerCase()),
  );
  const groups = createGroupRepos(deps.prisma);
  for (const channel of input.channels) {
    const key = channel.name.toLowerCase();
    if (names.has(key)) continue;
    const members = [
      ...new Set(channel.members.flatMap((name) => botIds.get(name.toLowerCase()) ?? [])),
    ];
    if (members.length < GROUP_MEMBER_MIN) continue;
    try {
      const group = await groups.createGroup(actor, {
        name: channel.name,
        purpose: channel.purpose,
        botIds: members,
      });
      names.add(key);
      made.set(key, group.id);
      result.channels += 1;
    } catch (error) {
      getLogger().error("imported channel", error);
    }
  }
  return made;
}

/**
 * A space has one board. Its tickets arrive only on a board that has none, keeping their numbers
 * so references in the pages and comments still point at them.
 */
async function importBoard<PreparedKey>(
  services: AgentImportServices<PreparedKey>,
  deps: TransferDeps,
  actor: Actor,
  input: SpaceExport,
  botIds: Map<string, string>,
  result: SpaceImportResult,
) {
  const { board } = input;
  if (!board || board.tickets.length === 0) return;
  const existing = await deps.prisma.board.findUnique({
    where: { spaceId: actor.spaceId },
    select: { id: true, _count: { select: { tickets: true } } },
  });
  if (existing && existing._count.tickets > 0) return;
  const settings = {
    ticketPrefix: board.ticketPrefix,
    nextNumber: Math.max(...board.tickets.map((ticket) => ticket.number)) + 1,
    ...(board.statusLabels ? { statusLabels: board.statusLabels } : {}),
  };
  const assignee = (name: string | null) =>
    name ? (botIds.get(name.toLowerCase()) ?? null) : null;
  await services.inTransaction(async (tx) => {
    const id = existing
      ? (await tx.board.update({ where: { id: existing.id }, data: settings })).id
      : (await tx.board.create({ data: { spaceId: actor.spaceId, name: board.name, ...settings } }))
          .id;
    for (const ticket of board.tickets) {
      await tx.ticket.create({
        data: {
          boardId: id,
          spaceId: actor.spaceId,
          number: ticket.number,
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          assigneeBotId: assignee(ticket.assignee),
          createdByUserId: actor.userId,
          completedAt: isTicketCompletedStatus(ticket.status) ? new Date() : null,
          ...(ticket.fields.length > 0 ? { fields: ticket.fields } : {}),
          comments: {
            create: ticket.comments.map((comment) => ({
              spaceId: actor.spaceId,
              authorBotId: assignee(comment.author),
              body: comment.body,
            })),
          },
        },
      });
    }
  });
  result.tickets = board.tickets.length;
}

/** Sections are made if missing; only the bots and channels this import added go into them. */
async function importSections<PreparedKey>(
  services: AgentImportServices<PreparedKey>,
  owner: { spaceId: string; userId: string },
  input: SpaceExport,
  addedBots: Map<string, string>,
  addedChannels: Map<string, string>,
) {
  for (const section of input.sections) {
    const bots = section.bots.flatMap((name) => addedBots.get(name.toLowerCase()) ?? []);
    const channels = section.channels.flatMap(
      (name) => addedChannels.get(name.toLowerCase()) ?? [],
    );
    if (bots.length === 0 && channels.length === 0) continue;
    await services.inTransaction(async (tx) => {
      const last = await tx.botSection.aggregate({ where: owner, _max: { position: true } });
      await tx.botSection.createMany({
        data: { ...owner, name: section.name, position: (last._max.position ?? -1) + 1 },
        skipDuplicates: true,
      });
      const row = await tx.botSection.findUniqueOrThrow({
        where: { spaceId_userId_name: { ...owner, name: section.name } },
      });
      await tx.bot.updateMany({
        where: { id: { in: bots }, ...owner },
        data: { sectionId: row.id },
      });
      await tx.chatGroup.updateMany({
        where: { id: { in: channels }, ...owner },
        data: { sectionId: row.id },
      });
    });
  }
}
