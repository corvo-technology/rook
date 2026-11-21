import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ rpc: vi.fn() }));

import { muteKey, muteTarget } from "./inbox-mutes";

describe("inbox mutes", () => {
  it("mutes a bot by id and a group by thread", () => {
    expect(muteTarget("bot", { id: "bot-1", threadId: "thread-1" })).toEqual({ botId: "bot-1" });
    expect(muteTarget("group", { id: "group-1", threadId: "thread-2" })).toEqual({
      threadId: "thread-2",
    });
  });

  it("cannot mute a group whose thread is unknown", () => {
    expect(muteTarget("group", { id: "group-1" })).toBeNull();
  });

  it("keys targets and running mutes the same way", () => {
    expect(muteKey({ botId: "b" })).toBe(muteKey({ botId: "b", threadId: null, until: null }));
    expect(muteKey({ threadId: "t" })).toBe(
      muteKey({ botId: null, threadId: "t", until: "2026-11-21T08:00:00.000Z" }),
    );
    expect(muteKey({ botId: "x" })).not.toBe(muteKey({ threadId: "x" }));
  });
});
