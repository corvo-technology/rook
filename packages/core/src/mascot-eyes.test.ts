import { describe, expect, it } from "vitest";
import { mascotMood, ROOK_RING_DOT_COUNT, rookRingDots } from "./mascot-eyes.js";

describe("mascotMood", () => {
  it("is thinking while a run is queued, starting or running", () => {
    for (const status of ["queued", "leased", "running"]) {
      expect(mascotMood(status, false)).toBe("thinking");
    }
  });

  it("is alert when it waits for the person, and failed after a failure", () => {
    expect(mascotMood("waiting_input", false)).toBe("alert");
    expect(mascotMood("waiting_takeover", false)).toBe("alert");
    expect(mascotMood("failed", false)).toBe("failed");
  });

  it("is happy for a moment after work finished, and otherwise at ease", () => {
    expect(mascotMood("idle", true)).toBe("happy");
    expect(mascotMood("idle", false)).toBe("idle");
    expect(mascotMood(undefined, false)).toBe("idle");
    // Still working or failing is not a happy moment, whatever else is true.
    expect(mascotMood("running", true)).toBe("thinking");
    expect(mascotMood("failed", true)).toBe("failed");
  });
});

describe("the rook's eyes", () => {
  it("asleep is its own mood, and only a status of asleep gets it", () => {
    expect(mascotMood("asleep", false)).toBe("asleep");
    expect(mascotMood("asleep", true)).toBe("asleep");
  });
});

describe("rookRingDots", () => {
  it("places eight dots evenly around the middle, the first at the top", () => {
    const dots = rookRingDots();
    expect(dots).toHaveLength(ROOK_RING_DOT_COUNT);
    expect(dots[0]).toEqual({ x: 50, y: 7 });
    expect(dots[2]).toEqual({ x: 93, y: 50 });
    for (const dot of dots) expect(Math.hypot(dot.x - 50, dot.y - 50)).toBeCloseTo(43, 1);
  });
});
