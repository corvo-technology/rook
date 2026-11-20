import { describe, expect, it } from "vitest";
import {
  approvalModeSummary,
  approvalOutcomes,
  effectiveApprovalMode,
  storedBotApprovalMode,
} from "./approval-level.js";

const A = "allow";
const K = "ask";
const J = "judge";
const D = "deny";
// read, change, lowRiskChange, allowedChange, askRuleChange, blockedChange, securityChange,
// steeredSecurityChange, steeredSecurityChangeNobodyThere, newSite, steeredRead
const TABLE = [
  ["always", true, [A, K, K, A, K, D, K, K, K, K, A]],
  ["always", false, [A, K, K, A, K, D, K, K, K, K, A]],
  ["risky", true, [A, K, A, A, K, D, K, K, K, K, A]],
  ["risky", false, [A, K, A, A, K, D, K, K, K, K, A]],
  ["auto", true, [A, J, J, A, K, D, K, K, K, J, J]],
  ["auto", false, [A, K, K, A, K, D, K, K, K, K, A]],
  ["never", true, [A, A, A, A, A, D, A, K, D, A, A]],
  ["never", false, [A, A, A, A, A, D, A, K, D, A, A]],
] as const;

describe("approval levels", () => {
  it.each(TABLE)("%s (checker %s) decides every situation", (mode, checkerConfigured, row) => {
    expect(Object.values(approvalOutcomes({ mode, checkerConfigured }))).toEqual(row);
  });

  it("summarises each level from the gate's own verdicts", () => {
    expect(approvalModeSummary({ mode: "always", checkerConfigured: true })).toBe("every_change");
    expect(approvalModeSummary({ mode: "risky", checkerConfigured: true })).toBe("risky_only");
    expect(approvalModeSummary({ mode: "auto", checkerConfigured: true })).toBe("reviewed");
    expect(approvalModeSummary({ mode: "auto", checkerConfigured: false })).toBe("every_change");
    expect(approvalModeSummary({ mode: "never", checkerConfigured: true })).toBe("steered_only");
  });

  it("keeps each summary true to the table", () => {
    for (const [mode, checkerConfigured] of TABLE) {
      const o = approvalOutcomes({ mode, checkerConfigured });
      const s = approvalModeSummary({ mode, checkerConfigured });
      expect(o.read).toBe("allow");
      expect(o.blockedChange).toBe("deny");
      expect(o.allowedChange).toBe("allow");
      if (s === "every_change") {
        expect([o.change, o.newSite, o.securityChange]).toEqual(["ask", "ask", "ask"]);
      }
      if (s === "risky_only") {
        expect([o.change, o.lowRiskChange, o.newSite, o.securityChange]).toEqual([
          "ask",
          "allow",
          "ask",
          "ask",
        ]);
      }
      if (s === "reviewed") {
        expect([o.change, o.newSite, o.securityChange]).toEqual(["judge", "judge", "ask"]);
      }
      if (s === "steered_only") {
        expect(
          Object.entries(o)
            .filter(([, v]) => v === "ask")
            .map(([k]) => k),
        ).toEqual(["steeredSecurityChange"]);
      }
    }
  });

  it("resolves a bot's own mode over the default and fails closed on junk", () => {
    expect(effectiveApprovalMode(null, "auto")).toBe("auto");
    expect(effectiveApprovalMode(undefined, "never")).toBe("never");
    expect(effectiveApprovalMode("always", "never")).toBe("always");
    expect(effectiveApprovalMode("risky", "never")).toBe("risky");
    expect(effectiveApprovalMode("never", "risky")).toBe("never");
    expect(effectiveApprovalMode("free", "never")).toBe("always");
    expect(effectiveApprovalMode("", "never")).toBe("always");
  });

  it("reads a stored Ask as Only what's risky", () => {
    expect(effectiveApprovalMode("ask", "never")).toBe("risky");
    expect(effectiveApprovalMode("ask", "auto")).toBe("risky");
  });

  it("stores nothing when the choice is the default", () => {
    expect(storedBotApprovalMode("auto", "auto")).toBeNull();
    expect(storedBotApprovalMode("never", "auto")).toBe("never");
  });
});
