import type { ToolClassifierProvider } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import { StaticToolClassifier } from "../../../adapters/src/tool-classifier.js";
import {
  classifyToolOutcome,
  runToolClassifierCases,
  summarizeToolClassifier,
  TOOL_CLASSIFIER_EXAMPLES,
} from "./tool-classifier.js";

const answers = Object.fromEntries(
  TOOL_CLASSIFIER_EXAMPLES.filter((example) => example.expected !== "unknown").map((example) => [
    example.name,
    { risk: example.expected as "read" | "low" | "high", confidence: 0.95 },
  ]),
);

describe("classifyToolOutcome", () => {
  it("agrees on the reviewed answer, and treats an unsure answer as the cautious one", () => {
    expect(classifyToolOutcome("read", "read")).toBe("agree");
    expect(classifyToolOutcome("unknown", "unknown")).toBe("agree");
    expect(classifyToolOutcome("unknown", "high")).toBe("agree");
  });

  it("flags a promotion less careful than the reviewed answer as unsafe", () => {
    expect(classifyToolOutcome("high", "low")).toBe("unsafe");
    expect(classifyToolOutcome("high", "read")).toBe("unsafe");
    expect(classifyToolOutcome("unknown", "read")).toBe("unsafe");
    expect(classifyToolOutcome("low", "read")).toBe("unsafe");
  });

  it("calls a more careful answer cautious", () => {
    expect(classifyToolOutcome("read", "unknown")).toBe("cautious");
    expect(classifyToolOutcome("low", "high")).toBe("cautious");
  });
});

describe("runToolClassifierCases", () => {
  it("scores a classifier that follows the reviewed answers as fully in agreement", async () => {
    const results = await runToolClassifierCases(new StaticToolClassifier(answers), {
      trials: 1,
      timeoutMs: 1_000,
    });
    const summary = summarizeToolClassifier(results);
    expect(summary).toMatchObject({
      results: TOOL_CLASSIFIER_EXAMPLES.length,
      unsafe: 0,
      unqualified: 0,
    });
    expect(summary.heldOutAgreementRate).toBe(1);
    expect(summary.heldOut).toBeGreaterThan(10);
  });

  it("counts a confident read for a high-risk tool as an unsafe promotion", async () => {
    const results = await runToolClassifierCases(
      new StaticToolClassifier({ ...answers, email_blast: { risk: "read", confidence: 0.99 } }),
      { trials: 1, timeoutMs: 1_000 },
    );
    expect(results.find((r) => r.caseId === "email-blast")?.outcome).toBe("unsafe");
  });

  it("does not count a weak promotion, because the product ignores it", async () => {
    const results = await runToolClassifierCases(
      new StaticToolClassifier({ ...answers, email_blast: { risk: "read", confidence: 0.3 } }),
      { trials: 1, timeoutMs: 1_000 },
    );
    expect(results.find((r) => r.caseId === "email-blast")).toMatchObject({
      applied: "unknown",
      outcome: "agree",
    });
  });

  it("makes an error unqualified, never a pass", async () => {
    const failing: ToolClassifierProvider = new StaticToolClassifier(
      {},
      { fail: new Error("down") },
    );
    const results = await runToolClassifierCases(failing, { trials: 1, timeoutMs: 1_000 });
    expect(results.every((r) => r.outcome === "unqualified")).toBe(true);
    expect(summarizeToolClassifier(results).heldOutAgreementRate).toBe(0);
  });
});
