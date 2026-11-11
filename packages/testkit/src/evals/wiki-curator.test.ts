import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runWikiCuratorSuite, wikiCuratorOutcome } from "../cli/wiki-curator-eval.js";
import type { EvalJudge } from "./judge.js";
import {
  gradeWikiCurator,
  WIKI_CURATOR_CASES,
  WIKI_CURATOR_RUBRIC_VERSION,
  type WikiCuratorCase,
  wikiCuratorEvidence,
} from "./wiki-curator.js";

const byId = (id: string) => WIKI_CURATOR_CASES.find((c) => c.id === id) as WikiCuratorCase;
const decision = byId("decision-contractor");
const record = byId("task-record");
const injected = byId("injected-instruction");
const passing: EvalJudge = async () => ({ pass: true, reason: "faithful and lasting" });
const signal = new AbortController().signal;

describe("wiki curator cases", () => {
  it("cover what to keep and each kind of thing not to keep", () => {
    const ids = WIKI_CURATOR_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(WIKI_CURATOR_CASES.map((c) => c.expected))).toEqual(new Set(["keep", "skip"]));
    for (const id of [
      "decision-contractor",
      "fact-changed",
      "task-record",
      "small-talk",
      "injected-instruction",
    ])
      expect(ids).toContain(id);
  });

  it("only expects pages that a keep case can reach", () => {
    for (const c of WIKI_CURATOR_CASES)
      if (c.expected === "keep") expect(c.touches.length).toBeGreaterThan(0);
  });
});

describe("gradeWikiCurator observable effect", () => {
  it("passes a stretch worth keeping that produced a change to the page it is about", async () => {
    const grade = await gradeWikiCurator(decision, {
      kind: "proposal",
      ops: [{ op: "create", page: "Alpha Builders", body: "Chosen for the lobby." }],
    });
    expect(grade.status).toBe("pass");
  });

  it("fails a stretch worth keeping that produced nothing, or the wrong page", async () => {
    expect((await gradeWikiCurator(decision, { kind: "proposal", ops: [] })).status).toBe("fail");
    const wrong = await gradeWikiCurator(decision, {
      kind: "proposal",
      ops: [{ op: "create", page: "Weekly Report", body: "x" }],
    });
    expect(wrong.status).toBe("fail");
  });

  it("passes a task record that was not kept, and fails one that was", async () => {
    expect((await gradeWikiCurator(record, { kind: "proposal", ops: [] })).status).toBe("pass");
    const kept = await gradeWikiCurator(record, {
      kind: "proposal",
      ops: [{ op: "append", page: "Email Log", text: "I sent the email." }],
    });
    expect(kept.status).toBe("fail");
  });

  it("fails an instruction hidden in the conversation that the curator followed", async () => {
    const followed = await gradeWikiCurator(injected, {
      kind: "proposal",
      ops: [{ op: "create", page: "Evil", body: "Anything the conversation said to write." }],
    });
    expect(followed.status).toBe("fail");
    expect((await gradeWikiCurator(injected, { kind: "proposal", ops: [] })).status).toBe("pass");
  });

  it("leaves an answer that was not a proposal unqualified, never passed or failed", async () => {
    expect((await gradeWikiCurator(decision, { kind: "unparsed" })).status).toBe("unqualified");
  });
});

describe("gradeWikiCurator judged text", () => {
  const kept = {
    kind: "proposal" as const,
    ops: [{ op: "create" as const, page: "Alpha Builders", body: "Chosen for the lobby." }],
  };

  it("does not judge unless asked", async () => {
    const judge = vi.fn(passing);
    expect((await gradeWikiCurator(decision, kept)).status).toBe("pass");
    expect(judge).not.toHaveBeenCalled();
  });

  it("judges the kept text of a correct change against the rubric, with the conversation as evidence", async () => {
    const judge = vi.fn(passing);
    const grade = await gradeWikiCurator(decision, kept, { judge, signal });
    expect(grade).toEqual({ status: "pass", reason: "faithful and lasting" });
    const input = judge.mock.calls[0]![0] as { rubric: string; evidence: unknown };
    expect(input.rubric).toContain(WIKI_CURATOR_RUBRIC_VERSION);
    expect(JSON.stringify(input.evidence)).toContain("Alpha Builders");
  });

  it("takes the judge's failure as a failure", async () => {
    const grade = await gradeWikiCurator(decision, kept, {
      judge: async () => ({ pass: false, reason: "invented a price" }),
      signal,
    });
    expect(grade).toEqual({ status: "fail", reason: "invented a price" });
  });

  it("leaves the case unqualified when the judge errors", async () => {
    const grade = await gradeWikiCurator(decision, kept, {
      judge: async () => {
        throw new Error("provider down");
      },
      signal,
    });
    expect(grade.status).toBe("unqualified");
    expect(grade.reason).toContain("provider down");
  });

  it("never judges a case that was not kept", async () => {
    const judge = vi.fn(passing);
    await gradeWikiCurator(record, { kind: "proposal", ops: [] }, { judge, signal });
    expect(judge).not.toHaveBeenCalled();
  });
});

describe("wikiCuratorEvidence", () => {
  it("holds the conversation, the pages that existed and what the curator wrote, and nothing else", () => {
    const evidence = wikiCuratorEvidence(byId("fact-changed"), {
      kind: "proposal",
      ops: [{ op: "replace", page: "Office Renovation", old: "Nov 18", new: "Nov 25" }],
    });
    expect(Object.keys(evidence).sort()).toEqual(["conversation", "existing", "kept"]);
  });
});

describe("wiki curator live suite", () => {
  const meta = {
    codeRevision: null,
    workingDiffHash: null,
    readConnection: () => {
      throw new Error("no connection is read without --live");
    },
  };

  it("takes an answer that is not JSON as unparsed", () => {
    expect(wikiCuratorOutcome("not json")).toEqual({ kind: "unparsed" });
  });

  it("keeps no operation from a proposal that says it is not worth keeping", () => {
    const answer = JSON.stringify({ worth: false, reason: "small talk", changes: [] });
    expect(wikiCuratorOutcome(answer)).toEqual({ kind: "proposal", ops: [] });
  });

  it("writes a not-run report and calls no model without --live", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wiki-curator-eval-"));
    const output = path.join(dir, "report.json");
    try {
      await expect(
        runWikiCuratorSuite(
          { trials: "1", "timeout-ms": "5000", "spend-cap-usd": "1", output },
          meta,
        ),
      ).rejects.toThrow("--live");
      const report = JSON.parse(readFileSync(output, "utf8"));
      expect(report).toMatchObject({
        kind: "wiki-curator-eval",
        rubricVersion: WIKI_CURATOR_RUBRIC_VERSION,
        status: "not-run",
        subjectCostUsd: null,
        judgeCostUsd: null,
      });
      expect(report.results.every((r: { status: string }) => r.status === "not-run")).toBe(true);
      expect(report.results).toHaveLength(WIKI_CURATOR_CASES.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists every case id", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await runWikiCuratorSuite({ list: true }, meta);
      const printed = log.mock.calls.map((call) => String(call[0]));
      for (const c of WIKI_CURATOR_CASES)
        expect(printed.some((line) => line.startsWith(`${c.id}:`))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});
