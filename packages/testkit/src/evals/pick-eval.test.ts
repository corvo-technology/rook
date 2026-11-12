import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runAvatarPieceSuite, runChannelRouterSuite } from "../cli/pick-eval.js";
import { AVATAR_PIECE_CASES } from "./avatar-piece.js";
import { CHANNEL_ROUTER_CASES } from "./channel-router.js";

const meta = { codeRevision: null, workingDiffHash: null, readConnection: () => ({}) };
const suites = [
  {
    name: "channel router",
    run: runChannelRouterSuite,
    kind: "channel-router-eval",
    cases: CHANNEL_ROUTER_CASES,
  },
  {
    name: "avatar piece",
    run: runAvatarPieceSuite,
    kind: "avatar-piece-eval",
    cases: AVATAR_PIECE_CASES,
  },
] as const;

describe.each(suites)("$name suite", ({ run, kind, cases }) => {
  it("writes a not-run report and calls no model without --live", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pick-eval-"));
    const output = path.join(dir, "report.json");
    try {
      await expect(
        run({ trials: "1", "timeout-ms": "5000", "spend-cap-usd": "1", output }, meta),
      ).rejects.toThrow("--live");
      const report = JSON.parse(readFileSync(output, "utf8"));
      expect(report).toMatchObject({
        kind,
        status: "not-run",
        subjectCostUsd: null,
        judgeCostUsd: null,
      });
      expect(report.results).toHaveLength(cases.length);
      expect(report.results.every((r: { status: string }) => r.status === "not-run")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists every case id", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await run({ list: true }, meta);
      const printed = log.mock.calls.map((call) => String(call[0]));
      for (const c of cases) expect(printed.some((line) => line.startsWith(`${c.id}:`))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});
