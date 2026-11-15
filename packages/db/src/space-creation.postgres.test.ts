import { afterAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { runAsSystem } from "./row-security.js";
import {
  createSpaceForMember,
  SpaceCreationNotAllowedError,
  setMembersCanCreateSpaces,
} from "./spaces.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("who may create a space (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const orgId = `creation-org-${suffix}`;
  const spaceId = `creation-space-${suffix}`;
  const users = {
    owner: `creation-owner-${suffix}`,
    admin: `creation-admin-${suffix}`,
    member: `creation-member-${suffix}`,
  };
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  afterAll(async () => {
    if (!prisma) return;
    await runAsSystem("clean up", async () => {
      await prisma.organization.deleteMany({ where: { id: orgId } });
      await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    });
    await close();
  });

  it("is off by default, owner-only to change, and enforced when creating", async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const createdAt = new Date();
    await runAsSystem("fixture", async () => {
      for (const [name, id] of Object.entries(users)) {
        await prisma.user.create({
          data: { id, name, email: `${id}@corvo.test`, emailVerified: false },
        });
      }
      await prisma.organization.create({
        data: { id: orgId, name: "Team", slug: orgId, createdAt },
      });
      await prisma.space.create({
        data: { id: spaceId, organizationId: orgId, name: "General", isDefault: true },
      });
      for (const [name, id] of Object.entries(users)) {
        await prisma.member.create({
          data: {
            id: `m-${id}`,
            organizationId: orgId,
            userId: id,
            role: name,
            createdAt,
          },
        });
      }
    });
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(organization.membersCanCreateSpaces).toBe(false);

    const create = (userId: string) =>
      runAsSystem("create", () =>
        createSpaceForMember(prisma, { currentSpaceId: spaceId, userId, name: "New" }),
      );
    await expect(create(users.owner)).resolves.toMatchObject({ name: "New" });
    for (const id of [users.member, users.admin]) {
      await expect(create(id)).rejects.toBeInstanceOf(SpaceCreationNotAllowedError);
    }
    await expect(
      runAsSystem("set", () =>
        setMembersCanCreateSpaces(prisma, { spaceId, userId: users.member, allowed: true }),
      ),
    ).rejects.toThrow("Not allowed");
    await runAsSystem("set", () =>
      setMembersCanCreateSpaces(prisma, { spaceId, userId: users.owner, allowed: true }),
    );
    for (const id of [users.member, users.admin]) {
      await expect(create(id)).resolves.toMatchObject({ name: "New" });
    }
  });
});
