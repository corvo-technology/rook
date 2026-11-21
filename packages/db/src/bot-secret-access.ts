import { randomBytes } from "node:crypto";
import type { BotSecretDestination } from "@corvo/contracts";
import { BotSecretAuth, commandVariableName } from "@corvo/contracts";
import type { Prisma, PrismaClient } from "./client.js";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * The credentials one run may use: those saved for, or granted to, its agent. A personal one is
 * also limited to runs for its owner; a space one is usable by runs for any member. `userId` is
 * whom the run acts for, not who is chatting.
 */
export function usableBotSecrets(run: {
  spaceId: string;
  botId: string;
  userId: string;
}): Prisma.BotSecretWhereInput {
  const { spaceId, botId, userId } = run;
  return {
    spaceId,
    AND: [
      { OR: [{ botId }, { grants: { some: { botId } } }] },
      { OR: [{ scope: "space" }, { userId }] },
    ],
  };
}

/** Credentials a person may see in a space, whatever agent they are for. */
export function visibleBotSecrets(person: {
  spaceId: string;
  userId: string;
}): Prisma.BotSecretWhereInput {
  return { spaceId: person.spaceId, OR: [{ scope: "space" }, { userId: person.userId }] };
}

function sameAuth(left: unknown, right: unknown): boolean {
  const a = BotSecretAuth.safeParse(left);
  const b = BotSecretAuth.safeParse(right);
  return a.success && b.success && JSON.stringify(a.data) === JSON.stringify(b.data);
}

/**
 * Another command credential this agent could already use that is exported as the same variable.
 * Two of them would silently shadow each other in its shell.
 */
export async function commandVariableClash(
  client: Client,
  run: { spaceId: string; botId: string; userId: string },
  credential: { name: string; auth: unknown },
): Promise<string | undefined> {
  if (BotSecretAuth.safeParse(credential.auth).data?.type !== "command") return undefined;
  const variable = commandVariableName(credential.name);
  const rows = await client.botSecret.findMany({
    where: { ...usableBotSecrets(run), name: { not: credential.name } },
    select: { name: true, auth: true },
    take: 100,
  });
  return rows.find(
    (row) =>
      BotSecretAuth.safeParse(row.auth).data?.type === "command" &&
      commandVariableName(row.name) === variable,
  )?.name;
}

/**
 * Lets an agent use a personal credential this person already saved: the same name and
 * destination. A team credential is never given out here, since that takes the credentials
 * permission and this runs for any member. Throws when none matches, so the caller's transaction
 * rolls back.
 */
export async function grantSavedBotSecret(
  tx: Prisma.TransactionClient,
  run: { spaceId: string; botId: string; userId: string },
  destination: BotSecretDestination,
): Promise<void> {
  const rows = await tx.botSecret.findMany({
    where: { spaceId: run.spaceId, userId: run.userId, scope: "personal", name: destination.name },
    select: { id: true, origin: true, auth: true, botId: true },
    take: 20,
  });
  const row = rows.find(
    (candidate) =>
      candidate.origin === destination.origin && sameAuth(candidate.auth, destination.auth),
  );
  if (!row) throw new Error("Secret request changed; retry");
  const clash = await commandVariableClash(tx, run, destination);
  if (clash) throw new Error("Secret request changed; retry");
  // The agent it was first saved for becomes a grant too, so deleting either agent later removes
  // only its own access to a credential the other still uses.
  const agents = [...new Set([run.botId, ...(row.botId ? [row.botId] : [])])];
  await tx.botSecretGrant.createMany({
    data: agents.map((botId) => ({
      id: randomBytes(12).toString("hex"),
      secretId: row.id,
      botId,
      spaceId: run.spaceId,
    })),
    skipDuplicates: true,
  });
  if (row.botId) await tx.botSecret.update({ where: { id: row.id }, data: { botId: null } });
}
