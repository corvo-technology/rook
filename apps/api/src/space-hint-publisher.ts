import type { Actor, SpaceHintKind } from "@corvo/contracts";
import type { HintReach, PrismaClient, SpaceHints } from "@corvo/db";
import { botHintReach, groupHintReach } from "@corvo/db";

/** Procedures that only read; every other call in a watched area may have changed something. */
const READS =
  /^(list|get|head|messages|pinned|context|search|status|updates|people|subscribe|calendar|history|workflows|files|readFile|downloadFile|terminalUrl|commands|screenUrl|heartbeat|importPreview|importInfo|importSetupState|designAvatar)/;

/** Which lists a successful call may have changed. A mutation hint is a generic nudge: it names nothing. */
function kindsFor(path: readonly string[]): readonly SpaceHintKind[] {
  const [area, name = ""] = path;
  if (!area || READS.test(name)) return [];
  switch (area) {
    case "bots":
    case "groups":
    case "botSections":
      return ["roster", "routines"];
    case "spaces":
      return name === "create" ? [] : ["roster"];
    case "routines":
      return ["routines"];
    case "computer":
      return ["computer"];
    case "threads":
      return name === "markRead" || name === "markUnread" || name === "clear"
        ? ["roster", "notifications"]
        : [];
    case "directMessages":
      return name === "markRead" ? ["dm", "notifications"] : [];
    case "inbox":
      return ["notifications"];
    default:
      return [];
  }
}

/**
 * After a call succeeds, tells the people who see the change to read the affected list again.
 * Writes made by the worker or by an agent publish their own hints where they commit; this covers
 * what members do through the API. Failures are swallowed: the client's fallback refetch catches up.
 */
export async function publishMutationHints(
  deps: { prisma: PrismaClient; spaceHints?: SpaceHints },
  actor: Pick<Actor, "spaceId" | "userId">,
  path: readonly string[],
  input: unknown,
  output: unknown,
): Promise<void> {
  const kinds = kindsFor(path);
  if (kinds.length === 0 || !deps.spaceHints) return;
  try {
    const area = path[0];
    const named = (key: string): string | undefined => {
      for (const source of [input, output]) {
        const value = (source as Record<string, unknown> | null | undefined)?.[key];
        if (typeof value === "string") return value;
      }
      return undefined;
    };
    let reach: HintReach | undefined;
    if (area === "threads" || area === "directMessages" || area === "inbox") {
      // Read state belongs to the person who changed it; their other tabs are the audience.
      reach = { users: [actor.userId] };
    } else if (area === "groups") {
      const groupId = named("groupId") ?? named("id");
      reach = groupId ? await groupHintReach(deps.prisma, actor.spaceId, groupId) : undefined;
    } else if (area === "bots" || area === "routines") {
      const botId = named("botId") ?? (area === "bots" ? named("id") : undefined);
      reach = botId ? await botHintReach(deps.prisma, actor.spaceId, botId) : undefined;
    }
    await deps.spaceHints.publish(actor.spaceId, kinds, reach);
  } catch {
    // A missed hint costs one fallback interval, never a failed request.
  }
}
