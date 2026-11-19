import type { Actor, MessageBlock } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";

vi.mock("./thread-target.js", () => ({
  resolveThreadTarget: vi.fn(async () => ({ kind: "bot", botId: "bot-1", threadId: "t-1" })),
}));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  runAsSystem: async (_why: string, fn: () => unknown) => fn(),
  appendEventInTransaction: vi.fn(async () => ({ seq: 9 })),
}));

import { isPartnerCustomer, resolveHostAction } from "./host-actions.js";

const actor = { userId: "u-1", spaceId: "s-1" } as Actor;
const card = (status: "pending" | "done"): MessageBlock => ({
  kind: "host_action",
  actionId: "a1",
  name: "book",
  label: "Reservar",
  params: {},
  status,
});

function setup(blocks: MessageBlock[]) {
  const update = vi.fn(async () => ({}));
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    message: {
      findFirst: vi.fn(async () => ({ id: "m-1", blocks })),
      update,
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    partnerTenant: { findFirst: vi.fn(async () => ({ id: "pt-1" })) },
  } as unknown as PrismaClient;
  const events = { notify: vi.fn(async () => undefined) };
  return { prisma, events, update };
}

const input = {
  botId: "bot-1",
  messageId: "m-1",
  actionId: "a1",
  actionName: "book",
  outcome: "done" as const,
};

describe("resolveHostAction", () => {
  it("records the decision on a pending card and tells the thread", async () => {
    const { prisma, events, update } = setup([card("pending")]);
    await resolveHostAction({ prisma, events: events as never }, actor, input);
    expect(update).toHaveBeenCalledWith({
      where: { id: "m-1" },
      data: { blocks: [expect.objectContaining({ kind: "host_action", status: "done" })] },
    });
    expect(events.notify).toHaveBeenCalledWith("t-1", 9);
  });

  it("does nothing for a card that was already decided, or another action's id", async () => {
    const decided = setup([card("done")]);
    await resolveHostAction(
      { prisma: decided.prisma, events: decided.events as never },
      actor,
      input,
    );
    expect(decided.update).not.toHaveBeenCalled();
    const other = setup([card("pending")]);
    await resolveHostAction({ prisma: other.prisma, events: other.events as never }, actor, {
      ...input,
      actionId: "zzz",
    });
    expect(other.update).not.toHaveBeenCalled();
    expect(other.events.notify).not.toHaveBeenCalled();
  });
});

describe("isPartnerCustomer", () => {
  it("is true only for an owner a partner provisioned", async () => {
    const { prisma } = setup([]);
    expect(await isPartnerCustomer(prisma, actor)).toBe(true);
    (prisma.partnerTenant.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await isPartnerCustomer(prisma, actor)).toBe(false);
  });
});
