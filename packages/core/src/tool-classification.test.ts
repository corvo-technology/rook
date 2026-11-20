import { describe, expect, it } from "vitest";
import type { ToolClassification } from "./tool-classification.js";
import { applyToolClassification, MIN_CLASSIFICATION_CONFIDENCE } from "./tool-classification.js";
import type { ToolRisk } from "./tool-risk.js";

const sure = (risk: ToolClassification["risk"]): ToolClassification => ({ risk, confidence: 0.95 });

describe("applyToolClassification", () => {
  it("promotes an unknown tool to read, low or high", () => {
    expect(applyToolClassification("unknown", sure("read"))).toBe("read");
    expect(applyToolClassification("unknown", sure("low"))).toBe("low");
    expect(applyToolClassification("unknown", sure("high"))).toBe("high");
  });

  it("never lowers a locked or hinted-high tool, nor changes a read or low one", () => {
    for (const base of ["high", "read", "low"] as ToolRisk[]) {
      for (const risk of ["read", "low", "high"] as const) {
        expect(applyToolClassification(base, sure(risk))).toBe(base);
      }
    }
  });

  it("keeps unknown for a missing, weak or malformed suggestion", () => {
    expect(applyToolClassification("unknown", null)).toBe("unknown");
    expect(applyToolClassification("unknown", undefined)).toBe("unknown");
    expect(
      applyToolClassification("unknown", {
        risk: "read",
        confidence: MIN_CLASSIFICATION_CONFIDENCE - 0.01,
      }),
    ).toBe("unknown");
    expect(applyToolClassification("unknown", { risk: "read", confidence: Number.NaN })).toBe(
      "unknown",
    );
    expect(applyToolClassification("unknown", { risk: "safe" as never, confidence: 1 })).toBe(
      "unknown",
    );
  });

  it("does not make a tool its server declared a write into a read", () => {
    expect(applyToolClassification("unknown", sure("read"), { readOnly: false })).toBe("unknown");
    expect(applyToolClassification("unknown", sure("low"), { readOnly: false })).toBe("low");
  });
});
