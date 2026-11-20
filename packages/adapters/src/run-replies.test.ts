import { describe, expect, it } from "vitest";
import { runAllowsSilentEmpty } from "./run-replies.js";

describe("runAllowsSilentEmpty", () => {
  it.each(["routine", "webhook", "reaction", "tickets"])(
    "lets a %s run end silently",
    (trigger) => {
      expect(runAllowsSilentEmpty(trigger)).toBe(true);
    },
  );

  it("keeps a person's own message answered", () => {
    expect(runAllowsSilentEmpty("user")).toBe(false);
  });
});
