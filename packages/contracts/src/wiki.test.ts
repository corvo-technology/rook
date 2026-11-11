import { describe, expect, it } from "vitest";
import { MessageBlock } from "./events.js";
import {
  WIKI_BODY_MAX,
  WikiApplyAllResultSchema,
  WikiCaptureStateSchema,
  WikiCaptureValueSchema,
  WikiChangeDecideInputSchema,
  WikiChangeSchema,
  WikiHitSchema,
  WikiPageInfoSchema,
  WikiPageSchema,
  WikiRevisionSchema,
  WikiSettingsPatchSchema,
  WikiSettingsSchema,
  WikiTitleSchema,
  WikiWriteInputSchema,
} from "./wiki.js";

const info = {
  title: "Alpha Builders",
  path: "Alpha Builders.md",
  kind: "Client",
  summary: "A construction client.",
  revision: 2,
  updatedAt: "2026-11-04T10:00:00.000Z",
};

describe("wiki contracts", () => {
  it("describes a page with what it links to and what cites it", () => {
    const page = {
      ...info,
      body: "See [[Ana]] and [[Nobody]].",
      links: ["Ana", "Nobody"],
      missing: ["Nobody"],
      backlinks: ["Plan"],
    };
    expect(WikiPageSchema.parse(page)).toEqual(page);
    expect(WikiPageInfoSchema.parse(info)).toEqual(info);
    expect(WikiHitSchema.parse({ title: "A", kind: "Other", snippet: "…" })).toBeTruthy();
    expect(
      WikiRevisionSchema.parse({ revision: 1, at: "2026-11-04T10:00:00.000Z", bytes: 12 }),
    ).toBeTruthy();
  });

  it("needs a title with a letter or a digit in it", () => {
    expect(WikiTitleSchema.safeParse("").success).toBe(false);
    expect(WikiTitleSchema.safeParse("   ").success).toBe(false);
    expect(WikiTitleSchema.safeParse("?!...").success).toBe(false);
    expect(WikiTitleSchema.safeParse("x".repeat(121)).success).toBe(false);
    expect(WikiTitleSchema.parse("  Café 2  ")).toBe("Café 2");
  });

  it("limits what can be written", () => {
    expect(WikiWriteInputSchema.safeParse({ title: "A", body: "text" }).success).toBe(true);
    expect(
      WikiWriteInputSchema.safeParse({ title: "A", body: "x".repeat(WIKI_BODY_MAX + 1) }).success,
    ).toBe(false);
    expect(WikiWriteInputSchema.safeParse({ title: "!!", body: "text" }).success).toBe(false);
    // 0 means "this page must not exist yet", the way a new page is written; negatives are nonsense.
    expect(
      WikiWriteInputSchema.safeParse({ title: "A", body: "t", expectedRevision: 0 }).success,
    ).toBe(true);
    expect(
      WikiWriteInputSchema.safeParse({ title: "A", body: "t", expectedRevision: -1 }).success,
    ).toBe(false);
    expect(WIKI_BODY_MAX).toBe(200_000);
  });
});

describe("wiki curator contracts", () => {
  const change = {
    id: "chg1",
    state: "pending",
    reason: "A decision about the lobby",
    sourceTitle: "Kickoff call",
    pages: [
      { title: "Alpha Builders", op: "create" },
      { title: "Plan", op: "replace" },
    ],
    createdAt: "2026-11-04T10:00:00.000Z",
    edits: [
      { title: "Alpha Builders", op: "create", added: "Chosen for the lobby." },
      { title: "Plan", op: "replace", removed: "planning", added: "building" },
    ],
    canSeeSource: true,
    sourceText: "We are going with Alpha Builders.",
  };

  it("says what each operation would write, so it can be read before approving", () => {
    expect(WikiChangeSchema.parse(change).edits).toHaveLength(2);
    expect(
      WikiChangeSchema.safeParse({ ...change, edits: [{ title: "A", op: "delete", added: "x" }] })
        .success,
    ).toBe(false);
    expect(WikiChangeSchema.safeParse({ ...change, edits: undefined }).success).toBe(false);
  });

  it("describes a change with its pages, its source and whether the reader may see it", () => {
    expect(WikiChangeSchema.parse(change)).toEqual(change);
    expect(
      WikiChangeSchema.parse({ ...change, canSeeSource: false, sourceText: undefined }),
    ).toBeTruthy();
    expect(WikiChangeSchema.safeParse({ ...change, state: "merged" }).success).toBe(false);
    expect(
      WikiChangeSchema.safeParse({ ...change, pages: [{ title: "A", op: "delete" }] }).success,
    ).toBe(false);
  });

  it("accepts only apply, refuse or undo, for a named change", () => {
    for (const decision of ["apply", "refuse", "undo"])
      expect(WikiChangeDecideInputSchema.safeParse({ changeId: "c", decision }).success).toBe(true);
    expect(
      WikiChangeDecideInputSchema.safeParse({ changeId: "c", decision: "delete" }).success,
    ).toBe(false);
    expect(WikiChangeDecideInputSchema.safeParse({ changeId: "", decision: "apply" }).success).toBe(
      false,
    );
  });

  it("holds two settings, each changeable on its own", () => {
    expect(WikiSettingsSchema.parse({ capture: true, edits: "approve" })).toBeTruthy();
    expect(WikiSettingsSchema.safeParse({ capture: true, edits: "never" }).success).toBe(false);
    expect(WikiSettingsPatchSchema.parse({ edits: "auto" })).toEqual({ edits: "auto" });
    expect(WikiSettingsPatchSchema.parse({})).toEqual({});
  });

  it("takes a switch that is on, off, or follows the conversation's kind", () => {
    for (const value of [true, false, null])
      expect(WikiCaptureValueSchema.safeParse(value).success).toBe(true);
    expect(WikiCaptureValueSchema.safeParse("on").success).toBe(false);
  });

  it("is a block that names its change and the pages it touches", () => {
    const block = { kind: "wiki_change", changeId: "chg1", pages: change.pages };
    expect(MessageBlock.parse(block)).toEqual(block);
    expect(MessageBlock.safeParse({ kind: "wiki_change", pages: [] }).success).toBe(false);
  });

  it("reads a conversation's switch as stored and as it comes to", () => {
    const state = { available: true, capture: null, on: false, canChange: true };
    expect(WikiCaptureStateSchema.parse(state)).toEqual(state);
    expect(
      WikiCaptureStateSchema.safeParse({ available: true, capture: null, on: false }).success,
    ).toBe(false);
  });

  it("says how many waiting changes applied and how many conflicted", () => {
    expect(WikiApplyAllResultSchema.parse({ applied: 2, conflicts: 1 })).toEqual({
      applied: 2,
      conflicts: 1,
    });
    expect(WikiApplyAllResultSchema.safeParse({ applied: 2 }).success).toBe(false);
  });
});
