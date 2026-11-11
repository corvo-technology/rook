import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWikiChange, runAsSystem } from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionCookieHeader } from "../../../packages/testkit/src/index.js";
import { createApp } from "./app.js";

const describePostgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;

describePostgres("the wiki curator procedures", () => {
  const origin = "http://127.0.0.1:5173";
  let handles: Awaited<ReturnType<typeof createApp>>;
  let dataDir: string;
  const people: Record<string, { cookie: string; userId: string; spaceId: string }> = {};
  const system = <T>(work: () => Promise<T>) => runAsSystem("test fixture", work);

  async function signUp(name: string) {
    const email = `curator-${name}-${Date.now()}@corvo.test`;
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: "test-password-123", name }),
    });
    expect(response.status).toBeLessThan(400);
    const { userId, spaceId } = await system(async () => {
      const user = await handles.prisma.user.findFirstOrThrow({ where: { email } });
      const member = await handles.prisma.spaceMember.findFirstOrThrow({
        where: { userId: user.id },
      });
      return { userId: user.id, spaceId: member.spaceId };
    });
    people[name] = { cookie: sessionCookieHeader(response), userId, spaceId };
  }

  const call = async (name: string, procedure: string, input: unknown = {}) => {
    const response = await handles.app.request(`/rpc/${procedure}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: people[name]!.cookie,
        origin,
        "x-corvo-space-id": people[name]!.spaceId,
      },
      body: JSON.stringify({ json: input }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text).json : undefined };
  };

  /** A bot with its chat and one message, for a person's own conversation. */
  async function chat(name: string) {
    const { userId, spaceId } = people[name]!;
    return system(async () => {
      const bot = await handles.prisma.bot.create({
        data: {
          spaceId,
          userId,
          name: `Solo ${Date.now()}`,
          color: "ink",
          thread: { create: { spaceId, userId, nextMessageSeq: 1 } },
        },
        include: { thread: true },
      });
      const message = await handles.prisma.message.create({
        data: {
          threadId: bot.thread!.id,
          seq: 0,
          role: "user",
          blocks: [{ kind: "text", text: "Remember this." }],
        },
      });
      return { botId: bot.id, threadId: bot.thread!.id, messageId: message.id };
    });
  }

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "corvo-wiki-curator-"));
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      webOrigin: origin,
      authUrl: origin,
    });
    await signUp("ada");
    await signUp("grace");
  });
  afterAll(async () => {
    await handles?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  async function pendingChange() {
    const ada = people.ada!;
    const { threadId } = await chat("ada");
    await call("ada", "wiki/write", { title: "Plan", body: "Status: planning." });
    const change = await system(() =>
      createWikiChange(
        handles.prisma,
        { spaceId: ada.spaceId, userId: ada.userId },
        {
          source: {
            origin: "conversation",
            title: "Planning call",
            text: "Ana: planning is over.",
            threadId,
            fromSeq: Math.floor(Math.random() * 1e6),
            toSeq: 1e6 + Math.floor(Math.random() * 1e6),
          },
          ops: [{ op: "replace", page: "Plan", old: "planning", new: "building" }],
          reason: "The plan moved on",
          anchor: { threadId },
          edits: "approve",
        },
      ),
    );
    return change!;
  }

  it("lists what waits, reads one change, and answers it, for the person whose Space it is", async () => {
    const change = await pendingChange();
    const waiting = await call("ada", "wiki/changes/list", { state: ["pending"] });
    expect(waiting.status).toBe(200);
    expect(waiting.body.map((item: { id: string }) => item.id)).toContain(change.id);
    expect(waiting.body[0]).toMatchObject({ canSeeSource: true });
    const one = await call("ada", "wiki/changes/get", { changeId: change.id });
    expect(one.body).toMatchObject({
      id: change.id,
      state: "pending",
      sourceText: "Ana: planning is over.",
    });

    const applied = await call("ada", "wiki/changes/decide", {
      changeId: change.id,
      decision: "apply",
    });
    expect(applied.body).toMatchObject({ state: "applied" });
    expect((await call("ada", "wiki/read", { title: "Plan" })).body.body).toBe("Status: building.");
    const again = await call("ada", "wiki/changes/decide", {
      changeId: change.id,
      decision: "apply",
    });
    expect(again.status).toBe(409);
    const undone = await call("ada", "wiki/changes/decide", {
      changeId: change.id,
      decision: "undo",
    });
    expect(undone.body).toMatchObject({ state: "undone" });
  });

  it("shows another Space nothing of it, and lets it decide nothing", async () => {
    const change = await pendingChange();
    expect((await call("grace", "wiki/changes/list", {})).body).toEqual([]);
    expect((await call("grace", "wiki/changes/get", { changeId: change.id })).status).toBe(404);
    const refused = await call("grace", "wiki/changes/decide", {
      changeId: change.id,
      decision: "apply",
    });
    expect(refused.status).toBe(404);
    expect((await call("ada", "wiki/changes/get", { changeId: change.id })).body.state).toBe(
      "pending",
    );
  });

  it("keeps the Space's two settings, with defaults until changed", async () => {
    expect((await call("ada", "wiki/settings/get")).body).toEqual({
      capture: true,
      edits: "approve",
    });
    expect((await call("ada", "wiki/settings/set", { edits: "auto" })).body).toEqual({
      capture: true,
      edits: "auto",
    });
    expect((await call("grace", "wiki/settings/get")).body).toEqual({
      capture: true,
      edits: "approve",
    });
  });

  it("lets only the owner of the Space change its wiki settings, though any member reads them", async () => {
    const ada = people.ada!;
    const setRole = (role: string) =>
      system(() =>
        handles.prisma.spaceMember.update({
          where: { spaceId_userId: { spaceId: ada.spaceId, userId: ada.userId } },
          data: { role },
        }),
      );
    await setRole("member");
    try {
      const refused = await call("ada", "wiki/settings/set", { edits: "auto" });
      expect(refused.status).toBe(403);
      expect((await call("ada", "wiki/settings/get")).status).toBe(200);
    } finally {
      await setRole("owner");
    }
    expect((await call("ada", "wiki/settings/set", { edits: "approve" })).status).toBe(200);
  });

  it("sets one conversation's switch, only on the person's own", async () => {
    const mine = await chat("ada");
    const set = await call("ada", "wiki/capture/set", { botId: mine.botId, capture: true });
    expect(set.body).toEqual({ ok: true });
    expect(
      await system(
        async () =>
          (await handles.prisma.thread.findUniqueOrThrow({ where: { id: mine.threadId } }))
            .wikiCapture,
      ),
    ).toBe(true);
    const theirs = await call("grace", "wiki/capture/set", { botId: mine.botId, capture: false });
    expect(theirs.status).toBeGreaterThanOrEqual(400);
    expect(
      await system(
        async () =>
          (await handles.prisma.thread.findUniqueOrThrow({ where: { id: mine.threadId } }))
            .wikiCapture,
      ),
    ).toBe(true);
  });

  it("keeps a message on purpose, only one that is in the person's own conversation", async () => {
    const mine = await chat("ada");
    expect(
      (await call("ada", "wiki/keep", { botId: mine.botId, messageId: mine.messageId })).body,
    ).toEqual({ ok: true });
    const stranger = await call("ada", "wiki/keep", {
      botId: mine.botId,
      messageId: "no-such-message",
    });
    expect(stranger.status).toBe(404);
    const theirs = await call("grace", "wiki/keep", {
      botId: mine.botId,
      messageId: mine.messageId,
    });
    expect(theirs.status).toBeGreaterThanOrEqual(400);
  });

  /** A channel of the person's with two agents in it and its own thread. */
  async function channel(name: string) {
    const { userId, spaceId } = people[name]!;
    return system(async () => {
      const bots = await Promise.all(
        [1, 2].map((n) =>
          handles.prisma.bot.create({
            data: { spaceId, userId, name: `Member ${n} ${Date.now()}`, color: "ink" },
          }),
        ),
      );
      const group = await handles.prisma.chatGroup.create({
        data: {
          spaceId,
          userId,
          name: "Engineering",
          members: { create: bots.map((bot) => ({ botId: bot.id })) },
        },
      });
      const thread = await handles.prisma.thread.create({
        data: { spaceId, userId, groupId: group.id },
      });
      return { groupId: group.id, threadId: thread.id };
    });
  }

  describe("one conversation's switch", () => {
    const setSpaceCapture = (name: string, capture: boolean) =>
      system(() =>
        handles.prisma.wikiSettings.upsert({
          where: { spaceId: people[name]!.spaceId },
          create: { spaceId: people[name]!.spaceId, capture },
          update: { capture },
        }),
      );

    it("shows a chat with one agent off until its owner turns it on", async () => {
      const mine = await chat("ada");
      expect((await call("ada", "wiki/capture/get", { botId: mine.botId })).body).toEqual({
        available: true,
        capture: null,
        on: false,
        canChange: true,
      });
      await call("ada", "wiki/capture/set", { botId: mine.botId, capture: true });
      expect((await call("ada", "wiki/capture/get", { botId: mine.botId })).body).toMatchObject({
        capture: true,
        on: true,
      });
    });

    it("is not available while the Space has the curator off", async () => {
      const mine = await chat("grace");
      await setSpaceCapture("grace", false);
      try {
        expect((await call("grace", "wiki/capture/get", { botId: mine.botId })).body).toMatchObject(
          {
            available: false,
            on: false,
          },
        );
      } finally {
        await setSpaceCapture("grace", true);
      }
    });

    it("follows a channel's default, off once other people share the Space, and refuses another member", async () => {
      const group = await channel("ada");
      expect(
        (await call("ada", "wiki/capture/get", { groupId: group.groupId })).body,
      ).toMatchObject({
        capture: null,
        on: true,
        canChange: true,
      });
      const extra = people.ada!;
      await signUp("linus");
      await system(async () => {
        const owner = await handles.prisma.spaceMember.findFirstOrThrow({
          where: { spaceId: extra.spaceId, userId: extra.userId },
        });
        await handles.prisma.member.create({
          data: {
            id: randomUUID(),
            organizationId: owner.organizationId,
            userId: people.linus!.userId,
            role: "member",
            createdAt: new Date(),
          },
        });
        // Joining the organization seats the person in its Space; one that is not seated is added.
        const seated = await handles.prisma.spaceMember.findFirst({
          where: { spaceId: extra.spaceId, userId: people.linus!.userId },
        });
        if (!seated)
          await handles.prisma.spaceMember.create({
            data: {
              id: randomUUID(),
              organizationId: owner.organizationId,
              spaceId: extra.spaceId,
              userId: people.linus!.userId,
              createdAt: new Date(),
            },
          });
      });
      const linus = { ...people.linus!, spaceId: extra.spaceId };
      people.linus = linus;
      expect(
        (await call("ada", "wiki/capture/get", { groupId: group.groupId })).body,
      ).toMatchObject({
        capture: null,
        on: false,
      });
      await call("ada", "wiki/capture/set", { groupId: group.groupId, capture: true });
      expect(
        (await call("ada", "wiki/capture/get", { groupId: group.groupId })).body,
      ).toMatchObject({
        capture: true,
        on: true,
      });
      const theirs = await call("linus", "wiki/capture/get", { groupId: group.groupId });
      expect(theirs.status === 200 ? theirs.body.canChange : false).toBe(false);
      const refused = await call("linus", "wiki/capture/set", {
        groupId: group.groupId,
        capture: false,
      });
      expect(refused.status).toBeGreaterThanOrEqual(400);
    });
  });

  it("applies the changes another member left waiting", async () => {
    const change = await pendingChange();
    const result = await call("linus", "wiki/changes/applyAll");
    expect(result.status).toBe(200);
    expect(result.body.applied).toBeGreaterThanOrEqual(1);
    expect((await call("ada", "wiki/changes/get", { changeId: change.id })).body.state).toBe(
      "applied",
    );
  });
});
