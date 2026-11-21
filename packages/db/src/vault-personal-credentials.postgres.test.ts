import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { usableBotSecrets } from "./bot-secret-access.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { asSystem, runAsSystem } from "./row-security.js";

const sql = readFileSync(
  new URL(
    "../prisma/migrations/20261224200000_vault_personal_credentials/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe.sequential : describe.skip;

describePostgres("vault personal credentials migration (PostgreSQL)", () => {
  let system: PrismaClient;
  let close: () => Promise<void>;
  const stamp = Math.floor(Math.random() * 9_000_000 + 1_000_000);
  const addresses = [`+1559${stamp}`, `+1560${stamp}`];
  let owner: { userId: string; spaceId: string; botId: string };
  let member: { userId: string; spaceId: string; botId: string };
  const id = (name: string) => `vault-mig-${stamp}-${name}`;

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
    const base = {
      ciphertext: "c",
      origin: "",
      auth: { type: "command" },
      spaceId: owner.spaceId,
      scope: "space",
    };
    const before = new Date("2020-01-01T00:00:00Z");
    const rows = [
      // A member saved it from a chat card on the owner's agent, before the Vault.
      { id: id("member-card"), userId: member.userId, botId: owner.botId, createdAt: before },
      // Saved under the agent owner: agent settings, or the owner's own card. Shared by design.
      { id: id("owner"), userId: owner.userId, botId: owner.botId, createdAt: before },
      // Same as the member's card, but created after the Vault shipped, as a team credential.
      { id: id("after"), userId: member.userId, botId: owner.botId, createdAt: new Date() },
      // Added from the Vault: no agent of its own.
      { id: id("vault"), userId: member.userId, botId: null, createdAt: before },
    ];
    for (const row of rows)
      await system.botSecret.create({ data: { ...base, ...row, name: row.id.split("-").pop()! } });
    await system.$executeRawUnsafe(sql);
  });

  afterAll(async () => {
    try {
      if (system) {
        await system.botSecret.deleteMany({ where: { id: { startsWith: `vault-mig-${stamp}` } } });
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

  const scopeOf = async (name: string) =>
    (await system.botSecret.findUniqueOrThrow({ where: { id: id(name) } })).scope;

  it("makes a credential a member saved themselves before the Vault personal", async () => {
    expect(await scopeOf("member-card")).toBe("personal");
  });

  it("leaves credentials saved under the agent owner, later ones and Vault ones as they were", async () => {
    expect(await scopeOf("owner")).toBe("space");
    expect(await scopeOf("after")).toBe("space");
    expect(await scopeOf("vault")).toBe("space");
  });

  it("keeps the personal credential on its agent, usable only by its owner's runs", async () => {
    const names = async (userId: string) =>
      (
        await system.botSecret.findMany({
          where: {
            ...usableBotSecrets({ spaceId: owner.spaceId, botId: owner.botId, userId }),
            id: { startsWith: `vault-mig-${stamp}` },
          },
          select: { id: true },
        })
      ).map((row) => row.id);
    expect(await names(member.userId)).toContain(id("member-card"));
    expect(await names(owner.userId)).not.toContain(id("member-card"));
  });

  it("only changes data, so the previous release keeps working beside it", () => {
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\b(insert|delete|drop|rename|alter|create)\b/i);
  });
});
