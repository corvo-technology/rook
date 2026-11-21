import { describe, expect, it } from "vitest";
import { digestPush } from "./push-copy.js";
import {
  DEFAULT_QUIET_HOURS,
  isProactiveRunTrigger,
  isQuietNow,
  localDay,
  muteUntil,
  nextDigestTime,
  nextLocalTime,
} from "./quiet-hours.js";

const SP = "America/Sao_Paulo"; // UTC-3, no DST since 2019
const NY = "America/New_York";
const AUCKLAND = "Pacific/Auckland";
const KIRITIMATI = "Pacific/Kiritimati"; // UTC+14

describe("isQuietNow", () => {
  it("holds across midnight in the person's timezone, not the server's", () => {
    // 01:30 UTC is 22:30 in Sao Paulo: quiet there, and 20:30 in Mexico City: not.
    const now = new Date("2026-11-21T01:30:00Z");
    expect(isQuietNow(DEFAULT_QUIET_HOURS, SP, now)).toBe(true);
    expect(isQuietNow(DEFAULT_QUIET_HOURS, "America/Mexico_City", now)).toBe(false);
  });

  it("treats the start as quiet and the end as open", () => {
    expect(isQuietNow(DEFAULT_QUIET_HOURS, SP, new Date("2026-11-20T22:00:00-03:00"))).toBe(true);
    expect(isQuietNow(DEFAULT_QUIET_HOURS, SP, new Date("2026-11-21T07:59:00-03:00"))).toBe(true);
    expect(isQuietNow(DEFAULT_QUIET_HOURS, SP, new Date("2026-11-21T08:00:00-03:00"))).toBe(false);
    expect(isQuietNow(DEFAULT_QUIET_HOURS, SP, new Date("2026-11-20T21:59:00-03:00"))).toBe(false);
  });

  it("handles a window that does not wrap midnight", () => {
    const nap = { enabled: true, start: 13 * 60, end: 15 * 60 };
    expect(isQuietNow(nap, SP, new Date("2026-11-20T14:00:00-03:00"))).toBe(true);
    expect(isQuietNow(nap, SP, new Date("2026-11-20T23:00:00-03:00"))).toBe(false);
  });

  it("is never quiet when off or when the window has no length", () => {
    const night = new Date("2026-11-21T01:30:00-03:00");
    expect(isQuietNow({ ...DEFAULT_QUIET_HOURS, enabled: false }, SP, night)).toBe(false);
    expect(isQuietNow({ enabled: true, start: 480, end: 480 }, SP, night)).toBe(false);
  });

  it("follows a timezone far ahead of UTC", () => {
    // 2026-11-20T12:00Z is 02:00 on the 21st in Kiritimati.
    expect(isQuietNow(DEFAULT_QUIET_HOURS, KIRITIMATI, new Date("2026-11-20T12:00:00Z"))).toBe(
      true,
    );
    expect(isQuietNow(DEFAULT_QUIET_HOURS, KIRITIMATI, new Date("2026-11-20T20:00:00Z"))).toBe(
      false,
    );
  });

  it("falls back to UTC for an unknown timezone instead of throwing", () => {
    expect(isQuietNow(DEFAULT_QUIET_HOURS, "Not/AZone", new Date("2026-11-20T23:00:00Z"))).toBe(
      true,
    );
  });

  it("keeps the wall clock across a daylight-saving change", () => {
    // New York fell back on 2026-11-01: 06:30Z is 01:30 EDT before and 01:30 EST after the change.
    expect(isQuietNow(DEFAULT_QUIET_HOURS, NY, new Date("2026-11-01T05:30:00Z"))).toBe(true);
    // 12:30Z is 07:30 EST: still quiet. 13:00Z is 08:00 EST: open.
    expect(isQuietNow(DEFAULT_QUIET_HOURS, NY, new Date("2026-11-01T12:30:00Z"))).toBe(true);
    expect(isQuietNow(DEFAULT_QUIET_HOURS, NY, new Date("2026-11-01T13:00:00Z"))).toBe(false);
  });
});

describe("nextDigestTime", () => {
  it("is this morning when the window ends later today", () => {
    const next = nextDigestTime(DEFAULT_QUIET_HOURS, SP, new Date("2026-11-21T01:30:00-03:00"));
    expect(next.toISOString()).toBe("2026-11-21T11:00:00.000Z");
  });

  it("is tomorrow morning once today's has passed", () => {
    const next = nextDigestTime(DEFAULT_QUIET_HOURS, SP, new Date("2026-11-20T14:00:00-03:00"));
    expect(next.toISOString()).toBe("2026-11-21T11:00:00.000Z");
  });

  it("is strictly after now at the exact minute", () => {
    const next = nextDigestTime(DEFAULT_QUIET_HOURS, SP, new Date("2026-11-21T08:00:00-03:00"));
    expect(next.toISOString()).toBe("2026-11-22T11:00:00.000Z");
  });

  it("still picks a morning with quiet hours off", () => {
    const next = nextDigestTime(
      { ...DEFAULT_QUIET_HOURS, enabled: false },
      SP,
      new Date("2026-11-20T14:00:00-03:00"),
    );
    expect(next.toISOString()).toBe("2026-11-21T11:00:00.000Z");
  });

  it("uses the local morning on both sides of a spring-forward day", () => {
    // New York sprang forward on 2027-03-14: 08:00 is EST (13:00Z) on the 13th and EDT (12:00Z) on the 14th.
    expect(
      nextDigestTime(DEFAULT_QUIET_HOURS, NY, new Date("2027-03-13T14:00:00Z")).toISOString(),
    ).toBe("2027-03-14T12:00:00.000Z");
    expect(
      nextDigestTime(DEFAULT_QUIET_HOURS, NY, new Date("2027-03-13T03:00:00Z")).toISOString(),
    ).toBe("2027-03-13T13:00:00.000Z");
  });

  it("moves a morning that a spring-forward gap skips to the end of the gap", () => {
    // 02:30 does not exist in New York on 2027-03-14; it becomes 03:30 EDT (07:30Z).
    const quiet = { enabled: true, start: 22 * 60, end: 2 * 60 + 30 };
    expect(nextDigestTime(quiet, NY, new Date("2027-03-14T05:00:00Z")).toISOString()).toBe(
      "2027-03-14T07:30:00.000Z",
    );
  });

  it("crosses the date line", () => {
    // 08:00 on the 21st in Auckland (NZDT, UTC+13) is 19:00Z on the 20th.
    const next = nextDigestTime(DEFAULT_QUIET_HOURS, AUCKLAND, new Date("2026-11-20T12:00:00Z"));
    expect(next.toISOString()).toBe("2026-11-20T19:00:00.000Z");
  });
});

describe("localDay", () => {
  it("is the date where the person is", () => {
    const instant = new Date("2026-11-21T02:00:00Z");
    expect(localDay(instant, SP)).toBe("2026-11-20");
    expect(localDay(instant, AUCKLAND)).toBe("2026-11-21");
  });
});

describe("nextLocalTime", () => {
  it("rolls over a month end", () => {
    expect(nextLocalTime(480, "UTC", new Date("2026-11-30T09:00:00Z")).toISOString()).toBe(
      "2026-12-01T08:00:00.000Z",
    );
  });
});

describe("muteUntil", () => {
  const now = new Date("2026-11-20T15:00:00-03:00");
  it("lasts an hour, until tomorrow morning, or for good", () => {
    expect(muteUntil("hour", DEFAULT_QUIET_HOURS, SP, now)?.toISOString()).toBe(
      "2026-11-20T19:00:00.000Z",
    );
    expect(muteUntil("tomorrow", DEFAULT_QUIET_HOURS, SP, now)?.toISOString()).toBe(
      "2026-11-21T11:00:00.000Z",
    );
    expect(muteUntil("forever", DEFAULT_QUIET_HOURS, SP, now)).toBeNull();
  });

  it("means the next day's morning even in the small hours", () => {
    const night = new Date("2026-11-21T02:00:00-03:00");
    expect(muteUntil("tomorrow", DEFAULT_QUIET_HOURS, SP, night)?.toISOString()).toBe(
      "2026-11-22T11:00:00.000Z",
    );
  });
});

describe("isProactiveRunTrigger", () => {
  it("is true only for runs no person started", () => {
    expect(isProactiveRunTrigger("routine")).toBe(true);
    expect(isProactiveRunTrigger("webhook")).toBe(true);
    expect(isProactiveRunTrigger("user")).toBe(false);
    expect(isProactiveRunTrigger("messaging")).toBe(false);
  });
});

describe("digestPush", () => {
  it("counts the updates and names the agents", () => {
    expect(digestPush(5, ["Ana", "Bia", "Ana", "Caio", "Dani"], "en")).toEqual({
      title: "5 updates",
      body: "Ana, Bia, Caio +1",
    });
  });
  it("speaks the person's language", () => {
    expect(digestPush(2, ["Ana", "Bia"], "pt-BR")).toEqual({
      title: "2 novidades",
      body: "Ana e Bia",
    });
  });
});
