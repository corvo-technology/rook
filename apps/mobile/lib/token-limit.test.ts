import { describe, expect, it, vi } from "vitest";

vi.mock("expo-localization", () => ({ getLocales: vi.fn(() => [{ languageTag: "en-US" }]) }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("./ui-direction", () => ({ applyMobileUiDirection: vi.fn() }));

import { budgetLine, parseTokenLimit } from "./token-limit";

describe("parseTokenLimit", () => {
  it.each(["", "0", "  "])("treats %j as no limit", (text) => {
    expect(parseTokenLimit(text)).toBeNull();
  });

  it("keeps a whole number", () => {
    expect(parseTokenLimit("2000000")).toBe(2_000_000);
  });

  it.each(["1.5", "abc", "-3", "1e9", "1000000000001"])("rejects %j", (text) => {
    expect(parseTokenLimit(text)).toBeUndefined();
  });
});

describe("budgetLine", () => {
  it("writes the month against the limit with locale numbers", () => {
    expect(budgetLine({ monthTokens: 1_200_000, monthlyTokenLimit: 2_000_000 }, "en")).toBe(
      "1,200,000 of 2,000,000",
    );
  });
});
