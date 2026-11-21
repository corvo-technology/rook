import { describe, expect, it } from "vitest";
import { mutedNow } from "./use-browser-notifications";

const target = { botId: "b", threadId: "t" };

describe("mutedNow", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");

  it("covers the agent, or the conversation, while the mute runs", () => {
    expect(mutedNow([{ botId: "b", threadId: null, until: null }], target, now)).toBe(true);
    expect(
      mutedNow([{ botId: null, threadId: "t", until: "2026-11-20T13:00:00Z" }], target, now),
    ).toBe(true);
  });

  it("lets an ended mute, or another agent's, through", () => {
    expect(
      mutedNow([{ botId: "b", threadId: null, until: "2026-11-20T11:59:59Z" }], target, now),
    ).toBe(false);
    expect(mutedNow([{ botId: "other", threadId: null, until: null }], target, now)).toBe(false);
    expect(mutedNow([], target, now)).toBe(false);
  });
});
