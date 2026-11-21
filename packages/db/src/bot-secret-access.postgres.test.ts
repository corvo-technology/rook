import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantSavedBotSecret, usableBotSecrets, visibleBotSecrets } from "./bot-secret-access.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { asSystem, runAsSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe.sequential : describe.skip;

describePostgres("credential access (PostgreSQL)", () => {
  let system: PrismaClient;
  let close: () => Promise<void>;
  const stamp = Math.floor(Math.random() * 9_000_000 + 1_000_000);
  const addresses = [`+1557${stamp}`, `+1558${stamp}`];
  let owner: { userId: string; spaceId: string; botId: string };
  let member: { userId: string; spaceId: string; botId: string };
  const ids = (name: string) => `vault-pg-${stamp}-${name}`;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    system = asSystem(db.prisma);
    close = async () => {
      try {
        await db.prisma.$disconnect();
      } finally {
        await db.pool.end();
      }
    };
    const options = { signupsEnabled: undefined, signupAllowlist: undefined };
    [owner, member] = await runAsSystem("test fixture", async () => [
      await provisionMessagingIdentity(
        db.prisma,
        { provider: "sendblue", address: addresses[0]! },
        options,
      ),
      await provisionMessagingIdentity(
        db.prisma,
        { provider: "sendblue", address: addresses[1]! },
        options,
      ),
    ]);
    const base = { ciphertext: "c", origin: "", auth: { type: "command" } };
    // Saved for the owner's agent, personal: the default of every new credential.
    await system.botSecret.create({
      data: {
        ...base,
        id: ids("personal"),
        userId: owner.userId,
        spaceId: owner.spaceId,
        botId: owner.botId,
        name: "personal-key",
        scope: "personal",
      },
    });
    // Added from the Vault: no agent of its own, shared with the member's agent by a grant.
    await system.botSecret.create({
      data: {
        ...base,
        id: ids("team"),
        userId: owner.userId,
        spaceId: owner.spaceId,
        botId: null,
        name: "team-key",
        scope: "space",
      },
    });
    await system.botSecretGrant.create({
      data: {
        id: ids("team-grant"),
        secretId: ids("team"),
        botId: owner.botId,
        spaceId: owner.spaceId,
      },
    });
  });

  afterAll(async () => {
    try {
      if (system) {
        await system.botSecret.deleteMany({ where: { id: { startsWith: `vault-pg-${stamp}` } } });
        for (const who of [owner, member]) {
          if (!who) continue;
          await system.messagingIdentity.deleteMany({ where: { userId: who.userId } });
          await system.organization.deleteMany({ where: { id: who.spaceId } });
          await system.user.deleteMany({ where: { id: who.userId } });
        }
      }
    } finally {
      await close?.();
    }
  });

  const names = async (run: { spaceId: string; botId: string; userId: string }) =>
    (
      await system.botSecret.findMany({
        where: { ...usableBotSecrets(run), id: { startsWith: `vault-pg-${stamp}` } },
        select: { name: true },
        orderBy: { name: "asc" },
      })
    ).map((row) => row.name);

  it("lets a personal credential be used only by runs for its owner", async () => {
    const run = { spaceId: owner.spaceId, botId: owner.botId };
    expect(await names({ ...run, userId: owner.userId })).toEqual(["personal-key", "team-key"]);
    expect(await names({ ...run, userId: member.userId })).toEqual(["team-key"]);
  });

  it("lets a space credential be used only by the agents granted it", async () => {
    // The member's agent was never granted it, whoever runs it.
    expect(
      await names({ spaceId: owner.spaceId, botId: member.botId, userId: owner.userId }),
    ).toEqual([]);
    expect(
      await names({ spaceId: owner.spaceId, botId: owner.botId, userId: member.userId }),
    ).toEqual(["team-key"]);
  });

  it("never shows another space's credentials", async () => {
    expect(
      await names({ spaceId: member.spaceId, botId: owner.botId, userId: owner.userId }),
    ).toEqual([]);
    const seen = await system.botSecret.findMany({
      where: { ...visibleBotSecrets({ spaceId: member.spaceId, userId: member.userId }) },
      select: { id: true },
    });
    expect(seen.filter((row) => row.id.startsWith(`vault-pg-${stamp}`))).toEqual([]);
  });

  it("never gives out a team credential from a chat card", async () => {
    const run = { spaceId: owner.spaceId, botId: member.botId, userId: owner.userId };
    await expect(
      system.$transaction((tx) =>
        grantSavedBotSecret(tx, run, { name: "team-key", origin: "", auth: { type: "command" } }),
      ),
    ).rejects.toThrow();
    expect(await system.botSecretGrant.count({ where: { botId: member.botId } })).toBe(0);
  });

  it("grants an agent the saved credential with the same destination, and nothing else", async () => {
    const run = { spaceId: owner.spaceId, botId: member.botId, userId: owner.userId };
    await expect(
      system.$transaction((tx) =>
        grantSavedBotSecret(tx, run, {
          name: "personal-key",
          origin: "https://other.example.test",
          auth: { type: "bearer" },
        }),
      ),
    ).rejects.toThrow();
    await system.$transaction((tx) =>
      grantSavedBotSecret(tx, run, { name: "personal-key", origin: "", auth: { type: "command" } }),
    );
    expect(await names(run)).toContain("personal-key");
    // Granting it again changes nothing.
    await system.$transaction((tx) =>
      grantSavedBotSecret(tx, run, { name: "personal-key", origin: "", auth: { type: "command" } }),
    );
    expect(
      await system.botSecretGrant.count({
        where: { secretId: ids("personal"), botId: member.botId },
      }),
    ).toBe(1);
  });
});
