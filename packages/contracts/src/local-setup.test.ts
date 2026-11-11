import { describe, expect, it } from "vitest";
import {
  DISABLED_LOCAL_SETUP,
  LocalModelOptionSchema,
  LocalModelTestSchema,
  LocalSetupReportSchema,
} from "./local-setup.js";

const option = {
  id: "server:11434",
  kind: "server" as const,
  label: "Ollama",
  provider: "openai-compatible",
  models: ["fake-model"],
  modelId: "fake-model",
  backgroundModelId: null,
  testable: true,
};

describe("local setup contracts", () => {
  it("parses a report with one server option", () => {
    const report = { enabled: true, checking: false, checkedAt: 5, options: [option] };
    expect(LocalSetupReportSchema.parse(report)).toEqual(report);
  });

  it("rejects an option id longer than 200 characters", () => {
    expect(LocalModelOptionSchema.safeParse({ ...option, id: "x".repeat(201) }).success).toBe(
      false,
    );
  });

  it("a failed test result requires error", () => {
    expect(LocalModelTestSchema.safeParse({ ok: false, ms: 3 }).success).toBe(false);
    expect(LocalModelTestSchema.safeParse({ ok: true, ms: 3 }).success).toBe(true);
  });

  it("DISABLED_LOCAL_SETUP has no options and is not checking", () => {
    expect(DISABLED_LOCAL_SETUP).toEqual({
      enabled: false,
      checking: false,
      checkedAt: null,
      options: [],
    });
  });
});
