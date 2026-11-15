import { randomBytes } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { LocalKeyProvider, masterKeysFromEnv } from "./content-keys.js";
import { runAsSystem, scopeToDbContext } from "./row-security.js";

/**
 * A user with two spaces in a real database, for the wiki's PostgreSQL tests. Content encryption
 * is on, as it is on a server install, so what the tests read has been through the ciphertext.
 */
export async function wikiTestFixture() {
  const suffix = `${process.pid}-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const ids = {
    userId: `wiki-user-${suffix}`,
    otherUserId: `wiki-other-${suffix}`,
    organizationId: `wiki-org-${suffix}`,
    spaceId: `wiki-space-${suffix}`,
    otherSpaceId: `wiki-space2-${suffix}`,
  };
  // Only the environment's keys: a key that exists for this suite alone would stay wrapped in
  // space_keys, and another suite that re-wraps every key in the shared database could not open it.
  const provider = new LocalKeyProvider(masterKeysFromEnv());
  const db = createDb(process.env.DATABASE_URL!, { keyProvider: provider, encryptContent: true });
  const prisma: PrismaClient = db.prisma;
  await runAsSystem("test fixture", async () => {
    for (const id of [ids.userId, ids.otherUserId])
      await prisma.user.create({
        data: { id, name: "Wiki", email: `${id}@corvo.test`, emailVerified: false },
      });
    await prisma.organization.create({
      data: {
        id: ids.organizationId,
        name: "Wiki",
        slug: ids.organizationId,
        createdAt: new Date(),
      },
    });
    for (const id of [ids.spaceId, ids.otherSpaceId])
      await prisma.space.create({
        data: { id, organizationId: ids.organizationId, name: "General" },
      });
  });
  return {
    ...ids,
    prisma,
    pool: db.pool,
    query: async <T>(text: string, values: unknown[] = []) =>
      (await scopeToDbContext(db.pool).query(text, values)).rows as T[],
    async close() {
      await runAsSystem("test fixture", async () => {
        await prisma.organization.deleteMany({ where: { id: ids.organizationId } });
        await prisma.user.deleteMany({ where: { id: { in: [ids.userId, ids.otherUserId] } } });
      });
      await prisma.$disconnect();
      await db.pool.end();
    },
  };
}
