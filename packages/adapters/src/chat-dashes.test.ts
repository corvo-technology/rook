import { describe, expect, it } from "vitest";
import { replaceSpacedDashes } from "./chat-dashes.js";

describe("replaceSpacedDashes", () => {
  it("turns a spaced em dash into a comma", () => {
    expect(replaceSpacedDashes("Que bom ter você aqui — vamos ajudar.")).toBe(
      "Que bom ter você aqui, vamos ajudar.",
    );
  });

  it("handles en dashes and several dashes", () => {
    expect(replaceSpacedDashes("a — b – c — d")).toBe("a, b, c, d");
  });

  it("leaves unspaced dashes such as ranges alone", () => {
    expect(replaceSpacedDashes("pages 10–20 and a—b")).toBe("pages 10–20 and a—b");
  });

  it("leaves fenced and inline code alone", () => {
    const text = "run `a — b` now — ok\n```\nx — y\n```\nthen — done";
    expect(replaceSpacedDashes(text)).toBe("run `a — b` now, ok\n```\nx — y\n```\nthen, done");
  });

  it("leaves an unclosed fence alone", () => {
    expect(replaceSpacedDashes("hi — there\n```\nx — y")).toBe("hi, there\n```\nx — y");
  });

  it("leaves table cells and list markers alone", () => {
    const text = "| a | — |\n— item";
    expect(replaceSpacedDashes(text)).toBe(text);
  });
});
