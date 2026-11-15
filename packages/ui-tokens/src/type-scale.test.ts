import { describe, expect, it } from "vitest";
import { typeScale, webTypeScale } from "./index.js";

describe("typeScale", () => {
  it("gives every style a line height at least as tall as its text", () => {
    for (const style of Object.values(typeScale)) {
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize);
    }
  });
});

describe("webTypeScale", () => {
  it("keeps a line at least as tall as its text and meta smaller than body", () => {
    for (const style of Object.values(webTypeScale)) {
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize);
    }
    expect(webTypeScale.meta.fontSize).toBeLessThan(webTypeScale.message.fontSize);
    expect(webTypeScale.message.fontSize).toBeLessThanOrEqual(15);
  });
});
