import { describe, expect, it } from "vitest";
import { SpaceGroupSchema } from "./index.js";

const group = {
  id: "g1",
  spaceId: "s1",
  name: "Finance",
  pinned: false,
  sectionId: null,
  members: [{ botId: "b1", name: "Ledger", color: "#10B981" }],
  preview: "",
  unread: false,
  updatedAt: "2026-11-04T00:00:00.000Z",
};

describe("a group as the space lists it", () => {
  it("carries the purpose the Chief reads to route work", () => {
    expect(
      SpaceGroupSchema.parse({ ...group, purpose: "Invoices, cash flow and payroll" }),
    ).toMatchObject({
      purpose: "Invoices, cash flow and payroll",
    });
  });

  it("has no purpose when a server older than this field does not send one", () => {
    expect(SpaceGroupSchema.parse(group).purpose).toBeNull();
  });
});

describe("a group's wiki switch in the space listing", () => {
  it("carries on, off or the default, and none from an older server", () => {
    expect(SpaceGroupSchema.parse({ ...group, wikiCapture: true }).wikiCapture).toBe(true);
    expect(SpaceGroupSchema.parse({ ...group, wikiCapture: null }).wikiCapture).toBeNull();
    expect(SpaceGroupSchema.parse(group).wikiCapture).toBeUndefined();
  });
});
