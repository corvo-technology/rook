import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";
import {
  findToolClassifications,
  saveToolClassifications,
  toolClassificationKey,
} from "./tool-classification.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

dbTests("tool classification cache", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `classify-user-${suffix}`;
  const organizationId = `classify-org-${suffix}`;
  const spaceId = `classify-space-${suffix}`;
  const otherSpaceId = `classify-other-${suffix}`;
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  const scope = { spaceId, connection: "kind:demo", rubricVersion: "tool-risk-v1" };

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = asSystem(db.prisma, "tool classification test");
    await prisma.user.create({
      data: { id: userId, name: "x", email: `${userId}@corvo.test`, emailVerified: false },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Classify", slug: organizationId, createdAt: new Date() },
    });
    for (const id of [spaceId, otherSpaceId]) {
      await prisma.space.create({
        data: { id, organizationId, name: id, createdByUserId: userId },
      });
    }
  });

  afterAll(async () => {
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  const row = (toolName: string, descriptionHash: string, risk = "read") => ({
    toolName,
    descriptionHash,
    risk,
    confidence: 0.9,
    model: "test/model",
  });

  it("keeps a suggestion per space, connection, tool, description and rubric", async () => {
    await saveToolClassifications(prisma, { ...scope, rows: [row("inbox_overview", "h1")] });
    const found = (overrides = {}, hash = "h1") =>
      findToolClassifications(prisma, {
        ...scope,
        ...overrides,
        tools: [{ toolName: "inbox_overview", descriptionHash: hash }],
      });
    expect((await found()).get(toolClassificationKey("inbox_overview", "h1"))?.risk).toBe("read");
    expect((await found({}, "h2")).size).toBe(0);
    expect((await found({ connection: "kind:other" })).size).toBe(0);
    expect((await found({ rubricVersion: "tool-risk-v2" })).size).toBe(0);
    expect((await found({ spaceId: otherSpaceId })).size).toBe(0);
  });

  it("leaves a kept suggestion as it was when saved again", async () => {
    await saveToolClassifications(prisma, { ...scope, rows: [row("note_pin", "h1", "low")] });
    await saveToolClassifications(prisma, { ...scope, rows: [row("note_pin", "h1", "high")] });
    const found = await findToolClassifications(prisma, {
      ...scope,
      tools: [{ toolName: "note_pin", descriptionHash: "h1" }],
    });
    expect(found.get(toolClassificationKey("note_pin", "h1"))?.risk).toBe("low");
  });

  it("is removed with its space", async () => {
    await prisma.space.delete({ where: { id: otherSpaceId } });
    await saveToolClassifications(prisma, {
      spaceId,
      connection: "kind:demo",
      rubricVersion: "tool-risk-v1",
      rows: [row("x", "h")],
    });
    await prisma.space.delete({ where: { id: spaceId } });
    expect(await prisma.toolClassification.count({ where: { spaceId } })).toBe(0);
  });
});
