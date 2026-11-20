import { describe, expect, it } from "vitest";
import {
  TOOL_CLASSIFIER_EXAMPLES,
  TOOL_CLASSIFIER_EXAMPLES_VERSION,
} from "./tool-classifier-examples.js";
import { classifyConnectorTool } from "./tool-risk.js";

describe("tool classifier examples", () => {
  it("are a versioned, reviewed set with unique ids covering every outcome", () => {
    expect(TOOL_CLASSIFIER_EXAMPLES_VERSION).toBe("tool-risk-examples-v1");
    const ids = TOOL_CLASSIFIER_EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const expected of ["read", "low", "high", "unknown"] as const) {
      expect(TOOL_CLASSIFIER_EXAMPLES.some((example) => example.expected === expected)).toBe(true);
    }
    expect(TOOL_CLASSIFIER_EXAMPLES.filter((example) => !example.shot).length).toBeGreaterThan(10);
    for (const example of TOOL_CLASSIFIER_EXAMPLES) {
      expect(example.why.trim()).not.toBe("");
      expect(example.description.trim()).not.toBe("");
    }
  });

  it("only holds tools the name check cannot place, so the classifier is what decides them", () => {
    for (const example of TOOL_CLASSIFIER_EXAMPLES) {
      expect(classifyConnectorTool(example.name), example.name).toBe("unknown");
    }
  });
});
