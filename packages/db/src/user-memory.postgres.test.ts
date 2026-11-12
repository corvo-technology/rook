import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAsSystem, runAsTenant } from "./row-security.js";
import {
  addUserMemory,
  decideUserMemory,
  editUserMemory,
  getMemoryLearning,
  getUserMemory,
  listUserMemories,
  proposeUserMemory,
  savedUserFacts,
  searchUserMemories,
  setMemoryLearning,
  UserMemoryNotFoundError,
  UserMemoryStateError,
} from "./user-memory.js";
import { wikiTestFixture } from "./wiki-test-fixture.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

describePostgres("what agents know about a person (PostgreSQL)", () => {
  let fx: Awaited<ReturnType<typeof wikiTestFixture>>;
  beforeAll(async () => {
    fx = await wikiTestFixture();
    await runAsSystem("test fixture", async () => {
      for (const [spaceId, userId] of [
        [fx.spaceId, fx.userId],
        [fx.spaceId, fx.otherUserId],
        [fx.otherSpaceId, fx.userId],
      ] as const)
        await fx.prisma.member.upsert({
          where: { organizationId_userId: { organizationId: fx.organizationId, userId } },
          update: {},
          create: {
            id: `${spaceId}-${userId}`.slice(0, 60),
            organizationId: fx.organizationId,
            userId,
            role: "member",
            createdAt: new Date(),
          },
        });
      for (const [spaceId, userId] of [
        [fx.spaceId, fx.userId],
        [fx.spaceId, fx.otherUserId],
      ] as const)
        await fx.prisma.spaceMember.create({
          data: {
            id: `sm-${spaceId}-${userId}`.slice(0, 60),
            spaceId,
            organizationId: fx.organizationId,
            userId,
            createdAt: new Date(),
          },
        });
    });
  });
  afterAll(() => fx?.close());

  const mine = () => ({ spaceId: fx.spaceId, userId: fx.userId });
  const colleague = () => ({ spaceId: fx.spaceId, userId: fx.otherUserId });
  const elsewhere = () => ({ spaceId: fx.otherSpaceId, userId: fx.userId });
  type Scope = ReturnType<typeof mine>;
  /** The store as one person's request sees it: row-level security knows who is asking. */
  const as = (scope: Scope) => ({
    add: (text: string) => runAsTenant(scope, () => addUserMemory(fx.prisma, scope, text)),
    propose: (text: string, source: "agent" | "learned" = "agent") =>
      runAsTenant(scope, () =>
        proposeUserMemory(fx.prisma, scope, { text, source, state: "pending" }),
      ),
    decide: (id: string, decision: Parameters<typeof decideUserMemory>[3]) =>
      runAsTenant(scope, () => decideUserMemory(fx.prisma, scope, id, decision)),
    edit: (id: string, text: string) =>
      runAsTenant(scope, () => editUserMemory(fx.prisma, scope, id, text)),
    get: (id: string) => runAsTenant(scope, () => getUserMemory(fx.prisma, scope, id)),
    list: (state?: Parameters<typeof listUserMemories>[2]) =>
      runAsTenant(scope, () => listUserMemories(fx.prisma, scope, state)),
    saved: () => runAsTenant(scope, () => savedUserFacts(fx.prisma, scope)),
    search: (query: string) =>
      runAsTenant(scope, () => searchUserMemories(fx.prisma, scope, query)),
    learning: () => runAsTenant(scope, () => getMemoryLearning(fx.prisma, scope)),
    setLearning: (learn: boolean) =>
      runAsTenant(scope, () => setMemoryLearning(fx.prisma, scope, learn)),
  });

  it("keeps the text sealed in the database and readable through the store", async () => {
    const memory = await as(mine()).add("Runs a bakery in Lisbon");
    expect(memory).toMatchObject({
      text: "Runs a bakery in Lisbon",
      state: "saved",
      source: "typed",
    });
    const [raw] = await runAsSystem("test fixture", () =>
      fx.query<{ text: string }>(`SELECT text FROM user_memories WHERE id = $1`, [memory.id]),
    );
    expect(raw!.text).not.toContain("bakery");
  });

  it("holds a suggestion until Save, and an agent's fact is not read before that", async () => {
    const result = await as(mine()).propose("Prefers answers in Portuguese");
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") return;
    expect(await as(mine()).saved()).not.toContain("Prefers answers in Portuguese");
    const saved = await as(mine()).decide(result.memory.id, "save");
    expect(saved?.state).toBe("saved");
    expect(await as(mine()).saved()).toContain("Prefers answers in Portuguese");
    // Answering twice is not an error: the card shows where it stands.
    expect((await as(mine()).decide(result.memory.id, "save"))?.state).toBe("saved");
  });

  it("knows a fact it already has, however it is spelled", async () => {
    await as(mine()).add("Likes tea, not coffee");
    const again = await as(mine()).propose("likes TEA not  coffee!");
    expect(again.outcome).toBe("known");
  });

  it("does not learn a forgotten fact again, until the person says it themselves", async () => {
    const first = await as(mine()).propose("Has a dog called Rex");
    if (first.outcome !== "created") throw new Error("expected a suggestion");
    await as(mine()).decide(first.memory.id, "discard");
    expect(await as(mine()).propose("has a dog called rex")).toEqual({ outcome: "forgotten" });
    expect(await as(mine()).get(first.memory.id)).toMatchObject({
      state: "forgotten",
    });
    const typed = await as(mine()).add("Has a dog called Rex");
    expect(typed).toMatchObject({ id: first.memory.id, state: "saved" });
  });

  it("forgets a saved fact, and erases it for good only once forgotten", async () => {
    const memory = await as(mine()).add("Works night shifts");
    await expect(as(mine()).decide(memory.id, "erase")).rejects.toBeInstanceOf(
      UserMemoryStateError,
    );
    expect((await as(mine()).decide(memory.id, "forget"))?.state).toBe("forgotten");
    expect(await as(mine()).decide(memory.id, "erase")).toBeNull();
    expect(await as(mine()).get(memory.id)).toBeNull();
    // Erased for good, it can be learned again.
    expect((await as(mine()).propose("Works night shifts")).outcome).toBe("created");
  });

  it("asks again about a fact not confirmed for a long time, and keeps it in the meantime", async () => {
    const memory = await as(mine()).add("Lives near the river");
    await runAsSystem("test fixture", () =>
      fx.prisma.userMemory.update({
        where: { id: memory.id },
        data: { confirmedAt: new Date("2025-01-01T00:00:00Z") },
      }),
    );
    const stale = (await as(mine()).list({ state: ["saved"] })).find(
      (entry) => entry.id === memory.id,
    );
    expect(stale?.stale).toBe(true);
    expect(await as(mine()).saved()).toContain("Lives near the river");
    const kept = await as(mine()).decide(memory.id, "keep");
    expect(kept?.stale).toBe(false);
  });

  it("edits a fact, but never into another that exists", async () => {
    const memory = await as(mine()).add("Drinks two coffees a day");
    await as(mine()).add("Drinks one coffee a day");
    const edited = await as(mine()).edit(memory.id, "Drinks three coffees a day");
    expect(edited.text).toBe("Drinks three coffees a day");
    await expect(as(mine()).edit(memory.id, "drinks one coffee a day")).rejects.toBeInstanceOf(
      UserMemoryStateError,
    );
  });

  it("finds saved facts by the start of a word, beyond what a prompt holds", async () => {
    await as(mine()).add("Allergic to peanuts");
    expect(await as(mine()).search("peanut")).toEqual(["Allergic to peanuts"]);
    expect(await as(mine()).search("peanut walnut")).toEqual([]);
  });

  it("is private to the person and the space", async () => {
    const secret = await as(mine()).add("Planning a surprise party");
    expect(await as(colleague()).list()).toEqual([]);
    expect(await as(elsewhere()).list()).toEqual([]);
    expect(await as(colleague()).get(secret.id)).toBeNull();
    await expect(as(colleague()).decide(secret.id, "forget")).rejects.toBeInstanceOf(
      UserMemoryNotFoundError,
    );
    await expect(as(colleague()).edit(secret.id, "x")).rejects.toBeInstanceOf(
      UserMemoryNotFoundError,
    );
    // The same words in another person's memory are their own row.
    expect((await as(colleague()).add("Planning a surprise party")).id).not.toBe(secret.id);
  });

  it("learns only when the person turned it on", async () => {
    expect(await as(mine()).learning()).toBe(false);
    await as(mine()).setLearning(true);
    expect(await as(mine()).learning()).toBe(true);
    expect(await as(colleague()).learning()).toBe(false);
  });
});
