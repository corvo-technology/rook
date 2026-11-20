import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import {
  findToolClassifications,
  saveToolClassifications,
  toolClassificationKey,
} from "./tool-classification.js";

function client(rows: unknown[] = []) {
  const toolClassification = {
    findMany: vi.fn().mockResolvedValue(rows),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  return { prisma: { toolClassification } as unknown as PrismaClient, toolClassification };
}

const scope = { spaceId: "space", connection: "kind:demo", rubricVersion: "tool-risk-v1" };

describe("tool classifications", () => {
  it("reads only the tool and description pairs asked for, in this space and connection", async () => {
    const row = (toolName: string, descriptionHash: string) => ({
      toolName,
      descriptionHash,
      risk: "read",
      confidence: 0.9,
      model: "m",
    });
    const { prisma, toolClassification } = client([
      row("a", "h1"),
      // Same tool, other description: a changed description is not the one that was classified.
      row("a", "h2"),
      row("b", "h2"),
    ]);

    const found = await findToolClassifications(prisma, {
      ...scope,
      tools: [
        { toolName: "a", descriptionHash: "h1" },
        { toolName: "b", descriptionHash: "h2" },
      ],
    });

    expect([...found.keys()].sort()).toEqual(
      [toolClassificationKey("a", "h1"), toolClassificationKey("b", "h2")].sort(),
    );
    expect(toolClassification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ spaceId: "space", connection: "kind:demo" }),
      }),
    );
  });

  it("asks the database nothing for no tools", async () => {
    const { prisma, toolClassification } = client();
    await expect(findToolClassifications(prisma, { ...scope, tools: [] })).resolves.toEqual(
      new Map(),
    );
    expect(toolClassification.findMany).not.toHaveBeenCalled();
  });

  it("keeps suggestions without replacing one already kept", async () => {
    const { prisma, toolClassification } = client();
    await saveToolClassifications(prisma, {
      ...scope,
      rows: [{ toolName: "a", descriptionHash: "h1", risk: "low", confidence: 0.9, model: "m" }],
    });
    expect(toolClassification.createMany).toHaveBeenCalledWith({
      data: [
        {
          ...scope,
          toolName: "a",
          descriptionHash: "h1",
          risk: "low",
          confidence: 0.9,
          model: "m",
        },
      ],
      skipDuplicates: true,
    });
    await saveToolClassifications(prisma, { ...scope, rows: [] });
    expect(toolClassification.createMany).toHaveBeenCalledOnce();
  });
});
