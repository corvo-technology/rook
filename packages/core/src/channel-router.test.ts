import { describe, expect, it } from "vitest";
import {
  continuityBotId,
  parseRouterScores,
  pickRoutedBots,
  type RouterScores,
} from "./channel-router.js";
import { resolveMentionedBotIds } from "./group-mentions.js";

const ids = ["a", "b", "c", "d"];
const scores = (overrides: Partial<RouterScores>): RouterScores => ({
  scores: {},
  forEveryone: 0,
  needsAgent: 1,
  reason: "",
  ...overrides,
});

describe("pickRoutedBots", () => {
  it("picks nobody when no agent is needed, however well a member fits", () => {
    expect(pickRoutedBots(scores({ needsAgent: 0.49, scores: { a: 1 } }), ids)).toEqual([]);
  });

  it("picks the best member at or above the threshold", () => {
    expect(pickRoutedBots(scores({ scores: { a: 0.6, b: 0.9, c: 0.4 } }), ids)).toEqual(["b"]);
    expect(pickRoutedBots(scores({ scores: { a: 0.5 } }), ids)).toEqual(["a"]);
  });

  it("picks nobody when no member clears the threshold", () => {
    expect(pickRoutedBots(scores({ scores: { a: 0.49, b: 0.2 } }), ids)).toEqual([]);
  });

  it("picks up to three when the message is for everyone", () => {
    const everyone = scores({ forEveryone: 0.5, scores: { a: 0.6, b: 0.9, c: 0.7, d: 0.8 } });
    expect(pickRoutedBots(everyone, ids)).toEqual(["b", "d", "c"]);
  });

  it("never picks an id the code did not offer", () => {
    expect(pickRoutedBots(scores({ scores: { stranger: 1, a: 0.6 } }), ["a"])).toEqual(["a"]);
    expect(pickRoutedBots(scores({ scores: { stranger: 1 } }), ["a"])).toEqual([]);
  });
});

describe("parseRouterScores", () => {
  it("reads the JSON around prose and drops unknown ids", () => {
    const parsed = parseRouterScores(
      'Here: {"scores":{"a":0.8,"x":1},"forEveryone":0.1,"needsAgent":0.9,"reason":"sales"} ok',
      ids,
    );
    expect(parsed).toEqual({
      scores: { a: 0.8 },
      forEveryone: 0.1,
      needsAgent: 0.9,
      reason: "sales",
    });
  });

  it("clamps scores into 0..1", () => {
    const parsed = parseRouterScores(
      '{"scores":{"a":3,"b":-1},"forEveryone":2,"needsAgent":1,"reason":""}',
      ids,
    );
    expect(parsed?.scores).toEqual({ a: 1, b: 0 });
    expect(parsed?.forEveryone).toBe(1);
  });

  it("rejects an answer without the required numbers", () => {
    expect(parseRouterScores(undefined, ids)).toBeUndefined();
    expect(parseRouterScores("no json", ids)).toBeUndefined();
    expect(parseRouterScores('{"scores":{"a":1},"needsAgent":1}', ids)).toBeUndefined();
    expect(parseRouterScores('{"forEveryone":0,"needsAgent":1}', ids)).toBeUndefined();
  });
});

describe("continuityBotId", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const last = (minutesAgo: number, role = "bot", botId: string | null = "a") => ({
    role,
    botId,
    createdAt: new Date(now - minutesAgo * 60_000),
  });

  it("sends a short follow-up right after an agent answered to that agent", () => {
    expect(continuityBotId({ text: "and in May?", now, last: last(1), candidateIds: ids })).toBe(
      "a",
    );
  });

  it("does not apply to a long message, an old answer or a person's last message", () => {
    const long = "x".repeat(200);
    expect(continuityBotId({ text: long, now, last: last(1), candidateIds: ids })).toBeUndefined();
    expect(
      continuityBotId({ text: "and?", now, last: last(10), candidateIds: ids }),
    ).toBeUndefined();
    expect(
      continuityBotId({ text: "and?", now, last: last(1, "user", null), candidateIds: ids }),
    ).toBeUndefined();
    expect(
      continuityBotId({ text: "and?", now, last: undefined, candidateIds: ids }),
    ).toBeUndefined();
  });

  it("does not apply to an agent that is no longer a member", () => {
    expect(
      continuityBotId({ text: "and?", now, last: last(1), candidateIds: ["b"] }),
    ).toBeUndefined();
  });
});

describe("resolveMentionedBotIds", () => {
  const members = [
    { id: "a", name: "Ana" },
    { id: "b", name: "Beto" },
  ];

  it("is empty when the message names nobody", () => {
    expect(resolveMentionedBotIds({ text: "hello team", members })).toEqual([]);
  });

  it("finds @Name, chips and @everyone", () => {
    expect(resolveMentionedBotIds({ text: "@Beto look", members })).toEqual(["b"]);
    expect(resolveMentionedBotIds({ text: "look", members, explicitMentions: ["a"] })).toEqual([
      "a",
    ]);
    expect(resolveMentionedBotIds({ text: "@everyone look", members })).toEqual(["a", "b"]);
  });
});
