import type { MessageBlock } from "@corvo/contracts";
import { APP_CATALOG, storedAccessLevel } from "@corvo/core";
import { getLogger } from "@corvo/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { isUniqueViolation, persistMessageInTransaction } from "./run-messages.js";

const RECENT_MESSAGES = 50;

type CatalogApp = (typeof APP_CATALOG)[number];

/** What the card asks for when the app signs in with an API key sent as a bearer token. */
function bearerKeyAsk(app: CatalogApp | undefined) {
  if (
    app?.auth.kind !== "key" ||
    app.auth.header !== "Authorization" ||
    app.auth.scheme !== "bearer"
  )
    return undefined;
  return { label: app.auth.label, hint: app.auth.hint, docsUrl: app.auth.docsUrl };
}

type Target = { id: string; spaceId: string; userId: string; threadId: string; botId: string };

const normalize = (value: string) => value.trim().toLowerCase();

const MAX_LISTED_AGENTS = 20;

/**
 * The teammate a card is for: one of the owner's agents that is not archived, by id or by name
 * (exact first, then a name that contains it when only one does). An error names the choices.
 */
async function resolveTeammate(deps: ExecutorDeps, run: Target, agent: string) {
  const agents = await deps.prisma.bot.findMany({
    where: { spaceId: run.spaceId, userId: run.userId, archivedAt: null },
    select: { id: true, name: true },
  });
  const wanted = normalize(agent);
  const exact = agents.filter(
    (item) => item.id === agent.trim() || normalize(item.name) === wanted,
  );
  const found =
    exact.length > 0 ? exact : agents.filter((item) => normalize(item.name).includes(wanted));
  if (found.length === 1 && found[0]) return found[0];
  const names = agents
    .slice(0, MAX_LISTED_AGENTS)
    .map((item) => item.name)
    .join(", ");
  return {
    error:
      found.length > 1
        ? `More than one agent matches "${agent.trim()}": ${found.map((item) => item.name).join(", ")}. Ask for one by its full name.`
        : `No agent is named "${agent.trim()}". Agents you can ask for: ${names}.`,
  };
}

/**
 * connect_app for an app the owner already added to the workspace, or that the app catalog has.
 * An added server this agent cannot use yet gets the approval card that assigns it. A catalog app
 * that signs in with OAuth is added first, so the card can lead with the sign-in; one that needs a
 * key or the desktop app is named, with where the user adds it. Undefined when the name matches
 * neither, so the connector catalog is searched as before.
 */
export async function requestSpaceAppAccess(
  deps: ExecutorDeps,
  run: Target,
  app: string,
  agent?: string,
  level: "read" | "write" = "write",
) {
  // The card goes in the asking agent's own chat, where the user is; it is for the teammate named.
  const teammate = agent?.trim() ? await resolveTeammate(deps, run, agent) : undefined;
  if (teammate && "error" in teammate) return teammate;
  const forBot = teammate && teammate.id !== run.botId ? teammate : undefined;
  const subjectBotId = forBot?.id ?? run.botId;
  const wanted = normalize(app);
  const servers = await deps.prisma.mcpServer.findMany({
    where: { spaceId: run.spaceId, userId: run.userId, enabled: true },
    select: {
      id: true,
      name: true,
      slug: true,
      transport: true,
      endpoint: true,
      secretId: true,
      assignments: {
        where: { botId: subjectBotId },
        select: { id: true, allowAllTools: true, level: true },
      },
    },
  });
  let server =
    servers.find((item) => normalize(item.slug) === wanted || normalize(item.name) === wanted) ??
    servers.find((item) => normalize(item.name).includes(wanted));
  if (!server) {
    const known = APP_CATALOG.find(
      (entry) => normalize(entry.slug) === wanted || normalize(entry.name) === wanted,
    );
    if (!known) return undefined;
    // A desktop-only sign-in needs the app, and a key sent any other way than as a bearer token
    // has no card yet; the user adds those from the Store, where the key goes to the vault.
    if (known.desktopOnly || (known.auth.kind === "key" && !bearerKeyAsk(known))) {
      return {
        error: `${known.name} is in the app catalog but has not been added to this workspace, and ${known.desktopOnly ? "its sign-in needs the desktop app" : "it needs an API key"}. Ask the user to add it from the Store (Apps, ${known.name}, Add), never to paste a key in chat, then call connect_app again.`,
      };
    }
    try {
      server = {
        ...(await deps.prisma.mcpServer.create({
          data: {
            spaceId: run.spaceId,
            userId: run.userId,
            slug: known.slug,
            name: known.name,
            description: known.tagline,
            transport: known.transport,
            endpoint: known.endpoint,
            enabled: true,
          },
          select: {
            id: true,
            name: true,
            slug: true,
            transport: true,
            endpoint: true,
            secretId: true,
          },
        })),
        assignments: [],
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return {
        error: `${known.name} already exists in this workspace but is turned off. Ask the user to turn it on in the MCP servers settings.`,
      };
    }
  }
  // Read access is met by any grant; write access by write, or a per-tool list set on purpose.
  const granted = server.assignments.some(
    (row) => level === "read" || !row.allowAllTools || storedAccessLevel(row.level) === "write",
  );
  if (granted) {
    return {
      status: "connected",
      message: forBot
        ? `${server.name} is already assigned to ${forBot.name}, so its tools are available to them. If they report them missing, the server is unavailable: say so rather than that access is missing.`
        : `${server.name} is already assigned to you, so its tools are available. If they are missing, the server is unavailable: say so rather than that it is missing.`,
    };
  }
  const slug = normalize(server.slug);
  const needsKey = server.secretId
    ? undefined
    : bearerKeyAsk(APP_CATALOG.find((entry) => normalize(entry.slug) === slug));
  const block: MessageBlock = {
    kind: "mcp_approval",
    name: server.name,
    serverId: server.id,
    transport: server.transport as "streamable_http" | "sse" | "stdio",
    endpoint: server.endpoint,
    needsOAuth: !needsKey && server.transport !== "stdio" && !server.secretId,
    ...(needsKey ? { needsKey } : {}),
    status: "pending",
    ...(forBot ? { forBotId: forBot.id, forBotName: forBot.name } : {}),
    ...(level === "read" ? { level } : {}),
  };
  const committed = await deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM threads WHERE id = ${run.threadId} FOR UPDATE`;
    const recent = await tx.message.findMany({
      where: { threadId: run.threadId },
      select: { blocks: true },
      orderBy: { createdAt: "desc" },
      take: RECENT_MESSAGES,
    });
    const shown = recent.some((message) =>
      (message.blocks as MessageBlock[]).some(
        (candidate) =>
          candidate.kind === "mcp_approval" &&
          candidate.serverId === server.id &&
          candidate.status === "pending" &&
          candidate.forBotId === forBot?.id,
      ),
    );
    return shown ? null : persistMessageInTransaction(tx, run, "bot", [block]);
  });
  if (committed) {
    await deps.events
      .notify(run.threadId, committed.eventSeq, committed.firstResponseRunId)
      .catch((error) => getLogger().error("MCP approval realtime notification", error));
  }
  if (forBot) {
    return {
      status: "pending",
      message: needsKey
        ? `${server.name} is added to the workspace but not assigned to ${forBot.name}, and it needs an API key. A card in this chat asks the user for the key and gives ${forBot.name} the server. End your turn with one short sentence asking them to paste it there; never ask for the key in chat. You will be told when it is connected.`
        : `${server.name} is added to the workspace but not assigned to ${forBot.name}. A card in this chat asks the user to approve giving it to them. End your turn with one short sentence asking the user to approve it there; you will be told when it is connected, and then ${forBot.name} can use it.`,
    };
  }
  return {
    status: "pending",
    message: needsKey
      ? `${server.name} is added to the workspace but not assigned to you, and it needs an API key. A card in the chat asks the user for the key and connects it. End your turn with one short sentence asking them to paste it there; never ask for the key in chat. You will be told when it is connected.`
      : `${server.name} is added to the workspace but not assigned to you. An approval card is in the chat. End your turn with one short sentence asking the user to approve it there; you will be told when it is connected.`,
  };
}
