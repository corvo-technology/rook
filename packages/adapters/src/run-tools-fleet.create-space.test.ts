import { SpaceCreationNotAllowedError } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";

const { createSpaceForMember } = vi.hoisted(() => ({ createSpaceForMember: vi.fn() }));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  createSpaceForMember,
  runAsSystem: (_reason: string, run: () => unknown) => run(),
}));

const { fleetTools } = await import("./run-tools-fleet.js");

describe("the create_space tool", () => {
  it("relays the refusal when the owner has not allowed members to create spaces", async () => {
    createSpaceForMember.mockRejectedValueOnce(new SpaceCreationNotAllowedError());
    const finish = vi.fn((result: unknown) => result);
    await fleetTools.create_space?.(
      { deps: { prisma: {} }, run: { spaceId: "s", userId: "u" } } as never,
      { args: { name: "Team" }, finish } as never,
    );
    expect(finish).toHaveBeenCalledWith({
      error: "Members cannot create spaces here. Ask the owner to allow it.",
    });
  });

  it("creates the space when it is allowed", async () => {
    createSpaceForMember.mockResolvedValueOnce({ id: "new", name: "Team" });
    const finish = vi.fn((result: unknown) => result);
    await fleetTools.create_space?.(
      { deps: { prisma: {} }, run: { spaceId: "s", userId: "u" } } as never,
      { args: { name: "Team" }, finish } as never,
    );
    expect(finish).toHaveBeenCalledWith({ ok: true, spaceId: "new", name: "Team" });
  });
});
