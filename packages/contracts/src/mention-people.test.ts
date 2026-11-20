import { describe, expect, it } from "vitest";
import { appContract } from "./rpc.js";

const sendInput = appContract.threads.send["~orpc"].inputSchema!;

describe("threads.send mentions", () => {
  it("accepts a person mention beside the older kinds", () => {
    const parsed = sendInput.safeParse({
      botId: "bot-1",
      text: "@Ana hello",
      mentions: ["bot-1", { kind: "bot", id: "bot-1" }, { kind: "person", id: "user-2" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("still parses a payload from before person mentions", () => {
    expect(
      sendInput.safeParse({
        groupId: "group-1",
        text: "hi",
        mentions: [
          { kind: "group", id: "g" },
          { kind: "connector", id: "c" },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects a person mention without an id and unknown kinds", () => {
    expect(
      sendInput.safeParse({ botId: "b", text: "x", mentions: [{ kind: "person" }] }).success,
    ).toBe(false);
    expect(
      sendInput.safeParse({ botId: "b", text: "x", mentions: [{ kind: "team", id: "t" }] }).success,
    ).toBe(false);
  });
});
