import { randomBytes } from "node:crypto";
import type { SecretStore } from "@corvo/adapter-kit";
import type { BotSecretDestination } from "@corvo/contracts";
import { commandVariableName } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { commandVariableClash, visibleBotSecrets, withTransactionRetry } from "@corvo/db";
import {
  assertStorableSecretValue,
  normalizeSecretDestination,
  prepareBotSecret,
} from "./bot-secrets.js";
import { persistPreparedSecret } from "./secret-persistence.js";

type Person = { spaceId: string; userId: string };
const rowSelect = {
  id: true,
  userId: true,
  spaceId: true,
  name: true,
  origin: true,
  auth: true,
  scope: true,
  botId: true,
  createdAt: true,
  updatedAt: true,
  grants: { select: { botId: true } },
} as const;

/** What the Vault shows of a credential. Never the ciphertext or any part of the value. */
export async function listVaultCredentials(prisma: PrismaClient, person: Person) {
  const rows = await prisma.botSecret.findMany({
    where: visibleBotSecrets(person),
    select: rowSelect,
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const used = rows.length
    ? await prisma.botSecretUse.groupBy({
        by: ["secretId"],
        where: { secretId: { in: rows.map((row) => row.id) } },
        _max: { createdAt: true },
      })
    : [];
  const lastUsed = new Map(used.map((row) => [row.secretId, row._max.createdAt]));
  return rows.map((row) => ({ ...row, lastUsedAt: lastUsed.get(row.id) ?? null }));
}

/** One credential the person can see, or null. */
export async function loadVaultCredential(prisma: PrismaClient, person: Person, id: string) {
  return await prisma.botSecret.findFirst({
    where: { ...visibleBotSecrets(person), id },
    select: rowSelect,
  });
}
export type VaultRow = NonNullable<Awaited<ReturnType<typeof loadVaultCredential>>>;

/** The agents that may use a credential: the one it was first saved for and every grant. */
export function vaultRowBotIds(row: Pick<VaultRow, "botId" | "grants">): string[] {
  return [...new Set([...(row.botId ? [row.botId] : []), ...row.grants.map((g) => g.botId)])];
}

/** Saves a credential from the Vault, for no agent or for the ones named. Returns its id. */
export async function storeVaultSecret(input: {
  prisma: PrismaClient;
  secretStore: SecretStore;
  person: Person;
  destination: BotSecretDestination;
  plaintext: string;
  visibility: "personal" | "space";
  botIds: string[];
}): Promise<string> {
  const { prisma, secretStore } = input;
  return withTransactionRetry(async () => {
    const prepared = await prepareBotSecret({
      prisma,
      secretStore,
      scope: { ...input.person, botId: null },
      destination: input.destination,
      plaintext: input.plaintext,
      createOnly: true,
      visibility: input.visibility,
      grantBotIds: input.botIds,
    });
    return persistPreparedSecret(prisma, secretStore, prepared, () =>
      prisma.$transaction(async (tx) => {
        await prepared.store(tx);
        return prepared.id;
      }),
    );
  });
}

/** Replaces the value on the same destination. The old value is deleted once nothing refers to it. */
export async function replaceVaultSecretValue(input: {
  prisma: PrismaClient;
  secretStore: SecretStore;
  row: Pick<VaultRow, "id" | "userId" | "spaceId" | "name" | "origin" | "auth">;
  plaintext: string;
}): Promise<void> {
  const { prisma, secretStore, row } = input;
  assertStorableSecretValue(normalizeSecretDestination(row), input.plaintext);
  const stored = await secretStore.put(
    input.plaintext,
    {
      operationId: row.id,
      traceId: row.id,
      userId: row.userId,
      spaceId: row.spaceId,
      signal: new AbortController().signal,
    },
    { recordId: row.id },
  );
  await persistPreparedSecret(
    prisma,
    secretStore,
    { id: row.id, ciphertext: stored.ciphertext },
    () =>
      prisma.botSecret.update({ where: { id: row.id }, data: { ciphertext: stored.ciphertext } }),
  );
}

/**
 * Makes `botIds` exactly the agents that may use the credential, as explicit grants. The agent it
 * was first saved for loses access too when it is not named. Refuses a command variable that would clash with
 * another one an agent can already use.
 */
export async function setVaultSecretAgents(
  prisma: PrismaClient,
  row: Pick<VaultRow, "id" | "userId" | "spaceId" | "name" | "auth" | "botId">,
  botIds: string[],
): Promise<void> {
  const wanted = [...new Set(botIds)];
  await prisma.$transaction(async (tx) => {
    const granted = await tx.botSecretGrant.findMany({
      where: { secretId: row.id },
      select: { botId: true },
    });
    const before = new Set(granted.map((grant) => grant.botId));
    if (row.botId) before.add(row.botId);
    for (const botId of wanted.filter((id) => !before.has(id))) {
      const clash = await commandVariableClash(
        tx,
        { spaceId: row.spaceId, botId, userId: row.userId },
        row,
      );
      if (clash) {
        throw new Error(
          `Invalid credential destination — name: ${clash} is already exported as $${commandVariableName(row.name)}`,
        );
      }
    }
    await tx.botSecretGrant.deleteMany({ where: { secretId: row.id, botId: { notIn: wanted } } });
    await tx.botSecretGrant.createMany({
      data: wanted.map((botId) => ({
        id: randomBytes(12).toString("hex"),
        secretId: row.id,
        botId,
        spaceId: row.spaceId,
      })),
      skipDuplicates: true,
    });
    // Every agent is an explicit grant now, so removing one agent never deletes a credential that
    // others use: only a credential bound to its first agent is deleted with that agent.
    if (row.botId) {
      await tx.botSecret.update({ where: { id: row.id }, data: { botId: null } });
    }
  });
}

/** Deletes the credential, its grants and its use log. */
export async function deleteVaultSecret(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.botSecret.deleteMany({ where: { id } });
}

/** Recent uses, newest first. */
export async function listVaultSecretUses(prisma: PrismaClient, id: string, limit = 25) {
  return await prisma.botSecretUse.findMany({
    where: { secretId: id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      botId: true,
      runId: true,
      forUserId: true,
      destination: true,
      outcome: true,
      createdAt: true,
    },
  });
}
