import { describe, expect, it } from "vitest";
import { loadJsdom } from "./jsdom.js";

describe("loadJsdom", () => {
  it("loads jsdom once and hands every caller the same module", async () => {
    const first = loadJsdom();
    expect(loadJsdom()).toBe(first);
    const { JSDOM } = await first;
    expect(new JSDOM("<p>hi</p>").window.document.body.textContent).toBe("hi");
  });
});
