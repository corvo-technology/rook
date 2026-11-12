import type { WikiChangeRecord } from "@corvo/db";
import { describe, expect, it } from "vitest";
import { wikiChangeView } from "./routes/wiki.js";

const record: WikiChangeRecord = {
  id: "chg1",
  state: "pending",
  reason: "A contractor was chosen",
  pages: [{ title: "Alpha Builders", op: "create" }],
  edits: [{ title: "Alpha Builders", op: "create", added: "Chosen for the lobby." }],
  createdAt: new Date("2026-11-04T10:00:00.000Z"),
  anchorThreadId: "thread-1",
  anchorMessageId: null,
  sourceTitle: "Lobby renovation",
  sourceText: "Ana: we are going with Alpha Builders. Her number is private.",
  sourceUserId: "owner",
  review: false,
};

describe("what a reader is shown of a change's source", () => {
  it("quotes the conversation, as it was said, to the person whose conversation it was", () => {
    expect(wikiChangeView(record, "owner")).toEqual({
      id: "chg1",
      state: "pending",
      review: false,
      reason: "A contractor was chosen",
      sourceTitle: "Lobby renovation",
      pages: [{ title: "Alpha Builders", op: "create" }],
      edits: [{ title: "Alpha Builders", op: "create", added: "Chosen for the lobby." }],
      createdAt: "2026-11-04T10:00:00.000Z",
      canSeeSource: true,
      sourceText: "Ana: we are going with Alpha Builders. Her number is private.",
    });
  });

  it("shows anyone else the pages and what would be written, and nothing said in the conversation", () => {
    const view = wikiChangeView(record, "colleague");
    expect(view.canSeeSource).toBe(false);
    expect(view).not.toHaveProperty("sourceText");
    expect(JSON.stringify(view)).not.toContain("number is private");
    // The title and the reason are the model's summary of the conversation, so they are not shared.
    expect(view.sourceTitle).toBe("");
    expect(view.reason).toBe("");
    expect(view.pages).toEqual([{ title: "Alpha Builders", op: "create" }]);
    expect(view.edits).toEqual([
      { title: "Alpha Builders", op: "create", added: "Chosen for the lobby." },
    ]);
  });

  it("shows every member what the review found, since it is about the pages and not a conversation", () => {
    const found = {
      ...record,
      review: true,
      sourceTitle: "Two pages disagree",
      reason: "Alpha says A.",
    };
    const view = wikiChangeView(found, "colleague");
    expect(view).toMatchObject({
      review: true,
      sourceTitle: "Two pages disagree",
      reason: "Alpha says A.",
      canSeeSource: false,
    });
    expect(view).not.toHaveProperty("sourceText");
  });
});
