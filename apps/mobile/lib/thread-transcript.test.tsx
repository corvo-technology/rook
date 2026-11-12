// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { MobileMessage } from "./api";
import { useThreadTranscript } from "./thread-transcript";

const message = (id: string, extra: Partial<MobileMessage> = {}): MobileMessage => ({
  id,
  role: "bot",
  botId: "bot-1",
  blocks: [{ kind: "text", text: id }],
  seq: Number(id.replace(/\D/g, "")) || 0,
  createdAt: "2026-11-02T12:00:00.000Z",
  ...extra,
});

function transcriptOf(messages: MobileMessage[], inGroup: boolean) {
  const seen: { visible: string[]; replies: string[] | undefined }[] = [];
  function Probe() {
    const transcript = useThreadTranscript(messages, inGroup);
    seen.push({
      visible: transcript.reactionView.visibleMessages.map((m) => m.id),
      replies: transcript.peerTranscript.folded.get("m1")?.map((m) => m.id),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  act(() => root.unmount());
  return seen.at(-1)!;
}

describe("thread transcript", () => {
  const thread = [message("m1"), message("m2", { threadRootId: "m1" }), message("m3")];

  it("keeps a channel's thread replies out of the main column", () => {
    expect(transcriptOf(thread, true)).toEqual({ visible: ["m1", "m3"], replies: ["m2"] });
  });

  it("leaves a bot chat as it is", () => {
    expect(transcriptOf(thread, false).visible).toEqual(["m1", "m2", "m3"]);
  });
});
