import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { readHomeChecklist, readOnboardingAnswers, saveWorkAreas } from "./onboarding-profile.js";
import { asSystem, runAsSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe.sequential : describe.skip;

describePostgres("home checklist (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let provisioned = false;
  let userId: string;
  let spaceId: string;
  const address = `+1557${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    system = asSystem(prisma);
    close = async () => {
      try {
        await db.prisma.$disconnect();
      } finally {
        await db.pool.end();
      }
    };
    ({ userId, spaceId } = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    ));
    provisioned = true;
  });

  afterAll(async () => {
    try {
      if (prisma && provisioned) {
        await system.messagingIdentity.deleteMany({ where: { provider: "sendblue", address } });
        await system.organization.deleteMany({ where: { id: spaceId } });
        await system.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      await close?.();
    }
  });

  // The API hands the query its whole actor, not just the two ids.
  const actor = () => ({ spaceId, userId, email: "a@example.com", isDeploymentOwner: false });

  it("reads the checklist for a real actor without a Prisma validation error", async () => {
    const list = await runAsSystem("test read", () => readHomeChecklist(prisma, actor()));
    expect(list).not.toBeNull();
  });

  it("reads and saves onboarding data for a real actor", async () => {
    await runAsSystem("test write", () => saveWorkAreas(prisma, actor(), []));
    const answers = await runAsSystem("test read", () => readOnboardingAnswers(prisma, actor()));
    expect(answers.areas).toEqual([]);
  });
});
