import { randomUUID } from "node:crypto";
import { can } from "@corvo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";
import { getSpaceMembershipFor } from "./space-membership.js";
import {
  createSpaceRole,
  deleteSpaceRole,
  listSpaceRoles,
  reorderSpaceRoles,
  setMemberRoles,
  updateSpaceRole,
} from "./space-roles.js";
import {
  acceptInvitation,
  createInvitations,
  listSpaceMembers,
  removeMember,
  setMemberRole,
  TeamError,
} from "./team.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("roles that add up (PostgreSQL)", () => {
  const suffix = randomUUID().slice(0, 8);
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  const users: Record<string, string> = {};
  let spaceId = "";
  let organizationId = "";

  async function member(name: string, role: "owner" | "admin" | "member") {
    const id = `${name}-${suffix}`;
    await prisma.user.create({
      data: { id, name, email: `${name}-${suffix}@example.test`, emailVerified: true },
    });
    users[name] = id;
    if (name !== "owner")
      await prisma.member.create({
        data: {
          id: randomUUID(),
          organizationId,
          userId: id,
          role: "member",
          createdAt: new Date(),
        },
      });
    await prisma.spaceMember.deleteMany({
      where: { userId: id, spaceId: { not: spaceId }, organizationId },
    });
    await prisma.spaceMember.create({
      data: { id: randomUUID(), spaceId, organizationId, userId: id, role, createdAt: new Date() },
    });
    return id;
  }

  const code = (run: Promise<unknown>) =>
    run.then(
      () => "ok",
      (error: unknown) => (error instanceof TeamError ? error.code : "error"),
    );
  const standing = (name: string) =>
    getSpaceMembershipFor(prisma, { spaceId, userId: users[name]! });
  const roleId = async (name: string) =>
    (await listSpaceRoles(prisma, spaceId)).find((role) => role.name === name)!.id;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = asSystem(db.prisma, "roles test");
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const owner = `owner-${suffix}`;
    await prisma.user.create({
      data: {
        id: owner,
        name: "owner",
        email: `owner-${suffix}@example.test`,
        emailVerified: true,
      },
    });
    users.owner = owner;
    const personal = await bootstrapUserSpace(
      prisma,
      { id: owner },
      { signupsEnabled: "true", signupAllowlist: "" },
    );
    organizationId = personal.spaceId;
    spaceId = randomUUID();
    await prisma.space.create({ data: { id: spaceId, organizationId, name: "Team" } });
    await prisma.spaceMember.create({
      data: {
        id: randomUUID(),
        spaceId,
        organizationId,
        userId: owner,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await member("admin", "admin");
    await member("plain", "member");
    await member("lead", "member");
    await member("junior", "member");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { endsWith: `-${suffix}` } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId] } } });
    await close();
  });

  it("reads the three old roles as before, before any role row exists", async () => {
    const owner = await standing("owner");
    const admin = await standing("admin");
    const plain = await standing("plain");
    expect(owner?.isOwner).toBe(true);
    expect(can(owner, "manage_billing")).toBe(true);
    for (const key of ["invite_people", "manage_members", "manage_agents", "configure"] as const) {
      expect(can(admin, key)).toBe(true);
      expect(can(plain, key)).toBe(false);
    }
    expect(can(admin, "manage_billing")).toBe(false);
    expect(can(plain, "post")).toBe(true);
    expect(await getSpaceMembershipFor(prisma, { spaceId, userId: "nobody" })).toBeNull();
  });

  it("adds up the keys of the roles a person holds, on top of Everyone", async () => {
    const ops = await createSpaceRole(prisma, {
      spaceId,
      actorId: users.owner!,
      name: "Ops",
      keys: ["view_usage", "approve_actions"],
    });
    await setMemberRoles(prisma, {
      spaceId,
      actorId: users.owner!,
      userId: users.plain!,
      roleIds: [ops],
    });
    const plain = await standing("plain");
    expect(can(plain, "view_usage")).toBe(true);
    expect(can(plain, "approve_actions")).toBe(true);
    expect(can(plain, "post")).toBe(true);
    expect(can(plain, "manage_members")).toBe(false);
    const listed = await listSpaceMembers(prisma, spaceId);
    expect(listed.find((row) => row.userId === users.plain)?.roleIds).toEqual([ops]);
    expect(listed.find((row) => row.userId === users.plain)?.role).toBe("member");
  });

  it("keeps Admin as the legacy admins' role and keeps space_members.role in step", async () => {
    const admin = await roleId("Admin");
    const holders = await prisma.spaceMemberRole.findMany({ where: { roleId: admin } });
    expect(holders.map((row) => row.userId)).toEqual([users.admin]);
    await setMemberRoles(prisma, {
      spaceId,
      actorId: users.owner!,
      userId: users.junior!,
      roleIds: [admin],
    });
    expect(
      (await prisma.spaceMember.findFirstOrThrow({ where: { userId: users.junior } })).role,
    ).toBe("admin");
    await setMemberRoles(prisma, {
      spaceId,
      actorId: users.owner!,
      userId: users.junior!,
      roleIds: [],
    });
    expect(
      (await prisma.spaceMember.findFirstOrThrow({ where: { userId: users.junior } })).role,
    ).toBe("member");
    expect(can(await standing("junior"), "manage_members")).toBe(false);
  });

  it("never lets Everyone administer, and keeps both default roles", async () => {
    const everyone = await roleId("Everyone");
    expect(
      await code(
        updateSpaceRole(prisma, {
          spaceId,
          actorId: users.owner!,
          id: everyone,
          keys: ["administrator"],
        }),
      ),
    ).toBe("invalid");
    expect(
      await code(deleteSpaceRole(prisma, { spaceId, actorId: users.owner!, id: everyone })),
    ).toBe("invalid");
    expect(
      await code(
        deleteSpaceRole(prisma, { spaceId, actorId: users.owner!, id: await roleId("Admin") }),
      ),
    ).toBe("invalid");
  });

  it("changes, gives and removes only roles below one's own, and only keys one holds", async () => {
    const lead = await createSpaceRole(prisma, {
      spaceId,
      actorId: users.owner!,
      name: "Lead",
      keys: ["manage_roles", "manage_members", "invite_people", "view_usage"],
    });
    const trainee = await createSpaceRole(prisma, {
      spaceId,
      actorId: users.owner!,
      name: "Trainee",
      keys: ["view_usage"],
    });
    await setMemberRoles(prisma, {
      spaceId,
      actorId: users.owner!,
      userId: users.lead!,
      roleIds: [lead],
    });
    const actorId = users.lead!;
    const admin = await roleId("Admin");
    // Not the Admin role above, nor their own.
    expect(await code(updateSpaceRole(prisma, { spaceId, actorId, id: admin, keys: [] }))).toBe(
      "forbidden",
    );
    expect(await code(updateSpaceRole(prisma, { spaceId, actorId, id: lead, keys: [] }))).toBe(
      "forbidden",
    );
    expect(await code(deleteSpaceRole(prisma, { spaceId, actorId, id: lead }))).toBe("forbidden");
    // A role below them, with keys they hold.
    expect(
      await code(
        updateSpaceRole(prisma, {
          spaceId,
          actorId,
          id: trainee,
          keys: ["view_usage", "invite_people"],
        }),
      ),
    ).toBe("ok");
    // Keys they do not hold.
    expect(
      await code(updateSpaceRole(prisma, { spaceId, actorId, id: trainee, keys: ["configure"] })),
    ).toBe("forbidden");
    expect(
      await code(
        createSpaceRole(prisma, { spaceId, actorId, name: "Big", keys: ["manage_billing"] }),
      ),
    ).toBe("forbidden");
    // Giving roles: below, yes; the one above, no.
    expect(
      await code(
        setMemberRoles(prisma, { spaceId, actorId, userId: users.junior!, roleIds: [trainee] }),
      ),
    ).toBe("ok");
    expect(
      await code(
        setMemberRoles(prisma, { spaceId, actorId, userId: users.junior!, roleIds: [admin] }),
      ),
    ).toBe("forbidden");
    // People at or above them stay out of reach.
    expect(
      await code(setMemberRoles(prisma, { spaceId, actorId, userId: users.admin!, roleIds: [] })),
    ).toBe("forbidden");
    expect(
      await code(setMemberRoles(prisma, { spaceId, actorId, userId: users.owner!, roleIds: [] })),
    ).toBe("forbidden");
    expect(await code(removeMember(prisma, { spaceId, actorId, userId: users.admin! }))).toBe(
      "forbidden",
    );
    // Reordering leaves the roles at or above them where they are.
    const all = (await listSpaceRoles(prisma, spaceId)).filter(
      (role) => role.systemKey !== "everyone",
    );
    const ids = all.map((role) => role.id);
    const swapped = [...ids];
    const a = swapped.indexOf(lead);
    const b = swapped.indexOf(trainee);
    [swapped[a], swapped[b]] = [swapped[b]!, swapped[a]!];
    expect(await code(reorderSpaceRoles(prisma, { spaceId, actorId, ids: swapped }))).toBe(
      "forbidden",
    );
    expect(
      await code(reorderSpaceRoles(prisma, { spaceId, actorId: users.owner!, ids: swapped })),
    ).toBe("ok");
    expect(
      (await listSpaceRoles(prisma, spaceId)).find((role) => role.id === trainee)?.position,
    ).toBeLessThan(
      (await listSpaceRoles(prisma, spaceId)).find((role) => role.id === lead)!.position,
    );
  });

  it("carries roles on an invitation, checked against the sender, and applies them on accepting", async () => {
    const ops = await roleId("Ops");
    const admin = await roleId("Admin");
    const sent = await createInvitations(prisma, {
      spaceId,
      actorId: users.owner!,
      role: "member",
      roleIds: [ops],
      addresses: [`new-${suffix}@example.test`],
    });
    expect(sent.invitations[0]?.roleIds).toEqual([ops]);
    // Lead may invite but not give Admin, in either way of asking.
    const attempts = [
      createInvitations(prisma, {
        spaceId,
        actorId: users.lead!,
        role: "member",
        roleIds: [admin],
        addresses: [`x1-${suffix}@example.test`],
      }),
      createInvitations(prisma, {
        spaceId,
        actorId: users.lead!,
        role: "admin",
        addresses: [`x2-${suffix}@example.test`],
      }),
      createInvitations(prisma, {
        spaceId,
        actorId: users.plain!,
        role: "member",
        addresses: [`x3-${suffix}@example.test`],
      }),
    ];
    for (const attempt of attempts) expect(await code(attempt)).toBe("forbidden");
    const user = `new-${suffix}`;
    await prisma.user.create({
      data: { id: user, name: "new", email: `new-${suffix}@example.test`, emailVerified: true },
    });
    await acceptInvitation(prisma, {
      id: sent.invitations[0]!.id,
      user: { id: user, email: `new-${suffix}@example.test`, emailVerified: true },
    });
    const joined = await getSpaceMembershipFor(prisma, { spaceId, userId: user });
    expect(joined?.roleIds).toEqual([ops]);
    expect(can(joined, "view_usage")).toBe(true);
  });

  it("skips a role deleted between sending and accepting", async () => {
    const temp = await createSpaceRole(prisma, {
      spaceId,
      actorId: users.owner!,
      name: "Temp",
      keys: ["view_usage"],
    });
    const sent = await createInvitations(prisma, {
      spaceId,
      actorId: users.owner!,
      role: "member",
      roleIds: [temp],
      addresses: [`late-${suffix}@example.test`],
    });
    await deleteSpaceRole(prisma, { spaceId, actorId: users.owner!, id: temp });
    const user = `late-${suffix}`;
    await prisma.user.create({
      data: { id: user, name: "late", email: `late-${suffix}@example.test`, emailVerified: true },
    });
    await acceptInvitation(prisma, {
      id: sent.invitations[0]!.id,
      user: { id: user, email: `late-${suffix}@example.test`, emailVerified: true },
    });
    expect((await getSpaceMembershipFor(prisma, { spaceId, userId: user }))?.roleIds).toEqual([]);
  });

  it("keeps the old admin rules: admins promote and demote, never touch owners", async () => {
    const actorId = users.admin!;
    expect(
      await code(setMemberRole(prisma, { spaceId, actorId, userId: users.junior!, role: "admin" })),
    ).toBe("ok");
    expect(can(await standing("junior"), "manage_members")).toBe(true);
    expect(
      await code(
        setMemberRole(prisma, { spaceId, actorId, userId: users.junior!, role: "member" }),
      ),
    ).toBe("ok");
    expect(
      await code(setMemberRole(prisma, { spaceId, actorId, userId: users.owner!, role: "member" })),
    ).toBe("forbidden");
    expect(
      await code(setMemberRole(prisma, { spaceId, actorId, userId: users.junior!, role: "owner" })),
    ).toBe("forbidden");
    expect(await code(removeMember(prisma, { spaceId, actorId, userId: users.owner! }))).toBe(
      "forbidden",
    );
    // A custom manager cannot hand out Admin through the old way either.
    expect(
      await code(
        setMemberRole(prisma, {
          spaceId,
          actorId: users.lead!,
          userId: users.junior!,
          role: "admin",
        }),
      ),
    ).toBe("forbidden");
    // A plain member can do none of it.
    expect(
      await code(
        setMemberRole(prisma, {
          spaceId,
          actorId: users.junior!,
          userId: users.plain!,
          role: "admin",
        }),
      ),
    ).toBe("forbidden");
  });
});
