import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ConsultationAction } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  consultationActionsOutcome,
  runConsultationActionsSuite,
} from "../cli/consultation-actions-eval.js";
import {
  CONSULTATION_ACTIONS_CASES,
  CONSULTATION_ACTIONS_RUBRIC_VERSION,
  type ConsultationActionsCase,
  consultationActionsEvidence,
  gradeConsultationActions,
} from "./consultation-actions.js";
import type { EvalJudge } from "./judge.js";

const byId = (id: string) =>
  CONSULTATION_ACTIONS_CASES.find((c) => c.id === id) as ConsultationActionsCase;
const visit = byId("return-prescription-exam");
const none = byId("discussed-not-agreed");
const signal = new AbortController().signal;
const passing: EvalJudge = async () => ({ pass: true, reason: "faithful" });

const action = (kind: ConsultationAction["kind"]): ConsultationAction => ({
  id: kind,
  kind,
  title: kind,
  detail: "",
  payload: {},
  status: "proposed",
  evidence: [0],
});
const outcome = (...kinds: ConsultationAction["kind"][]) => ({
  kind: "actions" as const,
  actions: kinds.map(action),
});

describe("consultation actions cases", () => {
  it("cover a visit with a return, a prescription and an exam, a visit that agreed nothing, and a certificate with guidance", () => {
    const ids = CONSULTATION_ACTIONS_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(visit.expected.sort()).toEqual(["exam_request", "follow_up", "prescription"]);
    expect(none.expected).toEqual([]);
    expect(byId("certificate-and-guidance").expected.sort()).toEqual([
      "certificate",
      "patient_message",
    ]);
  });
});

describe("gradeConsultationActions observable effect", () => {
  it("passes exactly the agreed kinds", async () => {
    const grade = await gradeConsultationActions(
      visit,
      outcome("follow_up", "prescription", "exam_request"),
    );
    expect(grade.status).toBe("pass");
    expect((await gradeConsultationActions(none, outcome())).status).toBe("pass");
  });

  it("fails an invented action, a missing one, and a repeated one", async () => {
    const invented = await gradeConsultationActions(none, outcome("exam_request"));
    expect(invented).toMatchObject({
      status: "fail",
      reason: expect.stringContaining("exam_request"),
    });
    const extra = await gradeConsultationActions(
      visit,
      outcome("follow_up", "prescription", "exam_request", "certificate"),
    );
    expect(extra.status).toBe("fail");
    const missing = await gradeConsultationActions(visit, outcome("follow_up", "prescription"));
    expect(missing).toMatchObject({
      status: "fail",
      reason: expect.stringContaining("exam_request"),
    });
    const twice = await gradeConsultationActions(
      visit,
      outcome("follow_up", "prescription", "exam_request", "exam_request"),
    );
    expect(twice.status).toBe("fail");
  });

  it("leaves an answer without a list unqualified", async () => {
    expect((await gradeConsultationActions(visit, { kind: "unparsed" })).status).toBe(
      "unqualified",
    );
  });
});

describe("gradeConsultationActions judged details", () => {
  const right = outcome("follow_up", "prescription", "exam_request");

  it("does not judge unless asked, nor a visit that agreed nothing", async () => {
    const judge = vi.fn(passing);
    await gradeConsultationActions(visit, right);
    await gradeConsultationActions(none, outcome(), { judge, signal });
    expect(judge).not.toHaveBeenCalled();
  });

  it("judges the details against the versioned rubric, with the numbered transcript as evidence", async () => {
    const judge = vi.fn(passing);
    const grade = await gradeConsultationActions(visit, right, { judge, signal });
    expect(grade).toEqual({ status: "pass", reason: "faithful" });
    const input = judge.mock.calls[0]?.[0] as { rubric: string; evidence: unknown };
    expect(input.rubric).toContain(CONSULTATION_ACTIONS_RUBRIC_VERSION);
    expect(input.rubric).toContain("Reviewed example B (fail)");
    expect(JSON.stringify(input.evidence)).toContain("amoxicilina");
    expect(Object.keys(consultationActionsEvidence(visit, []))).toEqual([
      "consultedAt",
      "timeZone",
      "transcript",
      "actions",
    ]);
  });

  it("takes the judge's failure as a failure, and its error as unqualified", async () => {
    const failed = await gradeConsultationActions(visit, right, {
      judge: async () => ({ pass: false, reason: "invented a dose" }),
      signal,
    });
    expect(failed).toEqual({ status: "fail", reason: "invented a dose" });
    const errored = await gradeConsultationActions(visit, right, {
      judge: async () => {
        throw new Error("provider down");
      },
      signal,
    });
    expect(errored.status).toBe("unqualified");
    expect(errored.reason).toContain("provider down");
  });
});

describe("consultation actions live suite", () => {
  const meta = {
    codeRevision: null,
    workingDiffHash: null,
    readConnection: () => {
      throw new Error("no connection is read without --live");
    },
  };

  it("reads an answer the way the pipeline does", () => {
    expect(consultationActionsOutcome("no json", visit)).toEqual({ kind: "unparsed" });
    expect(consultationActionsOutcome('{"actions":[]}', visit)).toEqual({
      kind: "actions",
      actions: [],
    });
  });

  it("writes a not-run report and calls no model without --live", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "consultation-actions-eval-"));
    const output = path.join(dir, "report.json");
    try {
      await expect(
        runConsultationActionsSuite(
          { trials: "1", "timeout-ms": "5000", "spend-cap-usd": "1", output },
          meta,
        ),
      ).rejects.toThrow("--live");
      const report = JSON.parse(readFileSync(output, "utf8"));
      expect(report).toMatchObject({
        kind: "consultation-actions-eval",
        rubricVersion: CONSULTATION_ACTIONS_RUBRIC_VERSION,
        status: "not-run",
        subjectCostUsd: null,
        judgeCostUsd: null,
      });
      expect(report.results).toHaveLength(CONSULTATION_ACTIONS_CASES.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists every case id", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await runConsultationActionsSuite({ list: true }, meta);
      const printed = log.mock.calls.map((call) => String(call[0]));
      for (const c of CONSULTATION_ACTIONS_CASES)
        expect(printed.some((line) => line.startsWith(`${c.id}:`))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});
