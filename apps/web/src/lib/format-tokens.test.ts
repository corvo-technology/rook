import { describe, expect, it } from "vitest";
import { formatTokens } from "./format-tokens";

describe("formatTokens", () => {
  it("shortens thousands and millions", () => {
    expect(formatTokens(950, "en")).toBe("950");
    expect(formatTokens(54_300, "en")).toBe("54.3K");
    expect(formatTokens(1_250_000, "en")).toBe("1.3M");
  });
});
