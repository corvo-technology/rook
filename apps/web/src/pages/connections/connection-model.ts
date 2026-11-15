import type {
  Bot,
  ConnectionAccess,
  ConnectionKind,
  DatabaseConnection,
  MailboxDto,
  McpServer,
} from "@corvo/contracts";
import { APP_CATALOG, matchAddedServer } from "@corvo/core";
import { plural, t } from "@lingui/core/macro";

export type AccessLevelChoice = "none" | "read" | "write";
export type ShownLevel = AccessLevelChoice | "custom";

export type ConnectionTone = "ok" | "warn" | "error" | "idle";

/** One row of the Connections page, whatever kind of connection it is. */
export type ConnectionItem = {
  kind: ConnectionKind;
  id: string;
  name: string;
  /** The line under the name: where it points. */
  detail: string;
  iconUrl?: string;
  tone: ConnectionTone;
  /** What state it is in, in a few words. */
  status: string;
  /** Someone else's server, which a manager tests, edits and removes but does not sign in or lend. */
  otherOwner: string | null;
  server?: McpServer;
  mailbox?: MailboxDto;
  database?: DatabaseConnection;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function mcpItem(server: McpServer): ConnectionItem {
  const app = APP_CATALOG.find((entry) => matchAddedServer(entry, [server]));
  const { health } = server;
  let tone: ConnectionTone = "idle";
  let status = t`Not checked yet`;
  if (server.oauthStatus === "reconnect") {
    tone = "warn";
    status = t`Needs reconnecting`;
  } else if (health.status === "error") {
    tone = "error";
    status = t`Not working`;
  } else if (health.status === "installing") {
    status = t`Installing…`;
  } else if (health.status === "ok") {
    tone = "ok";
    status =
      health.toolCount === null || health.toolCount === undefined
        ? t`Connected`
        : toolsLabel(health.toolCount);
  }
  return {
    kind: "mcp",
    id: server.id,
    name: server.name,
    detail: server.endpoint ? hostOf(server.endpoint) : (server.command ?? server.slug),
    iconUrl: app?.iconUrl,
    tone,
    status,
    otherOwner: server.owner && !server.owner.mine ? server.owner.name : null,
    server,
  };
}

/** "Connected · 46 tools". Plural forms are the message's own, so each language counts its own way. */
function toolsLabel(count: number): string {
  return plural(count, { one: "Connected · # tool", other: "Connected · # tools" });
}

export function databaseItem(database: DatabaseConnection): ConnectionItem {
  const unreachable = database.testedOk === false;
  return {
    kind: "database",
    id: database.id,
    name: database.name,
    detail: `${database.user}@${database.host}/${database.database}`,
    tone: unreachable ? "error" : "ok",
    status: unreachable ? t`Not reachable` : t`Read only`,
    otherOwner: null,
    database,
  };
}

export function mailboxItem(mailbox: MailboxDto): ConnectionItem {
  return {
    kind: "mailbox",
    id: mailbox.id,
    name: mailbox.address,
    detail: mailbox.imap.host,
    tone: "ok",
    status: t`Connected`,
    otherOwner: null,
    mailbox,
  };
}

/** The levels a kind of connection offers: a database is only read. */
export function levelChoices(kind: ConnectionKind): AccessLevelChoice[] {
  return kind === "database" ? ["none", "read"] : ["none", "read", "write"];
}

export function levelLabel(level: ShownLevel): string {
  switch (level) {
    case "none":
      return t`No access`;
    case "read":
      return t`Read`;
    case "write":
      return t`Read and write`;
    case "custom":
      return t`Custom`;
  }
}

/** The levels agents hold on one connection, by agent. An agent with none has no entry. */
export function levelsFor(
  access: readonly ConnectionAccess[],
  kind: ConnectionKind,
  connectionId: string,
): Map<string, ShownLevel> {
  const levels = new Map<string, ShownLevel>();
  for (const entry of access) {
    if (entry.kind === kind && entry.connectionId === connectionId) {
      levels.set(entry.botId, entry.level);
    }
  }
  return levels;
}

const NAMES_SHOWN = 3;

/** "Chief, Engineer and QA +4": the first names that can use a connection, then how many more. */
export function usedByNames(names: readonly string[], locale?: string): string | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, NAMES_SHOWN);
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(shown);
  return names.length > NAMES_SHOWN ? `${list} +${names.length - NAMES_SHOWN}` : list;
}

/** The agents a connection can be lent to, in the order the roster shows them. */
export function lendableBots(bots: readonly Bot[]): Bot[] {
  return bots.filter((bot) => !bot.archivedAt);
}
