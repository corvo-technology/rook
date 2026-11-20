import { describe, expect, it } from "vitest";
import type { RunContext } from "./run-context.js";
import { notePrivateResult, resultText } from "./run-egress.js";

function context() {
  return {
    state: {
      egress: { privateText: [] as string[], privateChars: 0, knownUrls: new Set<string>() },
    },
  } as unknown as RunContext;
}

describe("resultText", () => {
  it("reads the text a result holds as the agent read it, not its JSON escaping", () => {
    expect(resultText({ body: 'He said "hi"\nbye', rows: [{ n: 1 }, "x"], none: null })).toBe(
      'He said "hi"\nbye\n1\nx',
    );
    expect(resultText(undefined)).toBe("");
  });
});

describe("notePrivateResult", () => {
  it("keeps a private result and the URLs in it", () => {
    const ctx = context();
    notePrivateResult(ctx, "gmail_get_message", { body: "see https://example.com/a?b=1 now" });
    expect(ctx.state.egress.privateText).toEqual(["see https://example.com/a?b=1 now"]);
    expect(ctx.state.egress.knownUrls.has("https://example.com/a?b=1")).toBe(true);
  });

  it("keeps the URLs of a public page but not its text as private data", () => {
    const ctx = context();
    notePrivateResult(ctx, "web_fetch", { text: "read https://example.com/docs" });
    expect(ctx.state.egress.privateText).toEqual([]);
    expect(ctx.state.egress.knownUrls.has("https://example.com/docs")).toBe(true);
  });

  it("bounds what it keeps, dropping the oldest", () => {
    const ctx = context();
    for (let i = 0; i < 8; i += 1) notePrivateResult(ctx, "tool", `${i}`.repeat(190_000));
    expect(ctx.state.egress.privateChars).toBeLessThanOrEqual(1_000_000);
    expect(ctx.state.egress.privateText.at(-1)).toBe("7".repeat(190_000));
    expect(ctx.state.egress.privateText[0]!.startsWith("0")).toBe(false);
  });
});
