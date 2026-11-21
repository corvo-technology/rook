import { describe, expect, it } from "vitest";
import { DEFAULT_QUIET_HOURS, dateToMinutes, minutesToDate } from "./quiet-hours";

describe("quiet hours", () => {
  it("defaults to 22:00 to 08:00, on", () => {
    expect(DEFAULT_QUIET_HOURS).toEqual({ enabled: true, start: 1320, end: 480 });
  });

  it("round-trips minutes after midnight through a local time", () => {
    for (const minutes of [0, 59, 480, 1320, 1439]) {
      expect(dateToMinutes(minutesToDate(minutes))).toBe(minutes);
    }
  });

  it("keeps the base day and clears seconds", () => {
    const base = new Date(2026, 10, 20, 15, 42, 33, 500);
    const date = minutesToDate(7 * 60 + 5, base);
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 10, 20]);
    expect([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]).toEqual(
      [7, 5, 0, 0],
    );
  });
});
