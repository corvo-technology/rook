import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_LAYOUT, moveCard, normalizeLayout, setCardHidden } from "./home-prefs";

describe("home layout", () => {
  it("drops unknown cards and appends forgotten ones", () => {
    expect(
      normalizeLayout({ order: ["routines", "x", "routines"], hidden: ["waiting", 3] }),
    ).toEqual({
      order: ["routines", "waiting", "working"],
      hidden: ["waiting"],
    });
    expect(normalizeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT);
  });

  it("moves a card among the shown ones and stops at the ends", () => {
    const hidden = setCardHidden(DEFAULT_HOME_LAYOUT, "working", true);
    expect(moveCard(hidden, "routines", -1).order).toEqual(["routines", "working", "waiting"]);
    expect(moveCard(DEFAULT_HOME_LAYOUT, "waiting", -1)).toBe(DEFAULT_HOME_LAYOUT);
  });

  it("hides and restores a card", () => {
    const hidden = setCardHidden(DEFAULT_HOME_LAYOUT, "waiting", true);
    expect(hidden.hidden).toEqual(["waiting"]);
    expect(setCardHidden(hidden, "waiting", false).hidden).toEqual([]);
  });
});
