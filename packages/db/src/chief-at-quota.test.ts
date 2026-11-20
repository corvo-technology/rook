import type { Actor } from "@corvo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { ComputerLimitError } from "./computers.js";
import { createRepos } from "./repos.js";

const actor: Actor = {
  spaceId: "space-2",
  userId: "user-1",
  email: "fake@example.test",
  isDeploymentOwner: false,
};
const input = {
  name: "Chief",
  title: "",
  description: "",
  instructions: "",
  notifyOnFinish: true,
};

// A second space whose person already has one live computer, with the cap at one.
function atCap() {
  const created: Array<Record<string, unknown>> = [];
  const upsert = vi.fn();
  const tx = {
    $queryRaw: vi.fn(async () => [{ lock: "1" }]),
    spaceMember: {
      findUnique: vi.fn(async () => ({ organizationId: "org-1", space: { deletingAt: null } })),
    },
    bot: {
      aggregate: vi.fn(async () => ({ _max: { position: null } })),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
      findFirstOrThrow: vi.fn(async () => ({
        id: "bot-1",
        spaceId: actor.spaceId,
        userId: actor.userId,
        name: "Chief",
        createdAt: new Date(),
        updatedAt: new Date(),
        thread: { id: "thread-1", botId: "bot-1", createdAt: new Date(), updatedAt: new Date() },
        computer: null,
      })),
    },
    computer: {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => 1),
      upsert,
    },
    thread: { create: vi.fn(async () => ({ id: "thread-1" })) },
    browserProfile: { create: vi.fn(async () => ({})) },
    memoryDocument: { create: vi.fn(async () => ({})) },
  };
  const prisma = {
    deploymentSettings: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaClient;
  return { prisma, created, upsert };
}

describe("a second space on a one-computer plan", () => {
  afterEach(() => {
    delete process.env.SANDBOX_MAX_COMPUTERS_PER_USER;
  });

  it("refuses an ordinary agent but still makes the space's Chief, without a computer", async () => {
    process.env.SANDBOX_MAX_COMPUTERS_PER_USER = "1";
    const refused = atCap();
    await expect(createRepos(refused.prisma).createBot(actor, input)).rejects.toBeInstanceOf(
      ComputerLimitError,
    );

    const chief = atCap();
    await createRepos(chief.prisma).createBot(actor, { ...input, allowWithoutComputer: true });
    expect(chief.created[0]).toMatchObject({ computerId: null, spaceId: "space-2" });
    // No computer row is made or borrowed from the other space.
    expect(chief.upsert).not.toHaveBeenCalled();
  });
});
