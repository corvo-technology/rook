import { describe, expect, it } from "vitest";
import {
  IsolationError,
  memberSpaceIds,
  requireSpaceMember,
  scoped,
  sharedWhere,
} from "./scope.js";

const actor = {
  userId: "user-b",
  spaceId: "space-1",
  email: "b@example.test",
  isDeploymentOwner: false,
};

describe("scoped", () => {
  it("keeps personal rows to their owner", () => {
    expect(scoped(actor, { spaceId: "space-1", userId: "user-b" })).toBeTruthy();
    expect(() => scoped(actor, { spaceId: "space-1", userId: "user-a" })).toThrow(IsolationError);
  });

  it("lets every member of the space reach shared rows, and no other space's", () => {
    const row = { spaceId: "space-1", userId: "user-a" };
    expect(scoped(actor, row, { shared: true })).toBe(row);
    expect(() => scoped(actor, { spaceId: "space-2", userId: "user-a" }, { shared: true })).toThrow(
      IsolationError,
    );
    expect(() => scoped(actor, null, { shared: true })).toThrow(IsolationError);
  });
});

describe("sharedWhere", () => {
  it("names the space and never the person", () => {
    expect(sharedWhere(actor)).toEqual({ spaceId: "space-1" });
  });
});

describe("membership", () => {
  const members = new Set(["space-1:user-b", "space-3:user-b"]);
  const prisma = {
    spaceMember: {
      findUnique: async ({
        where: {
          spaceId_userId: { spaceId, userId },
        },
      }: {
        where: { spaceId_userId: { spaceId: string; userId: string } };
      }) => (members.has(`${spaceId}:${userId}`) ? { role: "member" } : null),
      findMany: async ({
        where: { userId, spaceId },
      }: {
        where: { userId: string; spaceId: { in: string[] } };
      }) =>
        spaceId.in.filter((id) => members.has(`${id}:${userId}`)).map((id) => ({ spaceId: id })),
    },
  } as never;

  it("requires the actor to belong to the space it acts in", async () => {
    await expect(requireSpaceMember(prisma, actor)).resolves.toEqual({ role: "member" });
    await expect(requireSpaceMember(prisma, { ...actor, spaceId: "space-2" })).rejects.toThrow(
      IsolationError,
    );
  });

  it("narrows a list of spaces to the member's own", async () => {
    await expect(
      memberSpaceIds(prisma, "user-b", ["space-1", "space-2", "space-3"]),
    ).resolves.toEqual(["space-1", "space-3"]);
    await expect(memberSpaceIds(prisma, "user-b", [])).resolves.toEqual([]);
  });
});
