import type { AdapterContext, SandboxProvider } from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { toComputerRef } from "./computer-support.js";

export const RESOURCE_SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const SAMPLE_TIMEOUT_MS = 10_000;
const SAMPLE_CONCURRENCY = 8;

/** The five-minute boundary a periodic sample is stored under, so two writers store one. */
export function sampleTickAt(now: Date): Date {
  return new Date(
    Math.floor(now.getTime() / RESOURCE_SAMPLE_INTERVAL_MS) * RESOURCE_SAMPLE_INTERVAL_MS,
  );
}

interface SampledComputer {
  id: string;
  spaceId: string;
  userId: string;
  kind: string;
  providerRef: string | null;
  homeKey: string;
  runningSince: Date | null;
}

type Deps = {
  prisma: Pick<PrismaClient, "computer" | "computerResourceSample">;
  sandbox: SandboxProvider;
};

async function measure(sandbox: SandboxProvider, computer: SampledComputer, signal?: AbortSignal) {
  if (!sandbox.sampleResources || !computer.providerRef) return undefined;
  const context: AdapterContext = {
    operationId: "computer.sample",
    traceId: "computer.sample",
    spaceId: computer.spaceId,
    userId: computer.userId,
    signal: AbortSignal.any([AbortSignal.timeout(SAMPLE_TIMEOUT_MS), ...(signal ? [signal] : [])]),
  };
  try {
    return await sandbox.sampleResources(toComputerRef(computer), context);
  } catch (error) {
    // A sample missed is a gap in the evidence, never a failure of the computer.
    getLogger().warn("computer.sample_failed", { "computer.id": computer.id, error });
    return undefined;
  }
}

function row(
  computer: SampledComputer,
  organizationId: string | null,
  sampledAt: Date,
  reason: "tick" | "stop",
  sample: NonNullable<Awaited<ReturnType<typeof measure>>>,
) {
  const bytes = (value: number | undefined) =>
    value === undefined ? null : BigInt(Math.max(0, Math.round(value)));
  return {
    computerId: computer.id,
    spaceId: computer.spaceId,
    organizationId,
    userId: computer.userId,
    runStartedAt: computer.runningSince,
    sampledAt,
    reason,
    cpuSeconds: sample.cpuSeconds ?? null,
    memoryBytes: bytes(sample.memoryBytes),
    diskBytes: bytes(sample.diskBytes),
    networkRxBytes: bytes(sample.networkRxBytes),
    networkTxBytes: bytes(sample.networkTxBytes),
  };
}

/**
 * Every five minutes, measures each running computer and stores the samples: one query for the
 * computers, one provider call each (a few at a time), one batched insert. Called on the
 * reconciler's tick and acts at most once per five-minute boundary. A provider that cannot
 * measure is not asked.
 */
export function createComputerResourceSampler(deps: Deps): (now?: Date) => Promise<void> {
  let lastTick: number | undefined;
  return async (now = new Date()) => {
    if (!deps.sandbox.sampleResources) return;
    const tick = sampleTickAt(now);
    if (lastTick === tick.getTime()) return;
    lastTick = tick.getTime();
    const computers = await deps.prisma.computer.findMany({
      where: { state: "running", providerRef: { not: null }, kind: { not: "desktop" } },
      select: {
        id: true,
        spaceId: true,
        userId: true,
        kind: true,
        providerRef: true,
        homeKey: true,
        runningSince: true,
        space: { select: { organizationId: true } },
      },
    });
    const rows: ReturnType<typeof row>[] = [];
    for (let i = 0; i < computers.length; i += SAMPLE_CONCURRENCY) {
      const batch = computers.slice(i, i + SAMPLE_CONCURRENCY);
      const samples = await Promise.all(batch.map((computer) => measure(deps.sandbox, computer)));
      batch.forEach((computer, index) => {
        const sample = samples[index];
        if (sample) rows.push(row(computer, computer.space.organizationId, tick, "tick", sample));
      });
    }
    if (rows.length)
      await deps.prisma.computerResourceSample.createMany({ data: rows, skipDuplicates: true });
  };
}

/**
 * The last sample of a stretch, taken just before the computer stops. Never fails the stop.
 */
export async function recordStopSample(
  deps: Deps & { prisma: Pick<PrismaClient, "space"> },
  computer: SampledComputer,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const sample = await measure(deps.sandbox, computer, signal);
    if (!sample) return;
    const space = await deps.prisma.space.findUnique({
      where: { id: computer.spaceId },
      select: { organizationId: true },
    });
    await deps.prisma.computerResourceSample.createMany({
      data: [row(computer, space?.organizationId ?? null, new Date(), "stop", sample)],
      skipDuplicates: true,
    });
  } catch (error) {
    getLogger().warn("computer.sample_failed", { "computer.id": computer.id, error });
  }
}
