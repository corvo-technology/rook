import { describe, expect, it } from "vitest";
import { ROOK_RING_DOT_COUNT, rookRingDots } from "./mascot-eyes.js";

describe("rookRingDots", () => {
  it("places eight dots evenly around the middle, the first at the top", () => {
    const dots = rookRingDots();
    expect(dots).toHaveLength(ROOK_RING_DOT_COUNT);
    expect(dots[0]).toEqual({ x: 50, y: 7 });
    expect(dots[2]).toEqual({ x: 93, y: 50 });
    for (const dot of dots) expect(Math.hypot(dot.x - 50, dot.y - 50)).toBeCloseTo(43, 1);
  });
});
