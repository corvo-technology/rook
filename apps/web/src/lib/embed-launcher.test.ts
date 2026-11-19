import { describe, expect, it } from "vitest";
import { parseEmbedMessage } from "./embed";

describe("parseEmbedMessage from the launcher", () => {
  it("accepts a limited page context, or none", () => {
    expect(parseEmbedMessage({ type: "corvo:context", context: null })).toEqual({
      type: "context",
      context: null,
    });
    expect(
      parseEmbedMessage({
        type: "corvo:context",
        context: { page: "/a", entities: [{ type: "customer", id: "1", label: "Carlos" }] },
      }),
    ).toMatchObject({ type: "context", context: { page: "/a" } });
    expect(parseEmbedMessage({ type: "corvo:context", context: { entities: "nope" } })).toBeNull();
    expect(
      parseEmbedMessage({
        type: "corvo:context",
        context: { page: "x".repeat(300), entities: [] },
      }),
    ).toBeNull();
  });

  it("keeps only actions that fit the contract", () => {
    const parsed = parseEmbedMessage({
      type: "corvo:actions",
      actions: [{ name: "book" }, { name: "Not Valid" }, "x"],
    });
    expect(parsed).toMatchObject({ type: "actions", actions: [{ name: "book" }] });
  });

  it("accepts a question and an action result, with the result capped", () => {
    expect(parseEmbedMessage({ type: "corvo:ask", text: "  Oi  " })).toEqual({
      type: "ask",
      text: "Oi",
    });
    expect(parseEmbedMessage({ type: "corvo:ask", text: "   " })).toBeNull();
    expect(
      parseEmbedMessage({
        type: "corvo:action-result",
        id: "a1",
        ok: true,
        result: "y".repeat(900),
      }),
    ).toMatchObject({ type: "action-result", id: "a1", ok: true, result: "y".repeat(300) });
    expect(parseEmbedMessage({ type: "corvo:action-result", id: "a1" })).toBeNull();
  });
});
