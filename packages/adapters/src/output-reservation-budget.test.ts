import { describe, expect, it } from "vitest";
import { affordableOutputTokens } from "./output-reservation-budget.js";

const message = (affordable = 5366, requested = 32_768) =>
  `This request requires more credits, or fewer max_tokens. You requested up to ${requested} tokens, but can only afford ${affordable}. Add credits to continue.`;
const structured = (affordable = 5366, inner = false) =>
  `402: ${JSON.stringify(
    inner
      ? {
          error: { message: message(affordable) },
          metadata: { limit_source: "provider_credits" },
        }
      : { message: message(affordable), metadata: { limit_source: "provider_credits" } },
  )}`;

describe("output reservation recovery", () => {
  it.each([
    ["plain text", `402 ${message()}`],
    ["prefixed text", `HTTP 402: ${message()}`],
    ["structured body", structured()],
    ["nested structured body", structured(5366, true)],
    ["structured code", JSON.stringify({ error: { code: 402, message: message() } })],
  ])("reads the affordable size from a 402 (%s)", (_name, error) => {
    expect(affordableOutputTokens(error, 32_768)).toBe(5366);
  });

  it.each([0, -1, 1023, 32_768, 40_000, Number.MAX_SAFE_INTEGER + 1])(
    "ignores unsafe, unreasonably small or non-decreasing allowances (%s)",
    (affordable) => {
      expect(affordableOutputTokens(`402 ${message(affordable)}`, 32_768)).toBeUndefined();
    },
  );

  it("does not raise an explicit output cap", () => {
    expect(affordableOutputTokens(`402 ${message()}`, 4096)).toBeUndefined();
  });

  it.each([
    undefined,
    "402: invalid JSON",
    `402 ${message().replace("fewer max_tokens", "more")}`,
    `402: ${JSON.stringify({ message: message(), metadata: { limit_source: "openrouter_key_limit" } })}`,
    "402 Insufficient credits.",
    `401 ${message()}`,
    `429 ${message()}`,
    "The model wrote: 402 you requested up to 9 tokens, but can only afford 5",
  ])("leaves unrelated, empty-balance and other-status errors for failover", (error) => {
    expect(affordableOutputTokens(error, 32_768)).toBeUndefined();
  });
});
