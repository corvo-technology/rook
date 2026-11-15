import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import {
  createSpaceForMember,
  mayCreateSpace,
  SpaceCreationNotAllowedError,
  setMembersCanCreateSpaces,
  spaceCreationPolicy,
} from "./spaces.js";

type Role = "owner" | "admin" | "member";

/** Organizations and who holds which role in them, held in memory. */
function fakeDb(options: { switchOn?: boolean; roles: Record<string, Record<string, Role>> }) {
  const organization = { id: "org-1", membersCanCreateSpaces: options.switchOn === true };
  const created: string[] = [];
  const members = (userId: string) =>
    Object.entries(options.roles)
      .filter(([, users]) => users[userId])
      .map(([organizationId, users]) => ({ organizationId, role: users[userId] }));
  const db = {
    spaceMember: {
      findUnique: async ({ where }: { where: { spaceId_userId: { userId: string } } }) =>
        members(where.spaceId_userId.userId)[0]
          ? { organizationId: members(where.spaceId_userId.userId)[0]?.organizationId }
          : null,
      count: async () => 0,
      create: async () => ({}),
    },
    member: {
      findMany: async ({ where }: { where: { userId: string } }) => members(where.userId),
      findUnique: async ({
        where,
      }: {
        where: { organizationId_userId: { organizationId: string; userId: string } };
      }) => {
        const key = where.organizationId_userId;
        const role = options.roles[key.organizationId]?.[key.userId];
        return role ? { role } : null;
      },
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === organization.id ? organization : { membersCanCreateSpaces: false },
      update: async ({ data }: { data: { membersCanCreateSpaces: boolean } }) => {
        organization.membersCanCreateSpaces = data.membersCanCreateSpaces;
      },
    },
    space: {
      create: async ({ data }: { data: { organizationId: string } }) => {
        created.push(data.organizationId);
      },
      findUnique: async () => ({ organizationId: "org-1", organization }),
    },
    memoryDocument: { create: async () => ({}) },
    notificationPreference: { create: async () => ({}) },
    $transaction: async (run: (tx: unknown) => unknown) => run(db),
  };
  return { prisma: db as unknown as PrismaClient, created, organization };
}

const create = (prisma: PrismaClient, userId: string) =>
  createSpaceForMember(prisma, { currentSpaceId: "space-1", userId, name: "Team" });

describe("who may create a space", () => {
  const roles = { "org-1": { owner: "owner", admin: "admin", member: "member" } } as const;

  it("always lets the organization owner", async () => {
    const { prisma, created } = fakeDb({ roles });
    await create(prisma, "owner");
    expect(created).toEqual(["org-1"]);
  });

  it("refuses a member and an admin while the switch is off", async () => {
    const { prisma, created } = fakeDb({ roles });
    await expect(create(prisma, "member")).rejects.toBeInstanceOf(SpaceCreationNotAllowedError);
    await expect(create(prisma, "admin")).rejects.toBeInstanceOf(SpaceCreationNotAllowedError);
    expect(created).toEqual([]);
  });

  it("allows a member and an admin once the owner turns it on", async () => {
    const { prisma, created } = fakeDb({ roles, switchOn: true });
    await create(prisma, "member");
    await create(prisma, "admin");
    expect(created).toEqual(["org-1", "org-1"]);
  });

  it("keeps a person with an organization of their own creating there", async () => {
    const { prisma, created } = fakeDb({
      roles: { "org-1": { guest: "member" }, "org-own": { guest: "owner" } },
    });
    await create(prisma, "guest");
    expect(created).toEqual(["org-own"]);
  });

  it("answers the same question for every caller", async () => {
    const { prisma } = fakeDb({ roles });
    expect(await mayCreateSpace(prisma, "owner", "org-1")).toBe(true);
    expect(await mayCreateSpace(prisma, "member", "org-1")).toBe(false);
  });

  it("tells each person what they may do and who holds the switch", async () => {
    const { prisma } = fakeDb({ roles });
    const input = (userId: string) => ({ spaceId: "space-1", userId });
    expect(await spaceCreationPolicy(prisma, input("owner"))).toEqual({
      canCreateSpace: true,
      membersCanCreateSpaces: false,
    });
    expect(await spaceCreationPolicy(prisma, input("member"))).toEqual({
      canCreateSpace: false,
      membersCanCreateSpaces: null,
    });
  });
});

describe("the owner's switch", () => {
  const roles = { "org-1": { owner: "owner", admin: "admin", member: "member" } } as const;

  it("is set by the owner", async () => {
    const { prisma, organization } = fakeDb({ roles });
    await setMembersCanCreateSpaces(prisma, { spaceId: "space-1", userId: "owner", allowed: true });
    expect(organization.membersCanCreateSpaces).toBe(true);
  });

  it("cannot be set by an admin or a member", async () => {
    const { prisma, organization } = fakeDb({ roles });
    for (const userId of ["admin", "member"]) {
      await expect(
        setMembersCanCreateSpaces(prisma, { spaceId: "space-1", userId, allowed: true }),
      ).rejects.toThrow("Not allowed");
    }
    expect(organization.membersCanCreateSpaces).toBe(false);
  });
});

describe("the members-can-create-spaces migration", () => {
  const sql = readFileSync(
    new URL(
      "../prisma/migrations/20261123000000_members_can_create_spaces/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  it("adds one column that defaults to off and drops nothing", () => {
    expect(sql).toMatch(/ADD COLUMN "membersCanCreateSpaces" BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).not.toMatch(/\b(drop|rename|update|delete)\b/i);
  });
});
