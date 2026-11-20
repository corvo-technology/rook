import { describe, expect, it } from "vitest";
import type { BranchRow } from "./thread-branches.js";
import { branchSegments, visibleMessageFilter } from "./thread-branches.js";

const at = new Date("2026-01-01T00:00:00Z");
const branch = (id: string, parentBranchId: string | null, forkSeq: number): BranchRow => ({
  id,
  parentBranchId,
  forkSeq,
  createdAt: at,
});

describe("branchSegments", () => {
  it("is the whole original line when no branch is active", () => {
    expect(branchSegments([branch("a", null, 3)], null)).toEqual([
      { branchId: null, maxSeq: null },
    ]);
  });

  it("keeps the parent's messages only up to where the branch left it", () => {
    const branches = [branch("a", null, 3), branch("b", "a", 7)];
    expect(branchSegments(branches, "b")).toEqual([
      { branchId: "b", maxSeq: null },
      { branchId: "a", maxSeq: 7 },
      { branchId: null, maxSeq: 3 },
    ]);
  });

  it("never lets a deeper fork widen what an outer one cut off", () => {
    const branches = [branch("a", null, 3), branch("b", "a", 1)];
    expect(branchSegments(branches, "b")).toEqual([
      { branchId: "b", maxSeq: null },
      { branchId: "a", maxSeq: 1 },
      { branchId: null, maxSeq: 1 },
    ]);
  });

  it("falls back to the original line when a branch is missing", () => {
    expect(branchSegments([], "gone")).toEqual([{ branchId: null, maxSeq: null }]);
  });
});

describe("visibleMessageFilter", () => {
  it("adds no condition to a thread that never branched", () => {
    expect(visibleMessageFilter([{ branchId: null, maxSeq: null }], false)).toEqual({});
  });

  it("matches each stretch of the line by branch and seq", () => {
    expect(
      visibleMessageFilter(
        [
          { branchId: "a", maxSeq: null },
          { branchId: null, maxSeq: 4 },
        ],
        true,
      ),
    ).toEqual({ OR: [{ branchId: "a" }, { branchId: null, seq: { lte: 4 } }] });
  });
});
