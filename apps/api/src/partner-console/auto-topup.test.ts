import type { AutoTopupDue } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { AutoTopupDeps } from "./auto-topup.js";
import { runAutoTopups } from "./auto-topup.js";

const NOW = new Date("2026-11-18T12:00:00Z");
const due = (attempt: number): AutoTopupDue => ({
  attemptId: "attempt-1",
  partnerId: "partner-1",
  amountMinor: 5000,
  attempt,
});

function setup(claimed: AutoTopupDue[], start: AutoTopupDeps["start"]) {
  const audit = vi.fn(async () => undefined);
  const fail = vi.fn(async () => undefined);
  const deps: AutoTopupDeps = {
    now: () => NOW,
    claim: async () => claimed,
    fail,
    start,
    audit,
  };
  return { deps, audit, fail };
}

describe("auto top-up", () => {
  it("starts the top-up through billing and audits it", async () => {
    const start = vi.fn(async () => undefined);
    const { deps, audit, fail } = setup([due(1)], start);
    expect(await runAutoTopups(deps)).toBe(1);
    expect(start).toHaveBeenCalledWith(due(1));
    expect(fail).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith({
      partnerId: "partner-1",
      kind: "credit.autotopup_started",
      detail: { amountMinor: 5000, attempt: 1 },
    });
  });

  it("records a failure for backoff and audits it, without starting anything", async () => {
    const { deps, audit, fail } = setup([due(2)], async () => {
      throw new Error("billing is down");
    });
    expect(await runAutoTopups(deps)).toBe(0);
    expect(fail).toHaveBeenCalledWith("attempt-1", NOW);
    expect(audit).toHaveBeenCalledWith({
      partnerId: "partner-1",
      kind: "credit.autotopup_failed",
      detail: { amountMinor: 5000, attempt: 2, final: false },
    });
  });

  it("marks the last attempt as final", async () => {
    const { deps, audit } = setup([due(6)], async () => {
      throw new Error("billing is down");
    });
    await runAutoTopups(deps);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.objectContaining({ final: true }) }),
    );
  });

  it("does nothing when no crossing is owed, so a repeat run starts nothing", async () => {
    const start = vi.fn(async () => undefined);
    const { deps } = setup([], start);
    expect(await runAutoTopups(deps)).toBe(0);
    expect(start).not.toHaveBeenCalled();
  });
});
