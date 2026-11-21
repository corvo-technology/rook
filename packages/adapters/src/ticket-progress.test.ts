import { describe, expect, it } from "vitest";
import { classifyRunError } from "./run-error-code.js";
import { ticketFailureComment } from "./ticket-progress.js";

const creditError =
  "402 This request requires more credits, or fewer max_tokens. You requested up to 32768 tokens, but can only afford 200. Add credits to continue.";

describe("ticket comment for a failed run", () => {
  it("says which connection is out of credits, in the owner's language", () => {
    const info = classifyRunError(new Error(creditError), creditError, {
      provider: "openrouter",
      model: "fixture",
    });
    expect(info?.params?.kind).toBe("credit");
    expect(ticketFailureComment(info, "pt-BR")).toBe(
      "A conexão do modelo está sem créditos. Adicione créditos a ela ou conecte outro modelo para continuar.",
    );
    expect(ticketFailureComment(info, undefined)).toContain("is out of credits");
  });

  it("uses the run's own line for any other failure, and nothing without a code", () => {
    expect(ticketFailureComment({ code: "timeout" }, "pt-BR")).toBe(
      "O modelo demorou demais para responder.",
    );
    expect(ticketFailureComment(undefined, "pt-BR")).toBeUndefined();
  });
});
