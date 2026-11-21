import type { MessageBlock } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { researchBlockFromPayload } from "./research.js";
import { updateResearchMessages } from "./thread-message-updates.js";

describe("researchBlockFromPayload", () => {
  it("keeps a known status and runs anything else", () => {
    expect(
      researchBlockFromPayload({ researchId: "r1", question: "Why?", status: "finished" }),
    ).toEqual({ kind: "research", researchId: "r1", question: "Why?", status: "finished" });
    expect(researchBlockFromPayload({ researchId: "r1", status: "odd" }).status).toBe("running");
  });
});

describe("updateResearchMessages", () => {
  it("replaces the card of the job in its message and leaves other messages alone", () => {
    const running: MessageBlock = {
      kind: "research",
      researchId: "r1",
      question: "Why?",
      status: "running",
    };
    const messages = [
      { id: "m1", blocks: [running] },
      { id: "m2", blocks: [{ kind: "text", text: "hi" } as MessageBlock] },
    ];
    const next = updateResearchMessages(messages, {
      messageId: "m1",
      researchId: "r1",
      question: "Why?",
      status: "finished",
    });
    expect(next[0]?.blocks[0]).toMatchObject({ kind: "research", status: "finished" });
    expect(next[1]).toBe(messages[1]);
  });
});
