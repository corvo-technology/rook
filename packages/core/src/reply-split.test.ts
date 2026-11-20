import type { MessageBlock } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  holdBackPartialMarker,
  replyMarker,
  splitReplyByMessage,
  stripReplyMarkers,
} from "./reply-split.js";

const text = (value: string): MessageBlock => ({ kind: "text", text: value });

describe("splitReplyByMessage", () => {
  it("gives each marked answer to the message it answers, in order", () => {
    const parts = splitReplyByMessage(
      [text(`${replyMarker("a")}\nIt is blue.\n\n${replyMarker("b")}\nIt is 4.`)],
      ["a", "b"],
    );
    expect(parts).toEqual([
      { replyToMessageId: "a", blocks: [text("It is blue.")] },
      { replyToMessageId: "b", blocks: [text("It is 4.")] },
    ]);
  });

  it("answers the last message when the agent used no marker", () => {
    expect(splitReplyByMessage([text("Done.")], ["a", "b"])).toEqual([
      { replyToMessageId: "b", blocks: [text("Done.")] },
    ]);
  });

  it("sends text before the first marker to the first message and ignores unknown ids", () => {
    const parts = splitReplyByMessage(
      [text(`Intro [[reply:zzz]]kept\n${replyMarker("b")}Second`)],
      ["a", "b"],
    );
    expect(parts.map((part) => part.replyToMessageId)).toEqual(["a", "b"]);
    expect(parts[0]?.blocks).toEqual([text("Intro kept")]);
  });

  it("keeps steps with the answer that follows them", () => {
    const steps: MessageBlock = { kind: "steps", steps: [] } as unknown as MessageBlock;
    const parts = splitReplyByMessage([steps, text(`${replyMarker("a")}One`)], ["a", "b"]);
    expect(parts).toEqual([{ replyToMessageId: "a", blocks: [steps, text("One")] }]);
  });

  it("has nothing to split without targets", () => {
    expect(splitReplyByMessage([text("x")], [])).toEqual([]);
  });
});

describe("stream markers", () => {
  it("strips whole markers and holds back a partial one", () => {
    expect(stripReplyMarkers(`${replyMarker("a")}\nHi`)).toBe("Hi");
    expect(holdBackPartialMarker("Hi [[rep")).toEqual({ emit: "Hi ", hold: "[[rep" });
    expect(holdBackPartialMarker("Hi [")).toEqual({ emit: "Hi ", hold: "[" });
    expect(holdBackPartialMarker(`Hi ${replyMarker("a")} yo`)).toEqual({
      emit: "Hi  yo",
      hold: "",
    });
  });
});
