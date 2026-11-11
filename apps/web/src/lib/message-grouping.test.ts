import type { ThreadMessage } from "@corvo/contracts";
import { expect, it } from "vitest";
import { continuedMessageIds } from "./message-grouping";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 2, 12, minutes)).toISOString();
const say = (
  id: string,
  botId: string | undefined,
  minutes: number,
  role: ThreadMessage["role"] = "bot",
  blocks: ThreadMessage["blocks"] = [{ kind: "text", text: id }],
) => ({ id, role, botId, createdAt: at(minutes), blocks });
const none = () => false;

it("carries on from the same agent speaking again within a few minutes", () => {
  const continued = continuedMessageIds([say("a", "leo", 0), say("b", "leo", 2)], none);
  expect([...continued]).toEqual(["b"]);
});

it("starts over when someone else speaks, and again when the first agent returns", () => {
  const continued = continuedMessageIds(
    [say("a", "leo", 0), say("b", "nico", 1), say("c", "leo", 2)],
    none,
  );
  expect(continued.size).toBe(0);
});

it("starts over after a pause", () => {
  const continued = continuedMessageIds([say("a", "leo", 0), say("b", "leo", 6)], none);
  expect(continued.size).toBe(0);
});

it("starts over at a day marker or the unread line, which the caller names", () => {
  const messages = [say("a", "leo", 0), say("b", "leo", 1), say("c", "leo", 2)];
  expect([...continuedMessageIds(messages, (id) => id === "b")]).toEqual(["c"]);
});

it("starts over when the person speaks in between, and never groups the person's own messages", () => {
  const continued = continuedMessageIds(
    [say("a", "leo", 0), say("me", undefined, 1, "user"), say("b", "leo", 2), say("c", "leo", 3)],
    none,
  );
  expect([...continued]).toEqual(["c"]);
});

it("starts over after a hand-off receipt", () => {
  const receipt = say("r", "leo", 1, "bot", [
    {
      kind: "bot_message_received",
      fromBotId: "leo",
      text: "hi",
    } as ThreadMessage["blocks"][number],
  ]);
  const continued = continuedMessageIds([say("a", "leo", 0), receipt, say("b", "leo", 2)], none);
  expect(continued.has("b")).toBe(false);
});

it("groups the person's own messages when asked, as a channel does", () => {
  const continued = continuedMessageIds(
    [
      say("me1", undefined, 0, "user"),
      say("me2", undefined, 1, "user"),
      say("a", "leo", 2),
      say("me3", undefined, 3, "user"),
      say("me4", undefined, 9, "user"),
    ],
    none,
    { people: true },
  );
  expect([...continued]).toEqual(["me2"]);
});
