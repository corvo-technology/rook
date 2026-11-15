import { randomUUID } from "node:crypto";
import { UNREAD_COUNT_CAP } from "@corvo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { markDirectRead, markDirectUnreadFor, openDirectThread } from "./direct-threads.js";
import { createThreadMessage } from "./messages.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  raiseNotification,
} from "./notifications.js";
import { asSystem, runAsTenant } from "./row-security.js";
import { memberUnreadCounts } from "./thread-reads.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("the notifications inbox and unread counts (PostgreSQL)", () => {
  const suffix = randomUUID().slice(0, 8);
  let raw: PrismaClient;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  const users: Record<string, string> = {};
  let organizationId = "";
  let spaceId = "";
  let otherSpaceId = "";
  let channelThreadId = "";
  let groupId = "";

  async function person(key: string, name: string, space: string) {
    const id = `${key}-${suffix}`;
    users[key] = id;
    await prisma.user.create({
      data: { id, name, email: `${key}-${suffix}@example.test`, emailVerified: true },
    });
    if (key !== "olivia") {
      await prisma.member.create({
        data: {
          id: randomUUID(),
          organizationId,
          userId: id,
          role: "member",
          createdAt: new Date(),
        },
      });
    }
    await prisma.spaceMember.deleteMany({ where: { userId: id, organizationId } });
    await prisma.spaceMember.create({
      data: {
        id: randomUUID(),
        spaceId: space,
        organizationId,
        userId: id,
        role: key === "olivia" ? "owner" : "member",
        createdAt: new Date(),
      },
    });
  }

  const say = (
    threadId: string,
    authorUserId: string,
    text: string,
    options: { threadRootId?: string; markUnread?: boolean } = {},
  ) =>
    createThreadMessage(prisma, {
      threadId,
      role: "user",
      blocks: [{ kind: "text", text }],
      authorUserId,
      markUnread: options.markUnread ?? true,
      threadRootId: options.threadRootId,
    });
  const inbox = (key: string) =>
    runAsTenant({ spaceId, userId: users[key]! }, () =>
      listNotifications(raw, { spaceId, userId: users[key]! }),
    );

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    raw = db.prisma;
    prisma = asSystem(db.prisma, "notifications test");
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const owner = `olivia-${suffix}`;
    await prisma.user.create({
      data: {
        id: owner,
        name: "Olivia",
        email: `olivia-${suffix}@example.test`,
        emailVerified: true,
      },
    });
    const personal = await bootstrapUserSpace(
      prisma,
      { id: owner },
      { signupsEnabled: "true", signupAllowlist: "" },
    );
    organizationId = personal.spaceId;
    spaceId = randomUUID();
    otherSpaceId = randomUUID();
    await prisma.space.create({ data: { id: spaceId, organizationId, name: "Team" } });
    await prisma.space.create({ data: { id: otherSpaceId, organizationId, name: "Elsewhere" } });
    await person("olivia", "Olivia", spaceId);
    await person("beatrice", "Beatrice Gold", spaceId);
    await person("cyrus", "Cyrus", spaceId);
    await person("dana", "Dana", otherSpaceId);
    const group = await prisma.chatGroup.create({
      data: { spaceId, userId: users.olivia!, name: "general" },
    });
    groupId = group.id;
    const thread = await prisma.thread.create({
      data: { spaceId, userId: users.olivia!, groupId },
    });
    channelThreadId = thread.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { endsWith: `-${suffix}` } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await close();
  });

  it("raises a DM entry for the other person only, and refreshes one entry per conversation", async () => {
    const threadId = await openDirectThread(prisma, {
      spaceId,
      userId: users.olivia!,
      withUserId: users.beatrice!,
    });
    for (const text of ["hi", "are you there?"]) {
      // Direct messages mark the other person alone, as the route does.
      const message = await say(threadId, users.olivia!, text, { markUnread: false });
      await markDirectUnreadFor(prisma, {
        threadId,
        spaceId,
        userId: users.beatrice!,
        seq: message.seq,
      });
    }
    const theirs = await inbox("beatrice");
    expect(theirs.items.filter((item) => item.kind === "dm")).toHaveLength(1);
    expect(theirs.items[0]).toMatchObject({
      kind: "dm",
      actor: { name: "Olivia" },
      preview: "are you there?",
      read: false,
    });
    expect((await inbox("olivia")).items).toHaveLength(0);

    const counts = await memberUnreadCounts(prisma, users.beatrice!, [threadId]);
    expect(counts.get(threadId)).toEqual({ count: 2, mentions: 0 });
    // The sender's own messages never count for them.
    expect((await memberUnreadCounts(prisma, users.olivia!, [threadId])).get(threadId)?.count).toBe(
      0,
    );

    await markDirectRead(prisma, { threadId, spaceId, userId: users.beatrice! });
    expect((await inbox("beatrice")).unreadCount).toBe(0);
    expect(
      (await memberUnreadCounts(prisma, users.beatrice!, [threadId])).get(threadId)?.count,
    ).toBe(0);
  });

  it("raises a mention for each person a channel message names, and counts it apart", async () => {
    await say(channelThreadId, users.olivia!, "welcome @Beatrice and @Cyrus");
    await say(channelThreadId, users.olivia!, "no names here");
    const beatrice = await inbox("beatrice");
    expect(beatrice.items.filter((item) => item.kind === "mention")).toHaveLength(1);
    expect(beatrice.items.find((item) => item.kind === "mention")).toMatchObject({
      groupId,
      source: "general",
    });
    expect((await inbox("cyrus")).items.some((item) => item.kind === "mention")).toBe(true);
    expect((await inbox("olivia")).items).toHaveLength(0);
    const counts = await memberUnreadCounts(prisma, users.beatrice!, [channelThreadId]);
    expect(counts.get(channelThreadId)).toEqual({ count: 2, mentions: 1 });
  });

  it("raises a reply for people already in a channel thread, and not for those who only mention", async () => {
    const root = await say(channelThreadId, users.beatrice!, "question for the team");
    await say(channelThreadId, users.olivia!, "answer", { threadRootId: root.id });
    const beatrice = await inbox("beatrice");
    expect(beatrice.items.some((item) => item.kind === "reply")).toBe(true);
    expect((await inbox("cyrus")).items.some((item) => item.kind === "reply")).toBe(false);
  });

  it("keeps one space's entries out of another space's reads, and one member's out of another's", async () => {
    const seen = await runAsTenant({ spaceId: otherSpaceId, userId: users.dana! }, () =>
      raw.notification.findMany({}),
    );
    expect(seen).toHaveLength(0);
    const crossed = await runAsTenant({ spaceId: otherSpaceId, userId: users.dana! }, () =>
      listNotifications(raw, { spaceId: otherSpaceId, userId: users.beatrice! }),
    );
    expect(crossed.items).toHaveLength(0);
    const cyrus = await inbox("cyrus");
    const beatriceIds = new Set((await inbox("beatrice")).items.map((item) => item.id));
    expect(cyrus.items.some((item) => beatriceIds.has(item.id))).toBe(false);
  });

  it("marks entries read by id, by conversation and all at once, only for the caller", async () => {
    const before = await inbox("beatrice");
    expect(before.unreadCount).toBeGreaterThan(0);
    const [first] = before.items;
    await runAsTenant({ spaceId, userId: users.cyrus! }, () =>
      markNotificationsRead(raw, { spaceId, userId: users.cyrus!, ids: [first!.id] }),
    );
    expect((await inbox("beatrice")).unreadCount).toBe(before.unreadCount);
    await runAsTenant({ spaceId, userId: users.beatrice! }, () =>
      markNotificationsRead(raw, { spaceId, userId: users.beatrice!, threadId: channelThreadId }),
    );
    expect((await inbox("beatrice")).items.every((item) => item.read)).toBe(true);
    await raiseNotification(prisma, {
      spaceId,
      userId: users.beatrice!,
      kind: "alert",
      dedupeKey: "alert:test",
      detail: "Limit reached",
    });
    const raised = await inbox("beatrice");
    expect(raised.unreadCount).toBe(1);
    expect(raised.items[0]).toMatchObject({ kind: "alert", detail: "Limit reached", read: false });
    await runAsTenant({ spaceId, userId: users.beatrice! }, () =>
      markAllNotificationsRead(raw, { spaceId, userId: users.beatrice! }),
    );
    expect((await inbox("beatrice")).unreadCount).toBe(0);
  });

  it("caps what it counts per conversation", async () => {
    const thread = await prisma.thread.create({
      data: { spaceId, userId: users.olivia!, nextMessageSeq: 0 },
    });
    for (let i = 0; i < UNREAD_COUNT_CAP + 5; i += 1) {
      await createThreadMessage(prisma, {
        threadId: thread.id,
        role: "bot",
        blocks: [{ kind: "text", text: `m${i}` }],
      });
    }
    const counts = await memberUnreadCounts(prisma, users.olivia!, [thread.id]);
    expect(counts.get(thread.id)?.count).toBe(UNREAD_COUNT_CAP);
  });
});
