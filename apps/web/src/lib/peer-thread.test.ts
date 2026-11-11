import { expect, it } from "vitest";
import { peerThreadSummary } from "./peer-thread";

const reply = (botId: string | undefined, minute: number, role: "bot" | "user" = "bot") => ({
  role,
  botId,
  createdAt: new Date(Date.UTC(2026, 10, 2, 12, minute)).toISOString(),
});

it("counts the folded replies, names who replied once each, and keeps the last time", () => {
  const summary = peerThreadSummary([
    reply("cora", 1),
    reply("fabio", 2),
    reply("cora", 3),
    reply(undefined, 4, "user"),
  ]);
  expect(summary).toEqual({
    count: 3,
    botIds: ["cora", "fabio"],
    lastAt: reply("cora", 3).createdAt,
  });
});

it("shows at most three faces", () => {
  const summary = peerThreadSummary(["a", "b", "c", "d"].map((id, i) => reply(id, i)));
  expect(summary?.botIds).toEqual(["a", "b", "c"]);
  expect(summary?.count).toBe(4);
});

it("is nothing when no agent replied", () => {
  expect(peerThreadSummary(undefined)).toBeUndefined();
  expect(peerThreadSummary([reply(undefined, 1, "user")])).toBeUndefined();
});
