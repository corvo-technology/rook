import { describe, expect, it } from "vitest";
import { pickBackgroundModelId } from "./background-model.js";

const table =
  (rows: Record<string, { input: number; output: number }>) => (_provider: string, id: string) =>
    rows[id];

describe("pickBackgroundModelId", () => {
  it("picks the lowest output cost", () => {
    expect(
      pickBackgroundModelId({
        provider: "p",
        models: ["a", "b", "c"],
        mainModelId: "a",
        costs: table({
          a: { input: 3, output: 15 },
          b: { input: 1, output: 4 },
          c: { input: 0.5, output: 1 },
        }),
      }),
    ).toBe("c");
  });

  it("breaks output ties by input cost, then list order", () => {
    const costs = table({
      a: { input: 9, output: 9 },
      b: { input: 2, output: 1 },
      c: { input: 1, output: 1 },
      d: { input: 1, output: 1 },
    });
    expect(
      pickBackgroundModelId({
        provider: "p",
        models: ["a", "b", "c", "d"],
        mainModelId: "a",
        costs,
      }),
    ).toBe("c");
    expect(
      pickBackgroundModelId({ provider: "p", models: ["a", "d", "c"], mainModelId: "a", costs }),
    ).toBe("d");
  });

  it("returns null when fewer than two models have metadata", () => {
    expect(
      pickBackgroundModelId({
        provider: "p",
        models: ["a", "b", "c"],
        mainModelId: "a",
        costs: table({ b: { input: 1, output: 1 } }),
      }),
    ).toBeNull();
  });

  it("returns null when every cost is equal", () => {
    const zero = { input: 0, output: 0 };
    expect(
      pickBackgroundModelId({
        provider: "p",
        models: ["a", "b"],
        mainModelId: "a",
        costs: table({ a: zero, b: zero }),
      }),
    ).toBeNull();
  });

  it("returns null when the cheapest is the main model", () => {
    expect(
      pickBackgroundModelId({
        provider: "p",
        models: ["a", "b"],
        mainModelId: "a",
        costs: table({ a: { input: 1, output: 1 }, b: { input: 5, output: 5 } }),
      }),
    ).toBeNull();
  });

  it("never matches names", () => {
    expect(
      pickBackgroundModelId({
        provider: "p",
        models: ["fast-mini", "big"],
        mainModelId: "x",
        costs: table({ "fast-mini": { input: 1, output: 8 }, big: { input: 1, output: 2 } }),
      }),
    ).toBe("big");
  });

  it("the default lookup prices a real catalog pair", () => {
    expect(
      pickBackgroundModelId({
        provider: "anthropic",
        models: ["claude-opus-4-5", "claude-haiku-4-5"],
        mainModelId: "claude-opus-4-5",
      }),
    ).toBe("claude-haiku-4-5");
  });
});
