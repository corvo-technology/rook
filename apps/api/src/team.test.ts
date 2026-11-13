import { describe, expect, it } from "vitest";
import { HitLimiter, readTeamToken, teamToken } from "./team.js";

describe("team link tokens", () => {
  it("round-trips and gives the same link each time", () => {
    const token = teamToken("secret", "invite", "abc-123");
    expect(token).toBe(teamToken("secret", "invite", "abc-123"));
    expect(readTeamToken("secret", "invite", token)).toBe("abc-123");
  });

  it("refuses a tampered id, another secret, another kind and junk", () => {
    const token = teamToken("secret", "invite", "abc-123");
    expect(readTeamToken("secret", "invite", token.replace("abc", "abd"))).toBeNull();
    expect(readTeamToken("other", "invite", token)).toBeNull();
    expect(readTeamToken("secret", "join", token)).toBeNull();
    expect(readTeamToken("secret", "invite", "nodot")).toBeNull();
    expect(readTeamToken("secret", "invite", "abc.short")).toBeNull();
  });
});

describe("HitLimiter", () => {
  it("allows a few hits per window and frees them after it", () => {
    const limiter = new HitLimiter(2, 1000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 10)).toBe(true);
    expect(limiter.allow("a", 20)).toBe(false);
    expect(limiter.allow("b", 20)).toBe(true);
    expect(limiter.allow("a", 1500)).toBe(true);
  });
});
