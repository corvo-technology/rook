import type { SandboxProvider } from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import {
  createComputerResourceSampler,
  RESOURCE_SAMPLE_INTERVAL_MS,
  sampleTickAt,
} from "./computer-resources.js";

const computers = [
  {
    id: "c1",
    spaceId: "s1",
    userId: "u1",
    kind: "fake",
    providerRef: "p1",
    homeKey: "h1",
    runningSince: new Date("2026-03-01T10:00:00Z"),
    space: { organizationId: "o1" },
  },
  {
    id: "c2",
    spaceId: "s2",
    userId: "u2",
    kind: "fake",
    providerRef: "p2",
    homeKey: "h2",
    runningSince: null,
    space: { organizationId: "o2" },
  },
];

function setup(sandbox: Partial<SandboxProvider>) {
  const findMany = vi.fn(async () => computers);
  const createMany = vi.fn(async () => ({ count: 0 }));
  const prisma = {
    computer: { findMany },
    computerResourceSample: { createMany },
  } as unknown as PrismaClient;
  return { findMany, createMany, prisma, sandbox: sandbox as SandboxProvider };
}

describe("computer resource sampler", () => {
  it("rounds a tick down to its five-minute boundary", () => {
    const at = sampleTickAt(new Date("2026-03-01T10:07:31Z"));
    expect(at.toISOString()).toBe("2026-03-01T10:05:00.000Z");
    expect(RESOURCE_SAMPLE_INTERVAL_MS).toBe(300_000);
  });

  it("reads running computers in one query and stores every sample in one insert", async () => {
    const sampleResources = vi.fn(async (ref: { id: string }) => ({
      cpuSeconds: 1.5,
      memoryBytes: 100,
      diskBytes: 200,
      networkRxBytes: ref.id === "p1" ? 5 : 6,
      networkTxBytes: 7,
    }));
    const { prisma, sandbox, findMany, createMany } = setup({ sampleResources });
    const sample = createComputerResourceSampler({ prisma, sandbox });

    await sample(new Date("2026-03-01T10:07:31Z"));

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        {
          computerId: "c1",
          spaceId: "s1",
          organizationId: "o1",
          userId: "u1",
          runStartedAt: computers[0]!.runningSince,
          sampledAt: new Date("2026-03-01T10:05:00Z"),
          reason: "tick",
          cpuSeconds: 1.5,
          memoryBytes: 100n,
          diskBytes: 200n,
          networkRxBytes: 5n,
          networkTxBytes: 7n,
        },
        expect.objectContaining({ computerId: "c2", organizationId: "o2", networkRxBytes: 6n }),
      ],
    });
  });

  it("samples once per five-minute tick", async () => {
    const { prisma, sandbox, findMany } = setup({
      sampleResources: async () => ({ cpuSeconds: 1 }),
    });
    const sample = createComputerResourceSampler({ prisma, sandbox });
    await sample(new Date("2026-03-01T10:05:10Z"));
    await sample(new Date("2026-03-01T10:08:00Z"));
    expect(findMany).toHaveBeenCalledTimes(1);
    await sample(new Date("2026-03-01T10:10:01Z"));
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("records nothing, and asks for nothing, when the provider cannot measure", async () => {
    const { prisma, sandbox, findMany, createMany } = setup({});
    await createComputerResourceSampler({ prisma, sandbox })(new Date());
    expect(findMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("skips a computer whose measurement fails or is empty and keeps the others", async () => {
    const sampleResources = vi.fn(async (ref: { id: string }) => {
      if (ref.id === "p1") throw new Error("stats unavailable");
      return undefined;
    });
    const { prisma, sandbox, createMany } = setup({ sampleResources });
    await createComputerResourceSampler({ prisma, sandbox })(new Date());
    expect(sampleResources).toHaveBeenCalledTimes(2);
    expect(createMany).not.toHaveBeenCalled();
  });
});
