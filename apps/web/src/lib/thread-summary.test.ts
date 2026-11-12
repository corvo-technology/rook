import { expect, it } from "vitest";
import { threadSummary } from "./thread-summary";

let next = 0;
const reply = (botId: string | undefined, minute: number, role: "bot" | "user" = "bot") => ({
  id: `m${next++}`,
  role,
  botId,
  blocks: [{ kind: "text" as const, text: "ok" }],
  createdAt: new Date(Date.UTC(2026, 10, 2, 12, minute)).toISOString(),
});

it("counts every reply, names the agents once each, and keeps the last time", () => {
  const last = reply(undefined, 4, "user");
  expect(threadSummary([reply("cora", 1), reply("fabio", 2), reply("cora", 3), last])).toEqual({
    count: 4,
    botIds: ["cora", "fabio"],
    lastAt: last.createdAt,
  });
});

it("shows at most three faces", () => {
  const summary = threadSummary(["a", "b", "c", "d"].map((id, i) => reply(id, i)));
  expect(summary?.botIds).toEqual(["a", "b", "c"]);
  expect(summary?.count).toBe(4);
});

it("leaves out reactions and live drafts", () => {
  const reaction = {
    ...reply(undefined, 2, "user"),
    blocks: [{ kind: "text" as const, text: "👍" }],
    replyToMessageId: "m0",
  };
  const draft = { ...reply("cora", 3), id: "progress:run-1" };
  expect(threadSummary([reply("cora", 1), reaction, draft])?.count).toBe(1);
});

it("is nothing without a reply", () => {
  expect(threadSummary(undefined)).toBeUndefined();
  expect(threadSummary([])).toBeUndefined();
});
