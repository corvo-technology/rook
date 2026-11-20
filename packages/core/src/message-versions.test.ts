import type { MessageBlock } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { canBranchFromMessage, canEditMessage, lastReplyId } from "./message-versions.js";

const message = (
  overrides: Partial<{
    id: string;
    role: string;
    blocks: MessageBlock[];
    authorUserId: string;
    callId: string;
  }>,
) => ({
  id: "m1",
  role: "user",
  blocks: [{ kind: "text", text: "hello" }] as MessageBlock[],
  ...overrides,
});

describe("which messages can change", () => {
  it("lets a person edit their own text and nothing else", () => {
    expect(canEditMessage(message({}), "u1")).toBe(true);
    expect(canEditMessage(message({ authorUserId: "u1" }), "u1")).toBe(true);
    expect(canEditMessage(message({ authorUserId: "u2" }), "u1")).toBe(false);
    expect(canEditMessage(message({ role: "bot" }), "u1")).toBe(false);
    const withFile = [
      { kind: "text", text: "hi" },
      { kind: "file", artifactId: "a1", name: "x.txt" },
    ] as unknown as MessageBlock[];
    expect(canEditMessage(message({ blocks: withFile }), "u1")).toBe(false);
    expect(canEditMessage(message({ callId: "call-1" }), "u1")).toBe(false);
  });

  it("branches only from words someone said", () => {
    expect(canBranchFromMessage(message({}))).toBe(true);
    expect(canBranchFromMessage(message({ role: "system" }))).toBe(false);
    expect(canBranchFromMessage(message({ id: "progress:run-1", role: "bot" }))).toBe(false);
  });

  it("redoes only the agent's newest reply, and only if the person has not spoken since", () => {
    const user = message({ id: "u", role: "user" });
    const reply = message({ id: "r", role: "bot" });
    const note = message({ id: "n", role: "system" });
    expect(lastReplyId([user, reply])).toBe("r");
    expect(lastReplyId([user, reply, note])).toBe("r");
    expect(lastReplyId([user, reply, message({ id: "u2", role: "user" })])).toBeUndefined();
    expect(lastReplyId([user])).toBeUndefined();
  });
});
