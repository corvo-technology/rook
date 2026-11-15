import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";
import { requireMembership } from "./scope.js";
import { getSpaceMembershipFor } from "./space-membership.js";
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
      state: "pending",
      spaceName: "Team",
      email: email("ana"),
      role: "admin",
      hasAccount: false,
    });
    const ana = await user("ana");
    const wrong = await user("wrong");
    await expect(acceptInvitation(prisma, { id: row.id, user: wrong })).resolves.toBeNull();
    const unconfirmed = { ...ana, emailVerified: false };
    // Someone who signed up with this address without proving the mailbox cannot take the seat.
    await expect(acceptInvitation(prisma, { id: row.id, user: unconfirmed })).resolves.toBe(
      "unverified",
    );
    expect(await prisma.spaceMember.count({ where: { spaceId, userId: ana.id } })).toBe(0);
    await expect(
      acceptInvitation(prisma, { id: row.id, user: unconfirmed, trustUnverified: true }),
    ).resolves.toMatchObject({ spaceId });
    const members = await listSpaceMembers(prisma, spaceId);
    expect(members.find((member) => member.userId === ana.id)?.role).toBe("admin");
    await expect(previewInvitation(prisma, row.id)).resolves.toEqual({ state: "accepted" });
    // A member now: the waiting list no longer carries the invitation.
    const waiting = await listInvitations(prisma, { spaceId, actorId: users.owner! });
    expect(waiting.find((item) => item.id === row.id)).toBeUndefined();
    // Accepting twice, even by the same account, does nothing more.
    await expect(acceptInvitation(prisma, { id: row.id, user: ana })).resolves.toBeNull();
  });

  it("accepts an unconfirmed account only with the emailed link's proof", async () => {
    const row = await invite(email("proof"));
    const proof = await user("proof", false);
    await expect(
      acceptInvitation(prisma, { id: row.id, user: proof, mailProof: true }),
    ).resolves.toMatchObject({ spaceId });
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
    // Cancelled reads like an invitation that never existed.
    await expect(previewInvitation(prisma, first.id)).resolves.toBeNull();
    const dupCancelled = await user("dupcancelled");
    await expect(
      acceptInvitation(prisma, { id: first.id, user: dupCancelled }),
    ).resolves.toBeNull();
  });

  it("merges a second invitation into the first, keeping the higher role and every role", async () => {
    const roleA = randomUUID();
    const roleB = randomUUID();
    for (const [id, position] of [
      [roleA, 5],
      [roleB, 6],
    ] as const)
      await prisma.spaceRole.create({
        data: { id, spaceId, name: `R-${id.slice(0, 4)}`, position, keys: [] },
      });
    const send = async (role: "admin" | "member", roleIds: string[]) =>
      (
        await createInvitations(prisma, {
          spaceId,
          actorId: users.owner!,
          role,
          roleIds,
          addresses: [email("merge")],
        })
      ).invitations[0]!;
    const first = await send("admin", [roleA]);
    const second = await send("member", [roleB]);
    expect(second.id).toBe(first.id);
    expect(second.role).toBe("admin");
    expect([...second.roleIds].sort()).toEqual([roleA, roleB].sort());
    expect(await prisma.spaceInvitation.count({ where: { spaceId, email: email("merge") } })).toBe(
      1,
    );
  });

  it("says what became of an invitation that no longer works", async () => {
    const row = await invite(email("gone"));
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await expect(previewInvitation(prisma, row.id, later)).resolves.toEqual({
      state: "expired",
      inviterName: "owner",
    });
    await cancelInvitation(prisma, { spaceId, actorId: users.owner!, id: row.id });
    await expect(previewInvitation(prisma, row.id, later)).resolves.toBeNull();
    await expect(previewInvitation(prisma, "no-such-invitation")).resolves.toBeNull();
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

  it("does not join an unconfirmed address at sign-in, however it got the account", async () => {
    await invite(email("squat"));
    const squatter = await user("squat", false);
    await expect(acceptInvitationsForUser(prisma, squatter)).resolves.toEqual([]);
    expect(await prisma.spaceMember.count({ where: { userId: squatter.id } })).toBe(0);
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

  it("stops a link that expired, and gives a new link in its place", async () => {
    const link = await createInviteLink(prisma, { spaceId, actorId: users.owner! });
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const late = await user("latelink");
    await expect(
      requestToJoin(prisma, { linkId: link.id, userId: late.id, now: later }),
    ).resolves.toBe("requested");
    expect(await prisma.spaceJoinRequest.count({ where: { userId: late.id } })).toBe(0);
    const renewed = await createInviteLink(prisma, { spaceId, actorId: users.owner!, now: later });
    expect(renewed.id).not.toBe(link.id);
    await disableInviteLink(prisma, { spaceId, actorId: users.owner! });
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
    await expect(
      getSpaceMembershipFor(prisma, { spaceId, userId: users.bruno! }),
    ).resolves.not.toBeNull();
    await removeMember(prisma, { spaceId, actorId: users.owner!, userId: users.bruno! });
    expect(await prisma.spaceMember.count({ where: { spaceId, userId: users.bruno! } })).toBe(0);
    // Every read and stream resolves the membership live, so nothing is left to use.
    await expect(
      getSpaceMembershipFor(prisma, { spaceId, userId: users.bruno! }),
    ).resolves.toBeNull();
    await expect(requireMembership(prisma, users.bruno!, spaceId)).rejects.toThrow();
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
