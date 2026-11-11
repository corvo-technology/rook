import type { CuratorOp } from "@corvo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAsSystem } from "./row-security.js";
import {
  readWikiPage,
  removeWikiPage,
  restoreWikiRevision,
  WikiConflictError,
  WikiNotFoundError,
  wikiHistory,
  writeWikiPage,
} from "./wiki.js";
import {
  advanceWikiCursor,
  applyAllWikiChanges,
  createWikiChange,
  decideWikiChange,
  getWikiSettings,
  listWikiChanges,
  setThreadWikiCapture,
  setWikiSettings,
  WikiChangeStateError,
} from "./wiki-changes.js";
import { wikiTestFixture } from "./wiki-test-fixture.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

describePostgres("wiki changes (PostgreSQL)", () => {
  let fx: Awaited<ReturnType<typeof wikiTestFixture>>;
  beforeAll(async () => {
    fx = await wikiTestFixture();
  });
  afterAll(() => fx?.close());

  const system = <T>(work: () => Promise<T>) => runAsSystem("test fixture", work);
  const mine = () => ({ spaceId: fx.spaceId, userId: fx.userId });
  const colleague = () => ({ spaceId: fx.spaceId, userId: fx.otherUserId });
  const elsewhere = () => ({ spaceId: fx.otherSpaceId, userId: fx.userId });
  const write = (title: string, body: string, expectedRevision?: number) =>
    writeWikiPage(fx.prisma, colleague(), { title, body, expectedRevision });
  const body = async (title: string) => (await readWikiPage(fx.prisma, mine(), title))?.body;
  /** A channel of the person's, which is what gives a conversation its owner. */
  const thread = async () => {
    const group = await fx.prisma.chatGroup.create({
      data: { spaceId: fx.spaceId, userId: fx.userId, name: "Engineering" },
    });
    return fx.prisma.thread.create({
      data: { spaceId: fx.spaceId, userId: fx.userId, groupId: group.id },
    });
  };

  let counter = 0;
  /** A change from a conversation stretch; each call reads a stretch no earlier call did. */
  async function propose(
    ops: CuratorOp[],
    edits: "auto" | "approve" = "approve",
    scope = mine(),
    extra: { threadId?: string; from?: number; to?: number } = {},
  ) {
    const threadId = extra.threadId ?? (await thread()).id;
    counter += 1;
    return createWikiChange(fx.prisma, scope, {
      source: {
        origin: "conversation",
        title: "Kickoff call",
        text: "Ana: we are going with Alpha Builders.",
        threadId,
        fromSeq: extra.from ?? counter * 10,
        toSeq: extra.to ?? counter * 10 + 5,
      },
      ops,
      reason: "A decision about the lobby",
      anchor: { threadId },
      edits,
    });
  }

  it("writes a new page at once, whatever the setting says", () =>
    system(async () => {
      const change = await propose([
        { op: "create", page: "Lobby Client One", kind: "Client", body: "Chosen for the lobby." },
      ]);
      expect(change?.state).toBe("applied");
      expect(change?.pages).toEqual([{ title: "Lobby Client One", op: "create" }]);
      expect(await body("Lobby Client One")).toContain("Chosen for the lobby.");
    }));

  it("keeps an edit waiting for approval, and applies it once approved", () =>
    system(async () => {
      await write("Plan One", "Status: planning.");
      const change = await propose([
        { op: "replace", page: "Plan One", old: "planning", new: "building" },
      ]);
      expect(change?.state).toBe("pending");
      expect(await body("Plan One")).toBe("Status: planning.");
      const done = await decideWikiChange(fx.prisma, mine(), change!.id, "apply");
      expect(done.state).toBe("applied");
      expect(await body("Plan One")).toBe("Status: building.");
    }));

  it("applies an edit at once when the Space says so", () =>
    system(async () => {
      await write("Plan Two", "Status: planning.");
      const change = await propose(
        [{ op: "append", page: "Plan Two", section: "Risks", text: "Permit delay." }],
        "auto",
      );
      expect(change?.state).toBe("applied");
      expect(await body("Plan Two")).toBe("Status: planning.\n\n## Risks\n\nPermit delay.");
    }));

  it("applies a new page now and leaves the edit of a package that has both waiting", () =>
    system(async () => {
      await write("Plan Three", "Status: planning.");
      const change = await propose([
        { op: "create", page: "Lobby Client Two", body: "Chosen." },
        { op: "replace", page: "Plan Three", old: "planning", new: "building" },
      ]);
      expect(change?.state).toBe("pending");
      expect(await body("Lobby Client Two")).toBe("Chosen.");
      expect(await body("Plan Three")).toBe("Status: planning.");
      await decideWikiChange(fx.prisma, mine(), change!.id, "apply");
      expect(await body("Plan Three")).toBe("Status: building.");
    }));

  it("undoes what a change wrote and restores the text before it", () =>
    system(async () => {
      await write("Plan Four", "Status: planning.");
      const change = await propose(
        [
          { op: "replace", page: "Plan Four", old: "planning", new: "building" },
          { op: "create", page: "Lobby Client Three", body: "Chosen." },
        ],
        "auto",
      );
      const undone = await decideWikiChange(fx.prisma, mine(), change!.id, "undo");
      expect(undone.state).toBe("undone");
      expect(await body("Plan Four")).toBe("Status: planning.");
      expect(await body("Lobby Client Three")).toBeUndefined();
    }));

  it("marks a change conflicting when its page moved, and never overwrites the newer text", () =>
    system(async () => {
      await write("Plan Five", "Status: planning.");
      const change = await propose([
        { op: "replace", page: "Plan Five", old: "planning", new: "building" },
      ]);
      await write("Plan Five", "Status: planning. Budget approved.");
      const result = await decideWikiChange(fx.prisma, mine(), change!.id, "apply");
      expect(result.state).toBe("conflict");
      expect(await body("Plan Five")).toBe("Status: planning. Budget approved.");
    }));

  it("refuses to undo over an edit someone made after the change", () =>
    system(async () => {
      await write("Plan Six", "Status: planning.");
      const change = await propose(
        [{ op: "replace", page: "Plan Six", old: "planning", new: "building" }],
        "auto",
      );
      await write("Plan Six", "Status: building. Inspection on 12/11.");
      const result = await decideWikiChange(fx.prisma, mine(), change!.id, "undo");
      expect(result.state).toBe("conflict");
      expect(await body("Plan Six")).toBe("Status: building. Inspection on 12/11.");
    }));

  it("changes no page when a change is refused", () =>
    system(async () => {
      await write("Plan Seven", "Status: planning.");
      const change = await propose([
        { op: "replace", page: "Plan Seven", old: "planning", new: "building" },
      ]);
      const result = await decideWikiChange(fx.prisma, mine(), change!.id, "refuse");
      expect(result.state).toBe("refused");
      expect(await body("Plan Seven")).toBe("Status: planning.");
    }));

  it("answers a decision only once, from a state that allows it", () =>
    system(async () => {
      await write("Plan Eight", "Status: planning.");
      const change = await propose([
        { op: "replace", page: "Plan Eight", old: "planning", new: "building" },
      ]);
      await decideWikiChange(fx.prisma, mine(), change!.id, "apply");
      await expect(decideWikiChange(fx.prisma, mine(), change!.id, "apply")).rejects.toThrow(
        WikiChangeStateError,
      );
      await expect(decideWikiChange(fx.prisma, mine(), change!.id, "refuse")).rejects.toThrow(
        WikiChangeStateError,
      );
    }));

  it("drops operations that cannot apply, and makes no change when none can", () =>
    system(async () => {
      await write("Plan Nine", "Status: planning.");
      const none = await propose([
        { op: "replace", page: "Plan Nine", old: "cancelled", new: "x" },
        { op: "create", page: "Plan Nine", body: "A second copy." },
        { op: "append", page: "No Such Page", text: "Orphan." },
      ]);
      expect(none).toBeNull();
      expect(await body("Plan Nine")).toBe("Status: planning.");
    }));

  it("never keeps the same stretch of a conversation twice", () =>
    system(async () => {
      const t = await thread();
      const ops: CuratorOp[] = [{ op: "create", page: "Lobby Client Four", body: "Chosen." }];
      const first = await propose(ops, "approve", mine(), { threadId: t.id, from: 1, to: 6 });
      const again = await propose(
        [{ op: "create", page: "Lobby Client Five", body: "Chosen." }],
        "approve",
        mine(),
        { threadId: t.id, from: 1, to: 6 },
      );
      expect(first).not.toBeNull();
      expect(again).toBeNull();
      expect(await body("Lobby Client Five")).toBeUndefined();
    }));

  it("lets one reader move a conversation's cursor once", () =>
    system(async () => {
      const t = await thread();
      expect(await advanceWikiCursor(fx.prisma, t.id, null, 14)).toBe(true);
      expect(await advanceWikiCursor(fx.prisma, t.id, null, 20)).toBe(false);
      expect(await advanceWikiCursor(fx.prisma, t.id, 14, 20)).toBe(true);
    }));

  it("lists the changes of the Space, by state, and shows none to another Space", () =>
    system(async () => {
      await write("Plan Ten", "Status: planning.");
      const change = await propose([
        { op: "replace", page: "Plan Ten", old: "planning", new: "building" },
      ]);
      const waiting = await listWikiChanges(fx.prisma, mine(), { state: ["pending"] });
      expect(waiting.map((item) => item.id)).toContain(change!.id);
      expect(
        (await listWikiChanges(fx.prisma, mine(), { state: ["refused"] })).map((c) => c.id),
      ).not.toContain(change!.id);
      expect(await listWikiChanges(fx.prisma, elsewhere())).toEqual([]);
      await expect(decideWikiChange(fx.prisma, elsewhere(), change!.id, "apply")).rejects.toThrow(
        WikiNotFoundError,
      );
    }));

  it("hands back the quoted source with the change, for the route to show or hide", () =>
    system(async () => {
      const change = await propose([{ op: "create", page: "Lobby Client Six", body: "Chosen." }]);
      expect(change).toMatchObject({
        sourceTitle: "Kickoff call",
        sourceText: "Ana: we are going with Alpha Builders.",
        sourceUserId: fx.userId,
      });
    }));

  it("keeps the Space's two settings, with defaults until someone changes them", () =>
    system(async () => {
      expect(await getWikiSettings(fx.prisma, fx.otherSpaceId)).toEqual({
        capture: true,
        edits: "approve",
      });
      expect(await setWikiSettings(fx.prisma, fx.otherSpaceId, { edits: "auto" })).toEqual({
        capture: true,
        edits: "auto",
      });
      expect(await setWikiSettings(fx.prisma, fx.otherSpaceId, { capture: false })).toEqual({
        capture: false,
        edits: "auto",
      });
    }));

  it("keeps a conversation's own switch, only for its owner in its Space", () =>
    system(async () => {
      const t = await thread();
      const owner = { threadId: t.id, spaceId: fx.spaceId, userId: fx.userId };
      expect(await setThreadWikiCapture(fx.prisma, owner, true)).toBe(true);
      expect((await fx.prisma.thread.findUniqueOrThrow({ where: { id: t.id } })).wikiCapture).toBe(
        true,
      );
      expect(await setThreadWikiCapture(fx.prisma, owner, null)).toBe(true);
      expect(
        (await fx.prisma.thread.findUniqueOrThrow({ where: { id: t.id } })).wikiCapture,
      ).toBeNull();
      expect(
        await setThreadWikiCapture(fx.prisma, { ...owner, userId: fx.otherUserId }, false),
      ).toBe(false);
      expect(
        await setThreadWikiCapture(fx.prisma, { ...owner, spaceId: fx.otherSpaceId }, false),
      ).toBe(false);
    }));

  it("never puts back or deletes a page that someone edited since", () =>
    system(async () => {
      await write("Guarded Page", "One.");
      await write("Guarded Page", "Two.", 1);
      await write("Guarded Page", "Three.", 2);
      await expect(
        restoreWikiRevision(fx.prisma, mine(), "Guarded Page", 1, { expectedRevision: 2 }),
      ).rejects.toThrow(WikiConflictError);
      expect(await body("Guarded Page")).toBe("Three.");
      expect(await removeWikiPage(fx.prisma, mine(), "Guarded Page", { expectedRevision: 2 })).toBe(
        false,
      );
      expect(await body("Guarded Page")).toBe("Three.");
      expect(await removeWikiPage(fx.prisma, mine(), "Guarded Page", { expectedRevision: 3 })).toBe(
        true,
      );
    }));

  it("lets only one of two approvals write the pages, and the other is refused", () =>
    system(async () => {
      for (let round = 0; round < 4; round += 1) {
        const title = `Race Plan ${round}`;
        await write(title, "Status: planning.");
        const change = await propose([
          { op: "replace", page: title, old: "planning", new: "building" },
        ]);
        const results = await Promise.allSettled([
          decideWikiChange(fx.prisma, mine(), change!.id, "apply"),
          decideWikiChange(fx.prisma, colleague(), change!.id, "apply"),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect(loser.reason).toBeInstanceOf(WikiChangeStateError);
        expect(await body(title)).toBe("Status: building.");
        const [settled] = await listWikiChanges(fx.prisma, mine(), { state: ["applied"] });
        expect(settled?.id).toBeTruthy();
        // What was written is recorded, so the change can still be undone.
        const undone = await decideWikiChange(fx.prisma, mine(), change!.id, "undo");
        expect(undone.state).toBe("undone");
        expect(await body(title)).toBe("Status: planning.");
      }
    }));

  it("keeps an approval and a refusal from leaving pages written under a refused change", () =>
    system(async () => {
      for (let round = 0; round < 4; round += 1) {
        const title = `Race Refuse ${round}`;
        await write(title, "Status: planning.");
        const change = await propose([
          { op: "replace", page: title, old: "planning", new: "building" },
        ]);
        await Promise.allSettled([
          decideWikiChange(fx.prisma, mine(), change!.id, "apply"),
          decideWikiChange(fx.prisma, colleague(), change!.id, "refuse"),
        ]);
        const [after] = (await listWikiChanges(fx.prisma, mine())).filter(
          (c) => c.id === change!.id,
        );
        const text = await body(title);
        if (after?.state === "refused") expect(text).toBe("Status: planning.");
        else {
          expect(after?.state).toBe("applied");
          expect(text).toBe("Status: building.");
        }
      }
    }));

  it("does not let a decision that stopped half way block the change for ever", () =>
    system(async () => {
      await write("Stale Claim", "Status: planning.");
      const change = await propose([
        { op: "replace", page: "Stale Claim", old: "planning", new: "building" },
      ]);
      await fx.prisma.wikiChange.update({
        where: { id: change!.id },
        data: { claimedAt: new Date(Date.now() - 10 * 60_000) },
      });
      expect((await decideWikiChange(fx.prisma, mine(), change!.id, "apply")).state).toBe(
        "applied",
      );
    }));

  it("takes back the pages a refused change had already written, when nobody edited them", () =>
    system(async () => {
      await write("Mixed Plan", "Status: planning.");
      const change = await propose([
        { op: "create", page: "Mixed New Page", body: "Chosen." },
        { op: "replace", page: "Mixed Plan", old: "planning", new: "building" },
      ]);
      expect(await body("Mixed New Page")).toBe("Chosen.");
      const refused = await decideWikiChange(fx.prisma, mine(), change!.id, "refuse");
      expect(refused.state).toBe("refused");
      expect(await body("Mixed New Page")).toBeUndefined();
      expect(await body("Mixed Plan")).toBe("Status: planning.");
    }));

  it("leaves a page someone edited alone when a change is refused, and still refuses it", () =>
    system(async () => {
      await write("Mixed Plan Two", "Status: planning.");
      const change = await propose([
        { op: "create", page: "Mixed New Page Two", body: "Chosen." },
        { op: "replace", page: "Mixed Plan Two", old: "planning", new: "building" },
      ]);
      await write("Mixed New Page Two", "Chosen. And edited by a person.", 1);
      const refused = await decideWikiChange(fx.prisma, mine(), change!.id, "refuse");
      expect(refused.state).toBe("refused");
      expect(await body("Mixed New Page Two")).toBe("Chosen. And edited by a person.");
    }));

  it("says what each operation would write, so a person can read it before approving", () =>
    system(async () => {
      await write("Preview Page", "Status: planning.");
      const change = await propose([
        { op: "create", page: "Preview New", kind: "Client", body: "Chosen for the lobby." },
        { op: "append", page: "Preview Page", section: "Risks", text: "Permit delay." },
        { op: "replace", page: "Preview Page", old: "planning", new: "building" },
      ]);
      expect(change?.edits).toEqual([
        {
          title: "Preview New",
          op: "create",
          added: "---\nkind: Client\n---\nChosen for the lobby.",
        },
        { title: "Preview Page", op: "append", section: "Risks", added: "Permit delay." },
        { title: "Preview Page", op: "replace", removed: "planning", added: "building" },
      ]);
    }));

  describe("approving everything that waits", () => {
    const clearWaiting = async () => {
      await fx.prisma.wikiChange.updateMany({
        where: { spaceId: fx.spaceId, state: "pending" },
        data: { claimedAt: null },
      });
      for (const change of await listWikiChanges(fx.prisma, mine(), { state: ["pending"] }))
        await decideWikiChange(fx.prisma, mine(), change.id, "refuse");
    };

    it("applies each waiting change oldest first and marks the one whose page moved", () =>
      system(async () => {
        await clearWaiting();
        await write("Bulk One", "Status: planning.");
        await write("Bulk Two", "Status: planning.");
        await write("Bulk Three", "Status: planning.");
        const first = await propose([
          { op: "replace", page: "Bulk One", old: "planning", new: "building" },
        ]);
        const moved = await propose([
          { op: "replace", page: "Bulk Two", old: "planning", new: "building" },
        ]);
        const last = await propose([
          { op: "append", page: "Bulk Three", section: "Risks", text: "Permit delay." },
        ]);
        await write("Bulk Two", "Status: planning. Budget approved.");
        expect(await applyAllWikiChanges(fx.prisma, mine())).toEqual({ applied: 2, conflicts: 1 });
        expect(await body("Bulk One")).toBe("Status: building.");
        expect(await body("Bulk Two")).toBe("Status: planning. Budget approved.");
        expect(await body("Bulk Three")).toContain("Permit delay.");
        const state = async (id: string) =>
          (await listWikiChanges(fx.prisma, mine())).find((change) => change.id === id)?.state;
        expect(await state(first!.id)).toBe("applied");
        expect(await state(moved!.id)).toBe("conflict");
        expect(await state(last!.id)).toBe("applied");
        expect(await wikiHistory(fx.prisma, mine(), "Bulk One")).toHaveLength(2);
      }));

    it("skips a change another answer has claimed, without counting it", () =>
      system(async () => {
        await clearWaiting();
        await write("Bulk Four", "Status: planning.");
        await write("Bulk Five", "Status: planning.");
        const claimed = await propose([
          { op: "replace", page: "Bulk Four", old: "planning", new: "building" },
        ]);
        await propose([{ op: "replace", page: "Bulk Five", old: "planning", new: "building" }]);
        await fx.prisma.wikiChange.update({
          where: { id: claimed!.id },
          data: { claimedAt: new Date() },
        });
        expect(await applyAllWikiChanges(fx.prisma, mine())).toEqual({ applied: 1, conflicts: 0 });
        expect(await body("Bulk Four")).toBe("Status: planning.");
        expect(await body("Bulk Five")).toBe("Status: building.");
      }));

    it("does nothing when nothing waits", () =>
      system(async () => {
        await clearWaiting();
        expect(await applyAllWikiChanges(fx.prisma, mine())).toEqual({ applied: 0, conflicts: 0 });
      }));
  });
});
