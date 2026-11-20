import type { PrismaClient } from "./client.js";

type ClassificationClient = Pick<PrismaClient, "toolClassification">;

export type StoredToolClassification = {
  toolName: string;
  descriptionHash: string;
  /** read, low, high, or unknown when the model was not sure. */
  risk: string;
  confidence: number;
  model: string;
};

export function toolClassificationKey(toolName: string, descriptionHash: string): string {
  return `${toolName}\u0000${descriptionHash}`;
}

/** The suggestions kept for one connection under one rubric, keyed by tool and description. */
export async function findToolClassifications(
  prisma: ClassificationClient,
  input: {
    spaceId: string;
    connection: string;
    rubricVersion: string;
    tools: ReadonlyArray<{ toolName: string; descriptionHash: string }>;
  },
): Promise<Map<string, StoredToolClassification>> {
  if (input.tools.length === 0) return new Map();
  const rows = await prisma.toolClassification.findMany({
    where: {
      spaceId: input.spaceId,
      connection: input.connection,
      rubricVersion: input.rubricVersion,
      toolName: { in: input.tools.map((tool) => tool.toolName) },
      descriptionHash: { in: input.tools.map((tool) => tool.descriptionHash) },
    },
    select: { toolName: true, descriptionHash: true, risk: true, confidence: true, model: true },
  });
  const wanted = new Set(
    input.tools.map((tool) => toolClassificationKey(tool.toolName, tool.descriptionHash)),
  );
  return new Map(
    rows
      .filter((row) => wanted.has(toolClassificationKey(row.toolName, row.descriptionHash)))
      .map((row) => [toolClassificationKey(row.toolName, row.descriptionHash), row]),
  );
}

/** Keeps suggestions; one already kept for the same tool and description is left as it was. */
export async function saveToolClassifications(
  prisma: ClassificationClient,
  input: {
    spaceId: string;
    connection: string;
    rubricVersion: string;
    rows: readonly StoredToolClassification[];
  },
): Promise<void> {
  if (input.rows.length === 0) return;
  await prisma.toolClassification.createMany({
    data: input.rows.map((row) => ({
      spaceId: input.spaceId,
      connection: input.connection,
      rubricVersion: input.rubricVersion,
      ...row,
    })),
    skipDuplicates: true,
  });
}
