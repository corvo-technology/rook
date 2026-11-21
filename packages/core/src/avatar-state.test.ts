import { describe, expect, it } from "vitest";
import { avatarLook } from "./avatar-state.js";

describe("avatarLook", () => {
  it("thinks while queued, works while running", () => {
    expect(avatarLook("queued", false).state).toBe("thinking");
    expect(avatarLook("leased", false).state).toBe("thinking");
    expect(avatarLook("running", false).state).toBe("working");
  });

  it("waits when a person has to answer or take over", () => {
    expect(avatarLook("waiting_input", false).state).toBe("waiting");
    expect(avatarLook("waiting_takeover", false).state).toBe("waiting");
  });

  it("is blocked after a failure, even right after work ended", () => {
    expect(avatarLook("failed", false).state).toBe("blocked");
    expect(avatarLook("failed", true).state).toBe("blocked");
  });

  it("is done and happy only for work that just ended well, otherwise idle", () => {
    expect(avatarLook("completed", true)).toEqual({ state: "done", mood: "happy", asleep: false });
    expect(avatarLook("idle", false)).toEqual({ state: "idle", mood: "neutral", asleep: false });
    expect(avatarLook(undefined, false).state).toBe("idle");
    expect(avatarLook("running", true).state).toBe("working");
  });

  it("keeps the mood neutral while it is doing anything", () => {
    for (const status of ["queued", "running", "waiting_input", "failed"]) {
      expect(avatarLook(status, false).mood).toBe("neutral");
    }
  });

  it("marks only a status of asleep as asleep", () => {
    expect(avatarLook("asleep", true)).toEqual({ state: "idle", mood: "neutral", asleep: true });
    expect(avatarLook("running", false).asleep).toBe(false);
  });
});
