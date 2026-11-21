import { describe, expect, it } from "vitest";
import { researchBlock, validResearchArgs } from "./research-service.js";

describe("validResearchArgs", () => {
  it("needs a question and takes a scope and a depth", () => {
    expect(validResearchArgs("research_start", { question: "Why?" })).toBe(true);
    expect(
      validResearchArgs("research_start", { question: "Why?", scope: "EU", depth: "deep" }),
    ).toBe(true);
    expect(validResearchArgs("research_start", {})).toBe(false);
    expect(validResearchArgs("research_start", { question: "  " })).toBe(false);
    expect(validResearchArgs("research_start", { question: "Why?", depth: "endless" })).toBe(false);
    expect(validResearchArgs("research_start", { question: "Why?", budget: 1 })).toBe(false);
  });

  it("takes an optional id for the status", () => {
    expect(validResearchArgs("research_status", {})).toBe(true);
    expect(validResearchArgs("research_status", { id: "r1" })).toBe(true);
    expect(validResearchArgs("research_status", { id: 4 })).toBe(false);
  });
});

describe("researchBlock", () => {
  it("shows the question and the state of the job", () => {
    expect(researchBlock({ id: "r1", question: "Why?", status: "running" })).toEqual({
      kind: "research",
      researchId: "r1",
      question: "Why?",
      status: "running",
    });
  });
});
