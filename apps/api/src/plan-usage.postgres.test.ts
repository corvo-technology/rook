import { randomUUID } from "node:crypto";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { asSystem, createDb, provisionMessagingIdentity, runAsSystem } from "@corvo/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { planUsage } from "./plan-usage.js";

const url = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && url ? describe.sequential : describe.skip;

describePostgres("plan usage (PostgreSQL)", () => {
  const address = `plan-usage-${randomUUID()}@corvo.test`;
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  let actor: Actor;

  beforeAll(async () => {
    db = createDb(url!);
    system = asSystem(db.prisma, "plan usage fixture");
    const owner = await runAsSystem("plan usage fixture", () =>
      provisionMessagingIdentity(
        db.prisma,
        { provider: "email", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    actor = { ...owner, email: address, isDeploymentOwner: false };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (actor) {
      await system.messagingIdentity.deleteMany({ where: { address } });
      await system.organization.deleteMany({ where: { id: actor.spaceId } });
      await system.user.deleteMany({ where: { id: actor.userId } });
    }
    if (db) {
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });

  it("shows nothing where the deployment has no plans", async () => {
    expect(await planUsage(system, actor)).toBeNull();
  });

  it("reports the personal plan's limits and the organization's use", async () => {
    vi.stubEnv("PLAN_PRICES", "{}");
    await system.storageUsage.upsert({
      where: { organizationId: actor.spaceId },
      create: { organizationId: actor.spaceId, bytes: 5n * 1024n ** 3n },
      update: { bytes: 5n * 1024n ** 3n },
    });
    const usage = await planUsage(system, actor);
    expect(usage).toMatchObject({
      plan: "personal",
      computerSize: "small",
      storage: { usedBytes: 5 * 1024 ** 3, limitBytes: 20 * 1024 ** 3 },
      computers: { limit: 1 },
      seats: { used: 1, included: 1, max: 1, extraPrice: null },
      canManage: true,
    });
    expect(usage?.plans.map((plan) => plan.plan)).toEqual(["personal", "team", "company"]);
  });
});
