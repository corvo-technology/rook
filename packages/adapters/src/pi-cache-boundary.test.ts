import { describe, expect, it } from "vitest";
import { markCacheBoundary, withCacheBoundary } from "./pi-cache-boundary.js";

const marker = { type: "ephemeral" };
const anthropic = (extra: Record<string, unknown> = {}) => ({
  system: [{ type: "text", text: "system", cache_control: marker }],
  messages: [
    { role: "user", content: [{ type: "text", text: "earlier" }] },
    {
      role: "user",
      content: [
        { type: "text", text: "second" },
        { type: "text", text: "note", cache_control: marker },
      ],
    },
  ],
  ...extra,
});

describe("cache boundary", () => {
  it("marks the block that ends the user message, copying an existing marker", () => {
    const next = markCacheBoundary(anthropic(), "second") as ReturnType<typeof anthropic>;
    expect(next.messages[1]!.content[0]).toEqual({
      type: "text",
      text: "second",
      cache_control: marker,
    });
    expect(next.messages[0]!.content[0]).not.toHaveProperty("cache_control");
  });

  it("leaves a payload with four markers alone", () => {
    const full = anthropic({
      tools: [
        { name: "a", cache_control: marker },
        { name: "b", cache_control: marker },
      ],
    });
    expect(markCacheBoundary(full, "second")).toBeUndefined();
  });

  it("leaves a payload without markers alone", () => {
    const none = {
      system: [{ type: "text", text: "system" }],
      messages: [{ role: "user", content: [{ type: "text", text: "second" }] }],
    };
    expect(markCacheBoundary(none, "second")).toBeUndefined();
  });

  it("leaves Chat Completions payloads without content arrays alone", () => {
    expect(
      markCacheBoundary({ messages: [{ role: "user", content: "second" }] }, "second"),
    ).toBeUndefined();
  });

  it("ignores text that is not the boundary", () => {
    expect(markCacheBoundary(anthropic(), "missing")).toBeUndefined();
  });

  it("edits the result of an earlier hook", async () => {
    const hook = withCacheBoundary(
      {
        onPayload: async (payload: unknown) => ({
          ...(payload as object),
          messages: [
            { role: "user", content: [{ type: "text", text: "second", marked: "by hook" }] },
          ],
          system: [{ type: "text", text: "system", cache_control: marker }],
        }),
      },
      () => "second",
    );
    const result = (await (
      hook as unknown as { onPayload: (payload: unknown, model: never) => Promise<unknown> }
    ).onPayload({ messages: [] }, undefined as never)) as {
      messages: Array<{ content: unknown[] }>;
    };
    expect(result.messages[0]!.content[0]).toEqual({
      type: "text",
      text: "second",
      marked: "by hook",
      cache_control: marker,
    });
  });

  it("does nothing without a boundary text", async () => {
    const hook = withCacheBoundary(undefined, () => undefined) as unknown as {
      onPayload: (payload: unknown, model: never) => Promise<unknown>;
    };
    expect(await hook.onPayload(anthropic(), undefined as never)).toBeUndefined();
  });
});
