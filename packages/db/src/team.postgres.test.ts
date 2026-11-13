import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";
import {
  acceptInvitation,
  acceptInvitationsForUser,
  answerJoinRequest,
  cancelInvitation,
  createInvitations,
  createInviteLink,
  disableInviteLink,
  hasPendingInvitation,
  listInvitations,
  listJoinRequests,
  listSpaceMembers,
  previewInvitation,
  removeMember,
  requestToJoin,
  resendInvitation,
  setMemberRole,
  TeamError,
} from "./team.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("teams: invitations and members (PostgreSQL)", () => {
  const suffix = randomUUID().slice(0, 8);
  const email = (name: string) => `${name}-${suffix}@example.test`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  const users: Record<string, string> = {};
  let spaceId = "";
  let otherSpaceId = "";
  let organizationId = "";

  async function user(name: string, verified = true) {
    const id = `${name}-${suffix}`;
    await prisma.user.create({
      data: { id, name, email: email(name), emailVerified: verified },
    });
    users[name] = id;
    return { id, email: email(name), emailVerified: verified };
  }

  async function invite(address: string, role: "owner" | "admin" | "member" = "member") {
    const { invitations } = await createInvitations(prisma, {
      spaceId,
      actorId: users.owner!,
      role,
      addresses: [address],
    });
    return invitations[0]!;
  }

  const code = async (run: Promise<unknown>) =>
    run.then(
      () => "ok",
      (error: unknown) => (error instanceof TeamError ? error.code : "error"),
    );

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = asSystem(db.prisma, "team test");
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    await user("owner");
    await user("outsider");
    const env = { signupsEnabled: "true", signupAllowlist: "" };
    // The owner's personal organization has a default space; the team space is a second one.
    const personal = await bootstrapUserSpace(prisma, { id: users.owner! }, env);
    organizationId = personal.spaceId;
    spaceId = randomUUID();
    await prisma.space.create({ data: { id: spaceId, organizationId, name: "Team" } });
    await prisma.spaceMember.create({
      data: {
        id: randomUUID(),
        spaceId,
        organizationId,
        userId: users.owner!,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const outsider = await bootstrapUserSpace(prisma, { id: users.outsider! }, env);
    otherSpaceId = outsider.spaceId;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { endsWith: `-${suffix}` } } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId] } } });
    await close();
  });

  it("invites an address, lets only that confirmed address accept, and joins with the role", async () => {
    const row = await invite(email("ana"), "admin");
    await expect(previewInvitation(prisma, row.id)).resolves.toMatchObject({
      spaceName: "Team",
      email: email("ana"),
    });
    const ana = await user("ana");
    const wrong = await user("wrong");
    await expect(acceptInvitation(prisma, { id: row.id, user: wrong })).resolves.toBeNull();
    const unconfirmed = { ...ana, emailVerified: false };
    await expect(acceptInvitation(prisma, { id: row.id, user: unconfirmed })).resolves.toBeNull();
    await expect(
      acceptInvitation(prisma, { id: row.id, user: unconfirmed, trustUnverified: true }),
    ).resolves.toMatchObject({ spaceId });
    const members = await listSpaceMembers(prisma, spaceId);
    expect(members.find((member) => member.userId === ana.id)?.role).toBe("admin");
    await expect(previewInvitation(prisma, row.id)).resolves.toBeNull();
    const accepted = await listInvitations(prisma, { spaceId, actorId: users.owner! });
    expect(accepted.find((item) => item.id === row.id)).toMatchObject({
      status: "accepted",
      acceptedByName: "ana",
    });
  });

  it("opens only the invited space, not the organization's default space", async () => {
    const bruno = await user("bruno");
    const row = await invite(email("bruno"));
    await acceptInvitation(prisma, { id: row.id, user: bruno });
    const spaces = await prisma.spaceMember.findMany({ where: { userId: bruno.id } });
    expect(spaces.map((space) => space.spaceId)).toEqual([spaceId]);
    await expect(prisma.member.count({ where: { userId: bruno.id } })).resolves.toBe(1);
  });

  it("keeps one invitation per address and the same link when sent again", async () => {
    const first = await invite(email("dup"));
    const again = await invite(email("dup").toUpperCase());
    expect(again.id).toBe(first.id);
    const resent = await resendInvitation(prisma, { spaceId, actorId: users.owner!, id: first.id });
    expect(resent.id).toBe(first.id);
    await cancelInvitation(prisma, { spaceId, actorId: users.owner!, id: first.id });
    await expect(previewInvitation(prisma, first.id)).resolves.toBeNull();
  });

  it("refuses an expired invitation", async () => {
    const row = await invite(email("late"));
    const late = await user("late");
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await expect(
      acceptInvitation(prisma, { id: row.id, user: late, now: later }),
    ).resolves.toBeNull();
    await expect(hasPendingInvitation(prisma, email("late"), later)).resolves.toBe(false);
    await expect(hasPendingInvitation(prisma, email("late"))).resolves.toBe(true);
  });

  it("joins the invited space at sign-in instead of provisioning a personal one", async () => {
    await invite(email("newbie"));
    const newbie = await user("newbie");
    const joined = await acceptInvitationsForUser(prisma, newbie);
    expect(joined).toEqual([{ spaceId, organizationId }]);
    const memberships = await prisma.spaceMember.findMany({ where: { userId: newbie.id } });
    expect(memberships.map((membership) => membership.spaceId)).toEqual([spaceId]);
    await expect(
      acceptInvitationsForUser(prisma, { ...(await user("nobody")), emailVerified: true }),
    ).resolves.toEqual([]);
  });

  it("lets the link only ask; an admin approves, and a denial is never shown", async () => {
    const link = await createInviteLink(prisma, { spaceId, actorId: users.owner! });
    expect(await createInviteLink(prisma, { spaceId, actorId: users.owner! })).toEqual(link);
    const carla = await user("carla");
    const dora = await user("dora");
    await expect(requestToJoin(prisma, { linkId: link.id, userId: carla.id })).resolves.toBe(
      "requested",
    );
    await requestToJoin(prisma, { linkId: link.id, userId: dora.id });
    expect(await prisma.spaceMember.count({ where: { spaceId, userId: carla.id } })).toBe(0);
    const pending = await listJoinRequests(prisma, { spaceId, actorId: users.owner! });
    const carlaRequest = pending.find((request) => request.email === carla.email)!;
    await answerJoinRequest(prisma, {
      spaceId,
      actorId: users.owner!,
      id: carlaRequest.id,
      approve: true,
    });
    expect((await listSpaceMembers(prisma, spaceId)).find((m) => m.userId === carla.id)?.role).toBe(
      "member",
    );
    const doraRequest = pending.find((request) => request.email === dora.email)!;
    await answerJoinRequest(prisma, {
      spaceId,
      actorId: users.owner!,
      id: doraRequest.id,
      approve: false,
      reason: "not on the team",
    });
    await expect(requestToJoin(prisma, { linkId: link.id, userId: dora.id })).resolves.toBe(
      "requested",
    );
    expect(await prisma.spaceMember.count({ where: { spaceId, userId: dora.id } })).toBe(0);
    await expect(requestToJoin(prisma, { linkId: link.id, userId: carla.id })).resolves.toBe(
      "member",
    );
    await disableInviteLink(prisma, { spaceId, actorId: users.owner! });
    const eve = await user("eve");
    await expect(requestToJoin(prisma, { linkId: link.id, userId: eve.id })).resolves.toBe(
      "requested",
    );
    expect(await prisma.spaceJoinRequest.count({ where: { userId: eve.id } })).toBe(0);
  });

  it("protects owners: admins cannot touch them, and the last owner stays", async () => {
    const admin = users.ana!;
    await expect(
      code(
        setMemberRole(prisma, { spaceId, actorId: admin, userId: users.owner!, role: "member" }),
      ),
    ).resolves.toBe("forbidden");
    await expect(
      code(removeMember(prisma, { spaceId, actorId: admin, userId: users.owner! })),
    ).resolves.toBe("forbidden");
    await expect(
      code(setMemberRole(prisma, { spaceId, actorId: admin, userId: users.bruno!, role: "owner" })),
    ).resolves.toBe("forbidden");
    await expect(
      code(
        setMemberRole(prisma, {
          spaceId,
          actorId: users.owner!,
          userId: users.owner!,
          role: "admin",
        }),
      ),
    ).resolves.toBe("last_owner");
    await expect(
      code(removeMember(prisma, { spaceId, actorId: users.owner!, userId: users.owner! })),
    ).resolves.toBe("last_owner");
    await setMemberRole(prisma, {
      spaceId,
      actorId: users.owner!,
      userId: users.ana!,
      role: "owner",
    });
    await setMemberRole(prisma, {
      spaceId,
      actorId: users.ana!,
      userId: users.owner!,
      role: "admin",
    });
    await setMemberRole(prisma, {
      spaceId,
      actorId: users.ana!,
      userId: users.owner!,
      role: "owner",
    });
  });

  it("keeps plain members from managing anyone", async () => {
    const member = users.bruno!;
    await expect(
      code(
        createInvitations(prisma, {
          spaceId,
          actorId: member,
          role: "member",
          addresses: [email("x")],
        }),
      ),
    ).resolves.toBe("forbidden");
    await expect(
      code(removeMember(prisma, { spaceId, actorId: member, userId: users.carla! })),
    ).resolves.toBe("forbidden");
    await expect(code(createInviteLink(prisma, { spaceId, actorId: member }))).resolves.toBe(
      "forbidden",
    );
    await expect(code(listJoinRequests(prisma, { spaceId, actorId: member }))).resolves.toBe(
      "forbidden",
    );
  });

  it("does not let a member of one space act in another", async () => {
    const outsider = users.outsider!;
    await expect(
      code(removeMember(prisma, { spaceId, actorId: outsider, userId: users.bruno! })),
    ).resolves.toBe("forbidden");
    await expect(
      code(
        createInvitations(prisma, {
          spaceId,
          actorId: outsider,
          role: "member",
          addresses: [email("y")],
        }),
      ),
    ).resolves.toBe("forbidden");
    await expect(
      code(
        removeMember(prisma, { spaceId: otherSpaceId, actorId: users.owner!, userId: outsider }),
      ),
    ).resolves.toBe("forbidden");
    expect(
      await prisma.spaceMember.count({ where: { spaceId: otherSpaceId, userId: outsider } }),
    ).toBe(1);
  });

  it("ends access when a member is removed and frees their seat", async () => {
    const before = await prisma.member.count({ where: { organizationId } });
    await removeMember(prisma, { spaceId, actorId: users.owner!, userId: users.bruno! });
    expect(await prisma.spaceMember.count({ where: { spaceId, userId: users.bruno! } })).toBe(0);
    expect(await prisma.member.count({ where: { organizationId } })).toBe(before - 1);
    await removeMember(prisma, { spaceId, actorId: users.carla!, userId: users.carla! });
    expect(await prisma.spaceMember.count({ where: { spaceId, userId: users.carla! } })).toBe(0);
  });

  it("limits how many invitations a space sends in a day", async () => {
    const addresses = Array.from({ length: 101 }, (_, index) => email(`bulk${index}`));
    await expect(
      code(
        createInvitations(prisma, { spaceId, actorId: users.owner!, role: "member", addresses }),
      ),
    ).resolves.toBe("limit");
  });
});
