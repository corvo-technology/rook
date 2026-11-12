import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "./canonical-host.js";

describe("canonicalRedirect", () => {
  it.each([
    "https://rookup.run",
    "https://www.rookup.run",
    "https://www.rook.team",
    "https://bots.corvo.tech",
    "https://WWW.BOTS.CORVO.TECH",
  ])("sends %s to the apex", (origin) => {
    expect(canonicalRedirect(`${origin}/privacy/?ref=x#top`)).toBe("https://rook.team/privacy/?ref=x");
    expect(canonicalRedirect(`${origin}/`)).toBe("https://rook.team/");
  });

  it("leaves the canonical host alone", () => {
    expect(canonicalRedirect("https://rook.team/privacy/")).toBeNull();
  });
});
