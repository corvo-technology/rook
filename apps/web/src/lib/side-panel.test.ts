import { expect, it } from "vitest";
import { parseSidePanel, sidePanelValue } from "./side-panel";

it("splits a panel value into its kind and object id", () => {
  expect(parseSidePanel(null)).toBeNull();
  expect(parseSidePanel("new-routine")).toEqual({ kind: "new-routine", id: null });
  expect(parseSidePanel("bot:abc:1")).toEqual({ kind: "bot", id: "abc:1" });
  expect(parseSidePanel("bot:")).toEqual({ kind: "bot", id: null });
});

it("builds the value the URL carries", () => {
  expect(sidePanelValue("bot", "abc")).toBe("bot:abc");
  expect(sidePanelValue("new-routine")).toBe("new-routine");
});
